// AUTOMATYCZNE PRZYSTANKI NOWEJ LINII
// Zasady (jak przy projektowaniu linii w praktyce):
//  - przystanki co ok. 350–700 m (cel: założenie „odstęp przystanków”),
//  - nie na skrzyżowaniu: co najmniej 35 m od węzła, w którym spotykają się ulice,
//  - tylko tam, gdzie jest popyt w promieniu 400 m: zabudowa mieszkaniowa, strefy pracy,
//    szkoły, szpitale, istniejące przystanki lub nowe osiedla – nie „na łące”,
//  - jeśli linia przechodzi obok istniejącego przystanku (≤ 40 m), korzystamy z niego (przesiadka),
//  - przystanki końcowe na obu końcach trasy.
import * as turf from "@turf/turf";
import { dist, zbudujSiatke, siecDrogowa, doSkrzyzowania } from "./network.js";
import { z } from "./config.js";

const KROK = 20; // m – co ile sprawdzamy położenie na trasie
const MIN_OD_SKRZ = 35; // m
const PROMIEN_POPYTU = 400; // m
const PROG_POPYTU = 3; // minimalny popyt, żeby postawić przystanek
const DO_ISTNIEJACEGO = 40; // m

// Punkty popytu z wagami (liczone raz dla danych + osiedli z wariantu)
let cachePopytu = { data: null, klucz: null, p: null };
function punktyPopytu(data, osiedla = []) {
  const klucz = osiedla.map((o) => o.id + JSON.stringify(o.geometry.geometry?.coordinates?.[0]?.[0])).join("|");
  if (cachePopytu.data === data && cachePopytu.klucz === klucz) return cachePopytu.p;
  const wsp = [];
  const waga = [];
  const dodaj = (c, w) => {
    wsp.push(c);
    waga.push(w);
  };
  // zabudowa mieszkaniowa: wierzchołki obrysu (maks. 40 na obszar), waga ~ powierzchnia
  for (const f of data.residential?.features || []) {
    try {
      const ha = Math.min(15, turf.area(f) / 1e4);
      const pts = turf.coordAll(f);
      const krok = Math.max(1, Math.ceil(pts.length / 40));
      const n = Math.ceil(pts.length / krok);
      for (let i = 0; i < pts.length; i += krok) dodaj(pts[i], (ha * 1.2) / n);
      dodaj(turf.centroid(f).geometry.coordinates, ha * 0.4);
    } catch {
      /* uszkodzona geometria */
    }
  }
  for (const f of data.zones?.features || []) {
    try {
      dodaj(turf.centroid(f).geometry.coordinates, Math.min(8, turf.area(f) / 1e4) * 0.6);
    } catch {
      /* pomijamy */
    }
  }
  for (const f of data.schools?.features || []) dodaj(f.geometry.coordinates, 4);
  for (const f of data.hospitals?.features || []) dodaj(f.geometry.coordinates, 6);
  for (const f of data.stops?.features || []) dodaj(f.geometry.coordinates, 1.5);
  for (const o of osiedla) {
    try {
      const w = (o.params?.mieszkania || 400) / 60;
      dodaj(turf.centroid(o.geometry).geometry.coordinates, w);
      for (const c of turf.coordAll(o.geometry)) dodaj(c, w / 4);
    } catch {
      /* pomijamy */
    }
  }
  const p = { wsp, waga, siatka: zbudujSiatke(wsp) };
  cachePopytu = { data, klucz, p };
  return p;
}

function popyt(p, c) {
  let s = 0;
  for (const i of p.siatka.obok(c, 6)) if (dist(c, p.wsp[i]) <= PROMIEN_POPYTU) s += p.waga[i];
  return s;
}

let cacheIst = { stops: null, s: null };
function siatkaIstniejacych(stops) {
  if (cacheIst.stops === stops) return cacheIst.s;
  const f = stops?.features || [];
  const s = { f, siatka: zbudujSiatke(f.map((x) => x.geometry.coordinates)) };
  cacheIst = { stops, s };
  return s;
}

// Punkty co KROK metrów wzdłuż linii: [{ c, d }]
function probki(coords) {
  const out = [{ c: coords[0], d: 0 }];
  let d = 0;
  let nastepny = KROK;
  for (let k = 0; k < coords.length - 1; k++) {
    const a = coords[k];
    const b = coords[k + 1];
    const L = dist(a, b);
    while (nastepny <= d + L) {
      const t = (nastepny - d) / L;
      out.push({ c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: nastepny });
      nastepny += KROK;
    }
    d += L;
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1].d < d - 1) out.push({ c: last, d });
  return { out, dl: d };
}

function nazwaPrzy(siec, c) {
  if (!siec) return "";
  let best = null;
  for (const i of siec.siatka.obok(c, 1)) {
    if (!siec.nazwa[i]) continue;
    const d = dist(c, siec.wsp[i]);
    if (!best || d < best.d) best = { d, n: siec.nazwa[i] };
  }
  return best?.n || "";
}

// Główna funkcja: linia (Feature LineString) -> lista przystanków
// [{ coords: [lon, lat], nazwa, istniejacy: bool, popyt }]
export function wyznaczPrzystanki(linia, data, { osiedla = [] } = {}) {
  const coords = (linia.geometry || linia).coordinates;
  if (!coords || coords.length < 2) return [];
  const siec = siecDrogowa(data);
  const p = punktyPopytu(data, osiedla);
  const ist = siatkaIstniejacych(data.stops);
  const { out, dl } = probki(coords);
  const docelowy = z("odstepPrzystankow");
  const minOdstep = Math.max(250, docelowy * 0.7);
  const maxOdstep = docelowy * 1.4;

  // ocena każdej próbki
  const oc = out.map(({ c, d }) => {
    let istn = null;
    for (const i of ist.siatka.obok(c, 1)) {
      const dd = dist(c, ist.f[i].geometry.coordinates);
      if (dd <= DO_ISTNIEJACEGO && (!istn || dd < istn.d)) istn = { d: dd, f: ist.f[i] };
    }
    const skrz = siec ? doSkrzyzowania(siec, c) : Infinity;
    const pop = popyt(p, c);
    return { c, d, istn, skrz, pop, ok: (skrz >= MIN_OD_SKRZ || istn) && pop >= PROG_POPYTU };
  });

  const przystanek = (o) =>
    o.istn
      ? { coords: o.istn.f.geometry.coordinates, nazwa: o.istn.f.properties.name || "Przystanek", istniejacy: true, popyt: o.pop, d: o.d }
      : { coords: o.c, nazwa: nazwaPrzy(siec, o.c) || "Nowy przystanek", istniejacy: false, popyt: o.pop, d: o.d };

  // pętla początkowa: pierwsze dobre miejsce w pierwszych 120 m (albo sam początek)
  const wynik = [];
  const start = oc.find((o) => o.d <= 120 && (o.skrz >= MIN_OD_SKRZ || o.istn)) || oc[0];
  wynik.push(przystanek(start));
  let ostatni = start.d;

  for (;;) {
    if (dl - ostatni < minOdstep + 150) break;
    // najlepsze miejsce w oknie [min, max] od poprzedniego przystanku
    const okno = oc.filter((o) => o.ok && o.d >= ostatni + minOdstep && o.d <= ostatni + maxOdstep && o.d <= dl - 150);
    let wyb = null;
    for (const o of okno) {
      const kara = Math.abs(o.d - ostatni - docelowy) / docelowy;
      const s = Math.log(1 + o.pop) * (1 - 0.6 * kara) + (o.istn ? 1.5 : 0) + (o.skrz > 60 ? 0.2 : 0);
      if (!wyb || s > wyb.s) wyb = { o, s };
    }
    if (!wyb) {
      // pusty odcinek (brak popytu) – szukamy dalej, bez przystanku „na łące”
      const dalej = oc.find((o) => o.ok && o.d > ostatni + maxOdstep && o.d <= dl - 150);
      if (!dalej) break;
      wyb = { o: dalej };
    }
    wynik.push(przystanek(wyb.o));
    ostatni = wyb.o.d;
  }

  // pętla końcowa
  const koniec = [...oc].reverse().find((o) => o.d >= dl - 120 && (o.skrz >= MIN_OD_SKRZ || o.istn)) || oc[oc.length - 1];
  if (koniec.d - ostatni < 200 && wynik.length > 1) wynik.pop();
  if (koniec.d - (wynik[wynik.length - 1]?.d ?? -1e9) > 1) wynik.push(przystanek(koniec));

  // te same istniejące przystanki tylko raz (perony „01”, „02” jednego przystanku = jeden przystanek)
  const widziane = new Set();
  return wynik.filter((s) => {
    const k = s.istniejacy ? s.nazwa.replace(/\s*(nż\.?)?\s*\d+$/i, "").trim() : s.coords.join(",");
    if (widziane.has(k)) return false;
    widziane.add(k);
    return true;
  });
}

// Ręcznie kliknięty punkt -> najbliższy punkt na trasie (z nazwą ulicy)
export function przystanekNaTrasie(linia, klik, data) {
  const np = turf.nearestPointOnLine(linia, turf.point(klik), { units: "meters" });
  const c = np.geometry.coordinates;
  const siec = siecDrogowa(data);
  const ist = siatkaIstniejacych(data.stops);
  for (const i of ist.siatka.obok(c, 1)) {
    if (dist(c, ist.f[i].geometry.coordinates) <= DO_ISTNIEJACEGO)
      return { coords: ist.f[i].geometry.coordinates, nazwa: ist.f[i].properties.name || "Przystanek", istniejacy: true, d: np.properties.location };
  }
  return {
    coords: c,
    nazwa: nazwaPrzy(siec, c) || "Nowy przystanek",
    istniejacy: false,
    d: np.properties.location,
    uwaga: siec && doSkrzyzowania(siec, c) < MIN_OD_SKRZ ? "na skrzyżowaniu" : popyt(punktyPopytu(data), c) < PROG_POPYTU ? "brak zabudowy w 400 m" : null,
  };
}
