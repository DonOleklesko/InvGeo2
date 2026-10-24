// MODEL ROZKŁADU RUCHU (przypisanie ruchu do sieci)
// Jak w modelach transportowych miast (wersja uproszczona, do porównań wariantów):
//  1) sieć: wszystkie drogi i ulice OSM z prędkością i przepustowością wg klasy drogi i pasów,
//     z jednokierunkowością; odcinki między skrzyżowaniami łączymy (szybsze liczenie),
//  2) rejony ok. 1 × 1 km z mieszkańcami i miejscami pracy (popyt.js) + wjazdy spoza miasta
//     na drogach wlotowych,
//  3) podróże autem między rejonami: model grawitacyjny, suma = podróże autem mieszkańców
//     (ludność × podróże na osobę × udział auta) + ruch z zewnątrz,
//  4) rozkład na sieć w godzinie szczytu: każdy przejazd najszybszą trasą, 8 iteracji z czasem
//     przejazdu zależnym od zatłoczenia (BPR, metoda kolejnych średnich – MSA),
//  5) scenariusz (nowe drogi, zamknięte ulice, nowe osiedla) liczony tak samo → ruch na każdej
//     ulicy przed i po zmianie: ile aut pojedzie nową drogą i którędy pojadą objazdy.
// UWAGA: rejony są duże, ruch wewnątrz rejonów i ruch tranzytowy przez miasto są pominięte.
import { dist } from "./network.js";
import { z } from "./config.js";
import { punktyMieszkancow, miejscaPracy, wWielokacie } from "./popyt.js";

// v – prędkość swobodna [km/h]; pas – przepustowość pasa w kierunku [poj./h] (ze skrzyżowaniami)
// pasy – domyślnie w kierunku; pasyJedn – na jezdni jednokierunkowej (połowa drogi dwujezdniowej)
const KLASY = {
  motorway: { v: 100, pas: 1800, pasy: 2 },
  trunk: { v: 70, pas: 1300, pasy: 2 },
  primary: { v: 50, pas: 900, pasy: 1, pasyJedn: 2 },
  secondary: { v: 45, pas: 750, pasy: 1, pasyJedn: 2 },
  tertiary: { v: 40, pas: 600, pasy: 1 },
  unclassified: { v: 35, pas: 450, pasy: 1 },
  residential: { v: 30, pas: 400, pasy: 1 },
  road: { v: 30, pas: 400, pasy: 1 },
  living_street: { v: 15, pas: 200, pasy: 1 },
  service: { v: 20, pas: 250, pasy: 1 },
};
const KLASA_NOWEJ = { lokalna: "tertiary", zbiorcza: "secondary", glowna: "primary" };
export const UDZIAL_SZCZYTU = 0.09; // część dobowego ruchu w godzinie szczytu (jeden kierunek podróży)
const ITERACJE = 8;
const ALFA = 0.6;
const BETA = 4;
const REJON = [0.0144, 0.009]; // ok. 1 × 1 km
const ROZPAD = 4000; // m – im dalej, tym mniej podróży
const ROZPAD_ZEWN = 8000; // m – ruch z zewnątrz sięga dalej
const WJAZD = { motorway: 15000, trunk: 10000, primary: 6000, secondary: 3000 }; // poj./dobę do miasta

const klucz = ([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

function parametry(props) {
  const hw = (props.highway || "residential").replace("_link", "");
  const K = KLASY[hw] || KLASY.residential;
  const jedno = ["yes", "1", "true"].includes(props.oneway) ? 1 : props.oneway === "-1" ? -1 : hw === "motorway" ? 1 : 0;
  const pasyOSM = parseInt(props.lanes);
  const pasyKier = jedno ? pasyOSM || K.pasyJedn || K.pasy : Math.max(1, Math.floor((pasyOSM || K.pasy * 2) / 2));
  const v = Math.min(parseInt(props.maxspeed) || K.v, K.v + 20) * (props.highway?.endsWith("_link") ? 0.8 : 1);
  return { v, cap: pasyKier * K.pas, jedno };
}

// ---------- SIEĆ ----------
// features: [{ id, geometry: LineString, properties: { highway, oneway, lanes, maxspeed } }]
// zamkniete: Set kluczy odcinków „a|b” (oba kierunki), wazne: Set kluczy węzłów, których nie łączymy
function zbudujSiec(features, zamkniete, wazneKlucze) {
  const idx = new Map();
  const wsp = [];
  const seg = []; // [u, v, długość m, nr cechy, przód, tył, v km/h, cap]
  const wezel = (c) => {
    const k = klucz(c);
    let i = idx.get(k);
    if (i === undefined) (i = wsp.length), idx.set(k, i), wsp.push(c);
    return i;
  };
  features.forEach((f, fi) => {
    const g = f.geometry;
    if (g?.type !== "LineString") return;
    const p = parametry(f.properties || {});
    const c = g.coordinates;
    for (let i = 1; i < c.length; i++) {
      const ka = klucz(c[i - 1]);
      const kb = klucz(c[i]);
      if (ka === kb) continue;
      if (zamkniete?.has(`${ka}|${kb}`) || zamkniete?.has(`${kb}|${ka}`)) continue;
      const u = wezel(c[i - 1]);
      const v = wezel(c[i]);
      seg.push([u, v, dist(c[i - 1], c[i]), fi, p.jedno >= 0, p.jedno <= 0, p.v, p.cap]);
    }
  });
  // sąsiedztwo i stopień (liczba różnych sąsiadów)
  const przy = Array.from({ length: wsp.length }, () => []);
  seg.forEach((s, i) => {
    przy[s[0]].push(i);
    przy[s[1]].push(i);
  });
  const wazny = new Uint8Array(wsp.length);
  for (let i = 0; i < wsp.length; i++) {
    const sas = new Set(przy[i].map((si) => (seg[si][0] === i ? seg[si][1] : seg[si][0])));
    if (sas.size !== 2) wazny[i] = 1;
  }
  for (const k of wazneKlucze || []) {
    const i = idx.get(k);
    if (i !== undefined) wazny[i] = 1;
  }

  // łączenie odcinków między ważnymi węzłami
  const krawedzie = []; // { a, b, len, t0, cap, przod, tyl, cechy: Map(fi → m) }
  const uzyty = new Uint8Array(seg.length);
  const idz = (start, si0) => {
    let a = start;
    let si = si0;
    const e = { a: start, b: -1, len: 0, t0: 0, capP: Infinity, capT: Infinity, przod: true, tyl: true, cechy: new Map() };
    for (let krok = 0; krok < 100000; krok++) {
      uzyty[si] = 1;
      const s = seg[si];
      const wPrzod = s[0] === a; // idziemy zgodnie z kierunkiem odcinka
      const b = wPrzod ? s[1] : s[0];
      e.len += s[2];
      e.t0 += s[2] / ((s[6] * 1000) / 3600);
      e.przod = e.przod && (wPrzod ? s[4] : s[5]);
      e.tyl = e.tyl && (wPrzod ? s[5] : s[4]);
      e.capP = Math.min(e.capP, s[7]);
      e.capT = Math.min(e.capT, s[7]);
      e.cechy.set(s[3], (e.cechy.get(s[3]) || 0) + s[2]);
      if (wazny[b]) {
        e.b = b;
        return e;
      }
      const dalej = przy[b].find((x) => !uzyty[x]);
      if (dalej === undefined) {
        e.b = b;
        return e;
      }
      a = b;
      si = dalej;
    }
    return null;
  };
  for (let i = 0; i < wsp.length; i++) {
    if (!wazny[i]) continue;
    for (const si of przy[i]) if (!uzyty[si]) {
      const e = idz(i, si);
      if (e && e.b !== e.a && (e.przod || e.tyl)) krawedzie.push(e);
    }
  }
  // łuki skierowane (CSR)
  const lukiA = [];
  for (let ei = 0; ei < krawedzie.length; ei++) {
    const e = krawedzie[ei];
    if (e.przod) lukiA.push([e.a, e.b, ei, e.capP]);
    if (e.tyl) lukiA.push([e.b, e.a, ei, e.capT]);
  }
  const n = wsp.length;
  const poczatek = new Int32Array(n + 1);
  for (const l of lukiA) poczatek[l[0] + 1]++;
  for (let i = 0; i < n; i++) poczatek[i + 1] += poczatek[i];
  const m = lukiA.length;
  const zLuk = new Int32Array(m);
  const doLuk = new Int32Array(m);
  const krawLuk = new Int32Array(m);
  const t0 = new Float64Array(m);
  const cap = new Float64Array(m);
  const wstaw = poczatek.slice(0, n);
  for (const [a, b, ei, c] of lukiA) {
    const j = wstaw[a]++;
    zLuk[j] = a;
    doLuk[j] = b;
    krawLuk[j] = ei;
    t0[j] = krawedzie[ei].t0;
    cap[j] = c;
  }
  return { wsp, idx, krawedzie, n, m, poczatek, zLuk, doLuk, krawLuk, t0, cap };
}

// Dijkstra z jednego węzła po aktualnych czasach; zwraca kolejność ustalania i łuk poprzednika
function przygotujDijkstre(S) {
  const odl = new Float64Array(S.n);
  const pop = new Int32Array(S.n);
  const znak = new Int32Array(S.n);
  const gotowy = new Int32Array(S.n);
  const kolejnosc = new Int32Array(S.n);
  let przebieg = 0;
  let hd = new Float64Array(4096);
  let hn = new Int32Array(4096);
  return function (start, czas) {
    przebieg++;
    let rozmiar = 0;
    let ile = 0;
    const wstaw = (d, v) => {
      if (rozmiar === hd.length) {
        const a = new Float64Array(rozmiar * 2);
        a.set(hd);
        hd = a;
        const b = new Int32Array(rozmiar * 2);
        b.set(hn);
        hn = b;
      }
      let i = rozmiar++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p] <= d) break;
        hd[i] = hd[p];
        hn[i] = hn[p];
        i = p;
      }
      hd[i] = d;
      hn[i] = v;
    };
    odl[start] = 0;
    pop[start] = -1;
    znak[start] = przebieg;
    wstaw(0, start);
    while (rozmiar) {
      const d = hd[0];
      const v = hn[0];
      const ld = hd[--rozmiar];
      const ln = hn[rozmiar];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= rozmiar) break;
        const mm = l + 1 < rozmiar && hd[l + 1] < hd[l] ? l + 1 : l;
        if (hd[mm] >= ld) break;
        hd[i] = hd[mm];
        hn[i] = hn[mm];
        i = mm;
      }
      hd[i] = ld;
      hn[i] = ln;
      if (gotowy[v] === przebieg || d > odl[v]) continue;
      gotowy[v] = przebieg;
      kolejnosc[ile++] = v;
      for (let k = S.poczatek[v]; k < S.poczatek[v + 1]; k++) {
        const w = S.doLuk[k];
        const nd = d + czas[k];
        if (znak[w] !== przebieg || nd < odl[w]) {
          odl[w] = nd;
          pop[w] = k;
          znak[w] = przebieg;
          wstaw(nd, w);
        }
      }
    }
    return { kolejnosc, ile, pop, odl, osiagniety: (v) => gotowy[v] === przebieg };
  };
}

// ---------- POPYT: rejony i podróże ----------
function zbudujRejony(dane, osiedla) {
  const rej = new Map();
  const dodaj = (c, os, prac) => {
    const k = `${Math.floor(c[0] / REJON[0])}:${Math.floor(c[1] / REJON[1])}`;
    const r = rej.get(k) || rej.set(k, { sx: 0, sy: 0, w: 0, os: 0, prac: 0 }).get(k);
    const w = os + prac + 1e-6;
    r.sx += c[0] * w;
    r.sy += c[1] * w;
    r.w += w;
    r.os += os;
    r.prac += prac;
  };
  for (const p of punktyMieszkancow(dane.residential, dane.boundary)) dodaj(p.c, p.os, 0);
  for (const p of miejscaPracy(dane.zones)) dodaj(p.c, 0, p.prac);
  for (const o of osiedla || []) dodaj(o.c, o.os, 0);
  return [...rej.values()].filter((r) => r.os + r.prac > 20).map((r) => ({ c: [r.sx / r.w, r.sy / r.w], os: r.os, prac: r.prac }));
}

// wjazdy spoza miasta: drogi główne przecinające granicę (zewnętrzny koniec odcinka)
function zbudujWjazdy(roads, boundary) {
  const miasto = boundary?.features?.[0]?.geometry;
  if (!miasto) return [];
  const out = [];
  for (const f of roads?.features || []) {
    const hw = f.properties.highway || "";
    if (!WJAZD[hw] || f.geometry?.type !== "LineString") continue;
    const c = f.geometry.coordinates;
    const a = wWielokacie(c[0], miasto);
    const b = wWielokacie(c[c.length - 1], miasto);
    if (a === b) continue;
    const zewn = a ? c[c.length - 1] : c[0];
    if (out.some((w) => dist(w.c, zewn) < 1500)) continue; // dwie jezdnie tej samej drogi
    out.push({ c: zewn, ruch: WJAZD[hw], nazwa: f.properties.ref || f.properties.name || "" });
  }
  return out;
}

// ---------- SCENARIUSZ Z INWESTYCJI ----------
// Do modelu ruchu trafiają: nowe drogi, zamknięcia ulic i nowe osiedla (nowe podróże).
// P&R i linie komunikacji liczy dalej uproszczony model w traffic.js.
const RUCHOWE = new Set(["droga", "zamkniecie", "osiedle"]);
const coordsLinii = (g) => (g?.geometry || g)?.coordinates;
function srodekWielokata(g) {
  const geo = g?.geometry || g;
  const ring = geo?.type === "Polygon" ? geo.coordinates[0] : geo?.type === "MultiPolygon" ? geo.coordinates[0][0] : null;
  if (!ring?.length) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of ring) (sx += x), (sy += y);
  return [sx / ring.length, sy / ring.length];
}

export const czyRuchowa = (inv) => RUCHOWE.has(inv?.typ);

export function scenariuszZInwestycji(investments) {
  const sc = { noweDrogi: [], zamkniete: [], osiedla: [] };
  for (const inv of investments || []) {
    if (inv.typ === "droga") sc.noweDrogi.push({ id: inv.id, coords: coordsLinii(inv.geometry), klasa: inv.params?.klasa });
    else if (inv.typ === "zamkniecie") sc.zamkniete.push(coordsLinii(inv.geometry));
    else if (inv.typ === "osiedle") {
      const c = srodekWielokata(inv.geometry);
      if (c) sc.osiedla.push({ c, os: (inv.params?.mieszkania || 0) * z("osobNaMieszkanie") });
    }
  }
  return sc;
}

// Klucz scenariusza: te same drogi / zamknięcia / osiedla = ten sam wynik (bez liczenia od nowa)
export function kluczScenariusza(investments) {
  const r = (investments || []).filter(czyRuchowa);
  if (!r.length) return "";
  const s = JSON.stringify(
    r.map((i) => [i.typ, coordsLinii(i.geometry), i.typ === "droga" ? i.params?.klasa : i.typ === "osiedle" ? i.params?.mieszkania : 0, i.id])
  );
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${r.length}:${s.length}:${h}`;
}

// ---------- PRZYPISANIE RUCHU ----------
// scenariusz: { noweDrogi: [{ id, coords, klasa }], zamkniete: [coords...], osiedla: [{ c, os }] }
export function przypiszRuch(dane, scenariusz = {}, { iteracje = ITERACJE } = {}) {
  const t00 = performance.now();
  const { roads, streets, boundary } = dane;
  const nowe = (scenariusz.noweDrogi || []).filter((d) => d.coords?.length >= 2);
  // nowa droga dołącza do sieci w najbliższych węzłach (jej końce „przyklejamy” do istniejących punktów)
  const bazowe = [...(roads?.features || []), ...(streets?.features || [])];
  const punktySieci = new Map();
  const OKO = 0.002;
  for (const f of bazowe)
    if (f.geometry?.type === "LineString" && !/motorway|trunk/.test(f.properties.highway || ""))
      for (const c of f.geometry.coordinates) {
        const k = `${Math.floor(c[0] / OKO)}:${Math.floor(c[1] / OKO)}`;
        (punktySieci.get(k) || punktySieci.set(k, []).get(k)).push(c);
      }
  const przyklej = (c) => {
    let best = null;
    const cx = Math.floor(c[0] / OKO);
    const cy = Math.floor(c[1] / OKO);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const p of punktySieci.get(`${cx + i}:${cy + j}`) || []) {
          const d = dist(c, p);
          if (d < 120 && (!best || d < best.d)) best = { d, p };
        }
    return best ? best.p : c;
  };
  const noweCechy = nowe.map((d) => {
    const coords = [...d.coords];
    coords[0] = przyklej(coords[0]);
    coords[coords.length - 1] = przyklej(coords[coords.length - 1]);
    return { id: `nowa:${d.id}`, nowa: d.id, geometry: { type: "LineString", coordinates: coords }, properties: { highway: KLASA_NOWEJ[d.klasa] || d.klasa || "secondary" } };
  });
  const cechy = [...bazowe, ...noweCechy];
  // zamknięte: odcinki ulic leżące wzdłuż narysowanego zamknięcia (oba końce odcinka do 12 m od linii)
  const zamkniete = new Set();
  const lz = (scenariusz.zamkniete || []).filter((c) => c?.length >= 2);
  if (lz.length) {
    const pkt = new Map();
    const OZ = 0.0004;
    for (const c of lz)
      for (let i = 1; i < c.length; i++) {
        const n = Math.max(1, Math.ceil(dist(c[i - 1], c[i]) / 4));
        for (let k = 0; k <= n; k++) {
          const p = [c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * k) / n, c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * k) / n];
          const kk = `${Math.floor(p[0] / OZ)}:${Math.floor(p[1] / OZ)}`;
          (pkt.get(kk) || pkt.set(kk, []).get(kk)).push(p);
        }
      }
    const blisko = (c) => {
      const cx = Math.floor(c[0] / OZ);
      const cy = Math.floor(c[1] / OZ);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of pkt.get(`${cx + i}:${cy + j}`) || []) if (dist(c, p) <= 12) return true;
      return false;
    };
    for (const f of bazowe) {
      const c = f.geometry?.coordinates;
      if (f.geometry?.type !== "LineString") continue;
      for (let i = 1; i < c.length; i++) if (blisko(c[i - 1]) && blisko(c[i])) zamkniete.add(`${klucz(c[i - 1])}|${klucz(c[i])}`);
    }
  }

  // rejony i wjazdy → węzły podłączenia
  const rejony = zbudujRejony(dane, scenariusz.osiedla);
  const wjazdy = zbudujWjazdy(roads, boundary);
  const kandydaci = new Map();
  for (const f of bazowe) {
    if (f.geometry?.type !== "LineString" || /motorway|trunk|_link|service/.test(f.properties.highway || "")) continue;
    for (const c of f.geometry.coordinates) {
      const k = `${Math.floor(c[0] / OKO)}:${Math.floor(c[1] / OKO)}`;
      (kandydaci.get(k) || kandydaci.set(k, []).get(k)).push(c);
    }
  }
  const podlacz = (c, r = 3) => {
    let best = null;
    const cx = Math.floor(c[0] / OKO);
    const cy = Math.floor(c[1] / OKO);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        for (const p of kandydaci.get(`${cx + i}:${cy + j}`) || []) {
          const d = dist(c, p);
          if (!best || d < best.d) best = { d, p };
        }
    return best?.p;
  };
  const strefy = [];
  for (const r of rejony) {
    const p = podlacz(r.c);
    if (p) strefy.push({ ...r, k: klucz(p) });
  }
  for (const w of wjazdy) {
    // wjazd: najbliższy punkt dowolnej drogi głównej (sam koniec odcinka)
    strefy.push({ c: w.c, os: 0, prac: 0, zewn: w.ruch, k: klucz(w.c), nazwa: w.nazwa });
  }

  const S = zbudujSiec(cechy, zamkniete, new Set(strefy.map((s) => s.k)));
  // tylko strefy w największej spójnej części sieci
  const dijkstra = przygotujDijkstre(S);
  const czas = S.t0.slice();
  const wezlyStref = strefy.map((s) => S.idx.get(s.k) ?? -1);

  // macierz podróży (doba): mieszkańcy → (0,4·mieszkańcy + praca), skalowana do liczby podróży autem
  const N = strefy.length;
  const P = strefy.map((s) => s.os);
  const A = strefy.map((s) => 0.4 * s.os + s.prac);
  // odległość między rejonami; w obrębie rejonu ok. 450 m – te krótkie podróże zostają w rejonie
  // (nie trafiają na sieć), ale wchodzą do sumy, żeby nie przerzucać ich na drogi główne
  const D = (o, d) => (o === d ? 450 : dist(strefy[o].c, strefy[d].c));
  let suma = 0;
  for (let o = 0; o < N; o++) if (P[o] && !strefy[o].zewn) for (let d = 0; d < N; d++) if (!strefy[d].zewn) suma += P[o] * A[d] * Math.exp(-D(o, d) / ROZPAD);
  const podroze = P.reduce((a, b) => a + b, 0) * z("podrozyNaOsobe") * z("udzialAuta");
  const K = suma ? podroze / suma : 0;
  // ruch zewnętrzny: wjazd → cele w mieście (i z powrotem)
  const sumaA = (o) => {
    let s = 0;
    for (let d = 0; d < N; d++) if (!strefy[d].zewn) s += A[d] * Math.exp(-D(o, d) / ROZPAD_ZEWN);
    return s;
  };
  const zewnSumy = strefy.map((s, o) => (s.zewn ? sumaA(o) : 0));
  const T = (o, d) => {
    if (o === d) return 0;
    const so = strefy[o];
    const sd = strefy[d];
    if (so.zewn && sd.zewn) return 0;
    if (so.zewn) return (so.zewn * A[d] * Math.exp(-D(o, d) / ROZPAD_ZEWN)) / zewnSumy[o];
    if (sd.zewn) return (sd.zewn * A[o] * Math.exp(-D(o, d) / ROZPAD_ZEWN)) / zewnSumy[d];
    // tam i z powrotem: podróż z domu do celu i powrót są już w „podróżach na osobę” – średnia z obu kierunków
    return (K * (P[o] * A[d] + P[d] * A[o]) * Math.exp(-D(o, d) / ROZPAD)) / 2;
  };
  // macierz w godzinie szczytu (raz)
  const OD = new Float64Array(N * N);
  for (let o = 0; o < N; o++) for (let d = 0; d < N; d++) OD[o * N + d] = T(o, d) * UDZIAL_SZCZYTU;

  // MSA: przepływy w szczycie na łukach
  let przeplyw = new Float64Array(S.m);
  const ladunek = new Float64Array(S.n);
  for (let it = 1; it <= iteracje; it++) {
    const aux = new Float64Array(S.m);
    for (let o = 0; o < N; o++) {
      const wo = wezlyStref[o];
      if (wo < 0) continue;
      const r = dijkstra(wo, czas);
      for (let d = 0; d < N; d++) {
        const wd = wezlyStref[d];
        const t = OD[o * N + d];
        if (wd >= 0 && t > 0 && r.osiagniety(wd)) ladunek[wd] += t;
      }
      for (let i = r.ile - 1; i > 0; i--) {
        const v = r.kolejnosc[i];
        const l = ladunek[v];
        if (!l) continue;
        ladunek[v] = 0;
        const k = r.pop[v];
        aux[k] += l;
        ladunek[S.zLuk[k]] += l;
      }
      ladunek[wo] = 0;
    }
    const a = 1 / it;
    for (let k = 0; k < S.m; k++) przeplyw[k] = (1 - a) * przeplyw[k] + a * aux[k];
    for (let k = 0; k < S.m; k++) czas[k] = S.t0[k] * (1 + ALFA * (przeplyw[k] / S.cap[k]) ** BETA);
  }

  // wyniki: ruch dobowy na cechach (obie strony razem), szczyt w kierunku dominującym
  const sdrCechy = new Map(); // id cechy → { sdr, vc }
  const sumyKraw = new Float64Array(S.krawedzie.length);
  const maksVc = new Float64Array(S.krawedzie.length);
  let pojKm = 0;
  let pojH = 0;
  for (let k = 0; k < S.m; k++) {
    const e = S.krawLuk[k];
    sumyKraw[e] += przeplyw[k];
    maksVc[e] = Math.max(maksVc[e], przeplyw[k] / S.cap[k]);
    pojKm += (przeplyw[k] * S.krawedzie[e].len) / 1000;
    pojH += (przeplyw[k] * czas[k]) / 3600;
  }
  const akum = new Map();
  S.krawedzie.forEach((e, ei) => {
    for (const [fi, len] of e.cechy) {
      const a = akum.get(fi) || akum.set(fi, { s: 0, l: 0, vc: 0 }).get(fi);
      a.s += (sumyKraw[ei] / UDZIAL_SZCZYTU) * len;
      a.l += len;
      a.vc = Math.max(a.vc, maksVc[ei]);
    }
  });
  const noweSdr = {};
  for (const [fi, a] of akum) {
    const f = cechy[fi];
    const sdr = a.s / a.l;
    if (f.nowa) noweSdr[f.nowa] = Math.round(sdr);
    else sdrCechy.set(f.properties.id, { sdr: Math.round(sdr), vc: a.vc });
  }
  return {
    sdr: sdrCechy,
    nowe: noweSdr,
    sumy: { pojKmSzczyt: pojKm, pojHSzczyt: pojH, podrozeDoba: podroze, strefy: N, wjazdy: wjazdy.length },
    czasLiczenia: Math.round(performance.now() - t00),
    siec: { wezly: S.n, luki: S.m },
  };
}
