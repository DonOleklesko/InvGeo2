// PROPOZYCJE ZMIAN W KOMUNIKACJI AUTOBUSOWEJ
// Jak w planowaniu transportu: linia ma dowozić ludzi tam, dokąd jeżdżą (centrum, węzły,
// miejsca pracy), bez przesiadki i bez dublowania istniejących linii. Krótkie „wyrostki”
// od przystanku do sąsiedniego osiedla nie mają sensu – szybciej dojść pieszo.
//
//  1) Luki w obsłudze: zabudowa mieszkaniowa dalej niż 500 m od przystanku z jakąkolwiek linią;
//     sąsiednie punkty łączymy w obszary. Liczą się tylko obszary z ok. 1200+ mieszkańcami
//     i „rdzeniem” dalej niż 650 m od przystanku (mała dziura w zasięgu to nie luka).
//  2) Najpierw PRZEDŁUŻENIE istniejącej linii autobusowej od jej pętli (końca trasy) do 2,5 km
//     od luki – najtańsze i daje dojazd bez przesiadki tam, dokąd linia już jedzie.
//  3) Gdy żadna linia nie kończy się w pobliżu – NOWA LINIA z luki do celu: centrum miasta,
//     dużego węzła przesiadkowego (≥ 8 linii lub tramwaj) albo dużej strefy pracy;
//     3–14 km, bez jazdy w większości po trasach istniejących linii.
//  4) Trasy po drogach odpowiednich dla autobusu (network.js), bez dróg przez pola,
//     bez dużych objazdów.
//  5) Ocena: szacowani nowi pasażerowie dziennie na 1 km nowej trasy (co najmniej 200);
//     kolejne propozycje nie liczą mieszkańców obsłużonych przez wcześniejsze.
import { MIASTO } from "../data/miasta.js";
import { siecDrogowa, najblizszyWezel, trasa, przyZabudowie, dist } from "./network.js";
import { lineLabel } from "../data/lineColors.js";
import { z } from "./config.js";
import { punktyMieszkancow, miejscaPracy, siatkaPunktow } from "./popyt.js";

const ZASIEG = 500; // m – mieszkaniec „obsłużony”, gdy przystanek jest bliżej
const RDZEN = 650; // m – luka musi mieć punkty tak daleko od przystanku
const ZASIEG_NOWEJ = 450; // m – zasięg przystanków nowego odcinka
const MIN_MIESZK = 1200; // mieszkańców w luce
const MIN_NOWI = 900; // mieszkańców, których propozycja musi obsłużyć
const DO_PETLI = 2500; // m – pętla istniejącej linii najdalej tyle od luki (w linii prostej)
const PRZEDL_MAKS = 4000; // m – najdłuższe przedłużenie
const NOWA_MIN = 3000; // m
const NOWA_MAKS = 14000; // m
const MAKS_OBJAZD = 1.9; // długość trasy / odległość w linii prostej
const MAKS_POZA_ZABUDOWA = 0.35;
const MAKS_DUBLOWANIA_NOWEJ = 0.6; // nowa linia może jechać po trasach istniejących najwyżej w 60%
const MAX_PROPOZYCJI = 6;
const MAKS_CELOW = 5; // ile celów nowej linii sprawdzamy dla jednej luki
const MIN_NA_KM = 200; // przejazdów dziennie na 1 km nowej trasy – mniej się nie opłaca

// Końce trasy linii (pętle): wierzchołki geometrii, z których wychodzi tylko jeden odcinek
function konceLinii(f) {
  const odc = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];
  const st = new Map();
  const k = (c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
  for (const o of odc)
    for (let i = 1; i < o.length; i++) {
      for (const c of [o[i - 1], o[i]]) {
        const kk = k(c);
        const e = st.get(kk) || st.set(kk, { c, n: 0 }).get(kk);
        e.n++;
      }
    }
  return [...st.values()].filter((e) => e.n === 1).map((e) => e.c);
}

function probkuj(coords, krok = 25) {
  const out = [];
  for (let i = 1; i < coords.length; i++) {
    const n = Math.max(1, Math.ceil(dist(coords[i - 1], coords[i]) / krok));
    for (let k = 0; k < n; k++)
      out.push([coords[i - 1][0] + ((coords[i][0] - coords[i - 1][0]) * k) / n, coords[i - 1][1] + ((coords[i][1] - coords[i - 1][1]) * k) / n]);
  }
  if (coords.length) out.push(coords[coords.length - 1]);
  return out;
}
const dlugosc = (coords) => {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += dist(coords[i - 1], coords[i]);
  return d;
};

// dane: { roads, streets, residential, zones, stops (z liniami), lines, boundary }
export function proponujLinie(dane) {
  const t0 = performance.now();
  const { residential, zones, stops, lines, boundary } = dane || {};
  if (!residential?.features?.length || !stops?.features?.length || !boundary?.features?.length) return [];
  const siec = siecDrogowa(dane);
  if (!siec) return [];

  // --- 1) luki w obsłudze ---
  const mieszk = punktyMieszkancow(residential, boundary);
  const zLiniami = stops.features.filter((f) => f.properties.linie?.length).map((f) => ({ c: f.geometry.coordinates, f }));
  const przystObok = siatkaPunktow(zLiniami);
  for (const p of mieszk) {
    let d = Infinity;
    for (const s of przystObok(p.c)) d = Math.min(d, dist(p.c, s.c));
    p.doPrzyst = d;
  }
  const bez = mieszk.filter((p) => p.doPrzyst > ZASIEG);
  const klucz = (c) => `${Math.round(c[0] / 0.0018)}:${Math.round(c[1] / 0.0011)}`;
  const poKluczu = new Map(bez.map((p) => [klucz(p.c), p]));
  const luki = [];
  const odwiedzone = new Set();
  for (const p of bez) {
    const k0 = klucz(p.c);
    if (odwiedzone.has(k0)) continue;
    const obszar = [];
    const stos = [k0];
    odwiedzone.add(k0);
    while (stos.length) {
      const k = stos.pop();
      obszar.push(poKluczu.get(k));
      const [kx, ky] = k.split(":").map(Number);
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) {
          const kk = `${kx + i}:${ky + j}`;
          if (!odwiedzone.has(kk) && poKluczu.has(kk)) odwiedzone.add(kk), stos.push(kk);
        }
    }
    const os = obszar.reduce((a, q) => a + q.os, 0);
    const rdzen = obszar.filter((q) => q.doPrzyst > RDZEN).reduce((a, q) => a + q.os, 0);
    if (os >= MIN_MIESZK && rdzen >= MIN_MIESZK / 3) {
      const sr = [0, 1].map((i) => obszar.reduce((a, q) => a + q.c[i] * q.os, 0) / os);
      luki.push({ punkty: obszar, os, sr });
    }
  }
  if (!luki.length) {
    console.info(`Propozycje linii: brak luk w obsłudze (${Math.round(performance.now() - t0)} ms)`);
    return [];
  }

  // --- istniejące trasy (do oceny dublowania) i pętle linii autobusowych ---
  const punktyLinii = [];
  const petle = [];
  for (const l of lines?.features || []) {
    const odc = l.geometry.type === "MultiLineString" ? l.geometry.coordinates : [l.geometry.coordinates];
    for (const o of odc) for (const c of probkuj(o, 20)) punktyLinii.push({ c, l });
    // przedłużamy tylko linie podstawowe (numer bez liter) – „61z”, „54S” to warianty kursów
    if (l.properties.mode === "bus" && !l.properties.nocna && /^\d+$/.test(l.properties.ref)) for (const c of konceLinii(l)) petle.push({ c, l });
  }
  const linieObok = siatkaPunktow(punktyLinii, 0.001);
  const naIstniejacej = (c) => linieObok(c).some((q) => dist(c, q.c) <= 25);
  const bezObok = siatkaPunktow(bez, 0.008);

  // --- cele nowych linii: centrum, duże węzły, duże strefy pracy ---
  const centrum = [MIASTO.centrum[1], MIASTO.centrum[0]];
  const cele = [{ c: centrum, nazwa: "centrum", waga: 3, centrum: true }];
  for (const s of zLiniami) {
    const n = s.f.properties.linie.length;
    if (n >= 8 || s.f.properties.linie.some((l) => l.startsWith("tram:"))) cele.push({ c: s.c, nazwa: s.f.properties.name || "węzeł", waga: Math.min(2, n / 8) });
  }
  const praca = miejscaPracy(zones).sort((a, b) => b.prac - a.prac).slice(0, 8);
  for (const p of praca) if (p.prac >= 1500) cele.push({ c: p.c, nazwa: p.nazwa || "strefa pracy", waga: Math.min(2, p.prac / 3000), praca: true });

  const wezel = (c, maks = 350) => najblizszyWezel(siec, c, { maks });
  const sciezka = (a, b) => {
    const r = a && b ? trasa(siec, a.i, b.i, { autobus: true }) : null;
    return r ? r.map((i) => siec.wsp[i]) : null;
  };
  const polacz = (...czesci) => {
    const out = [];
    for (const cz of czesci) for (const c of cz || []) if (!out.length || out[out.length - 1] !== c) out.push(c);
    return out;
  };
  // wspólna ocena trasy: tereny otwarte, objazd, dublowanie, nowi mieszkańcy w zasięgu
  const ocenTrase = (coords, odMetra = 0) => {
    const dl = dlugosc(coords);
    const pr = probkuj(coords);
    const poza = pr.filter((c) => !przyZabudowie(siec.zab, c, 1)).length / pr.length;
    const dubl = pr.filter(naIstniejacej).length / pr.length;
    const nowi = new Set();
    let d = 0;
    for (let i = 0; i < pr.length; i++) {
      if (i) d += dist(pr[i - 1], pr[i]);
      if (d < odMetra || i % 4) continue; // co ok. 100 m, poza początkiem (np. istniejącą trasą)
      for (const p of bezObok(pr[i])) if (dist(p.c, pr[i]) <= ZASIEG_NOWEJ) nowi.add(p);
    }
    return { dl, poza, dubl, nowi };
  };

  // --- 2) i 3) kandydaci dla każdej luki ---
  const kandydaci = [];
  for (const luka of luki) {
    const wSrodku = wezel(luka.sr) || wezel(luka.punkty.reduce((b, p) => (dist(p.c, luka.sr) < dist(b.c, luka.sr) ? p : b)).c);
    if (!wSrodku) continue;
    const najdalej = (od) => wezel(luka.punkty.reduce((b, p) => (dist(p.c, od) > dist(b.c, od) ? p : b)).c);

    // przedłużenia: pętle linii autobusowych w zasięgu
    const blisko = petle
      .map((p) => ({ ...p, d: dist(p.c, luka.sr) }))
      .filter((p) => p.d <= DO_PETLI)
      .sort((a, b) => a.d - b.d);
    const sprawdzone = new Set();
    for (const p of blisko) {
      if (sprawdzone.has(p.l) || sprawdzone.size >= 4) continue;
      sprawdzone.add(p.l);
      const start = wezel(p.c, 200);
      const koniec = najdalej(p.c);
      if (!start) continue;
      const coords = polacz(sciezka(start, wSrodku), koniec && koniec.i !== wSrodku.i ? sciezka(wSrodku, koniec) : null);
      if (coords.length < 2) continue;
      const o = ocenTrase(coords, 150);
      const prosta = dist(coords[0], coords[coords.length - 1]);
      if (o.dl < 400 || o.dl > PRZEDL_MAKS || o.poza > MAKS_POZA_ZABUDOWA || (prosta > 300 && o.dl / prosta > MAKS_OBJAZD + 0.4)) continue;
      kandydaci.push({ typ: "przedluzenie", luka, wSrodku, linia: p.l, coords, ...o, koszt: o.dl });
    }

    // nowa linia: z luki do celu
    const celeLuki = cele
      .map((cel) => ({ cel, d: dist(cel.c, luka.sr) }))
      .filter(({ d }) => d >= 2000 && d <= NOWA_MAKS / 1.3)
      .sort((a, b) => (b.cel.centrum ? 1 : 0) - (a.cel.centrum ? 1 : 0) || a.d / a.cel.waga - b.d / b.cel.waga)
      .slice(0, MAKS_CELOW);
    for (const { cel } of celeLuki) {
      const doCelu = wezel(cel.c);
      const poczatek = najdalej(cel.c);
      if (!doCelu) continue;
      const coords = polacz(poczatek && poczatek.i !== wSrodku.i ? sciezka(poczatek, wSrodku) : null, sciezka(wSrodku, doCelu));
      if (coords.length < 2) continue;
      const o = ocenTrase(coords);
      const prosta = dist(coords[0], coords[coords.length - 1]);
      if (o.dl < NOWA_MIN || o.dl > NOWA_MAKS || o.poza > MAKS_POZA_ZABUDOWA || o.dubl > MAKS_DUBLOWANIA_NOWEJ || o.dl / prosta > MAKS_OBJAZD) continue;
      // nowa linia wymaga własnych autobusów – liczymy ją drożej niż przedłużenie
      kandydaci.push({ typ: "nowa", luka, wSrodku, cel, coords, ...o, koszt: o.dl * 1.6 / cel.waga });
    }
  }

  // --- 5) wybór: najwięcej nowych pasażerów na km, bez liczenia tych samych mieszkańców dwa razy ---
  const pasazerowie = (os) => os * z("podrozyNaOsobe") * z("udzialKomunikacji");
  const obsluzone = new Set();
  const wybrane = [];
  const zLuk = new Set();
  const pula = [...kandydaci];
  while (wybrane.length < MAX_PROPOZYCJI && pula.length) {
    let best = null;
    for (const k of pula) {
      if (zLuk.has(k.luka)) continue; // jedna propozycja na lukę
      let os = 0;
      for (const p of k.nowi) if (!obsluzone.has(p)) os += p.os;
      if (os < MIN_NOWI || pasazerowie(os) / (k.dl / 1000) < MIN_NA_KM) continue;
      const wynik = pasazerowie(os) / (k.koszt / 1000);
      if (!best || wynik > best.wynik) best = { k, os, wynik };
    }
    if (!best) break;
    pula.splice(pula.indexOf(best.k), 1);
    zLuk.add(best.k.luka);
    for (const p of best.k.nowi) obsluzone.add(p);
    wybrane.push(best);
  }

  const nazwaUlicy = (c) => {
    let b = null;
    for (const i of siec.siatka.obok(c, 2)) if (siec.nazwa[i] && (!b || dist(c, siec.wsp[i]) < b.d)) b = { d: dist(c, siec.wsp[i]), n: siec.nazwa[i] };
    return b?.n || "osiedle";
  };
  const fmt = (n) => (Math.round(n / 100) * 100).toLocaleString("pl-PL");
  const wynik = wybrane.map(({ k, os }, i) => {
    const koniec = k.coords[k.coords.length - 1];
    const osiedle = nazwaUlicy(siec.wsp[k.wSrodku.i]);
    const pas = pasazerowie(os);
    const geometry = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: k.coords } };
    const wspolne = `Szacunkowo ${fmt(os)} mieszkańców zyska przystanek bliżej niż ${ZASIEG_NOWEJ} m (dziś ponad ${ZASIEG} m), ok. ${fmt(pas)} przejazdów dziennie.`;
    if (k.typ === "przedluzenie") {
      const etykieta = lineLabel(k.linia.properties);
      return {
        id: `przedl-${k.linia.properties.id}-${klucz(koniec)}`,
        rodzaj: "linia",
        typLinii: "przedluzenie",
        przedluzenie: k.linia.properties.id,
        nazwa: `Przedłużenie: ${etykieta} na osiedle przy ul. ${osiedle}`,
        geometry,
        dlugosc: k.dl,
        most: false,
        pasazerowie: pas,
        powod: `${wspolne} ${etykieta} kończy dziś trasę obok – przedłużenie o ${(k.dl / 1000).toFixed(1)} km daje dojazd bez przesiadki tam, dokąd linia już jeździ.`,
        ranga: i + 1,
      };
    }
    const celNazwa = k.cel.centrum ? "centrum" : k.cel.nazwa;
    return {
      id: `nowa-${klucz(k.coords[0])}-${klucz(koniec)}`,
      rodzaj: "linia",
      typLinii: "nowa",
      nazwa: `Nowa linia: osiedle przy ul. ${osiedle} – ${celNazwa}`,
      geometry,
      dlugosc: k.dl,
      most: false,
      pasazerowie: pas,
      powod: `${wspolne} Bezpośredni dojazd do: ${celNazwa}${k.cel.praca ? " (strefa pracy)" : ""}, ${(k.dl / 1000).toFixed(1)} km; ${Math.round(k.dubl * 100)}% trasy po ulicach z istniejącymi liniami.`,
      ranga: i + 1,
    };
  });
  console.info(`Propozycje linii: ${wynik.length} z ${luki.length} luk w obsłudze (${kandydaci.length} wariantów tras), ${Math.round(performance.now() - t0)} ms`);
  return wynik;
}
