// MODEL RUCHU I HAŁASU
// Uproszczony, jawny model natężenia ruchu na sieci dróg głównych wybranego miasta:
//  1) ruch bazowy (SDR – średni dobowy ruch) z klasy drogi, odległości od centrum
//     i bliskości stref przemysłowych / biurowych / handlowych,
//  2) rozkład w ciągu doby (profil godzinowy dnia roboczego i weekendu),
//  3) przepustowość z liczby pasów → stopień obciążenia V/C,
//  4) czas przejazdu wg krzywej BPR → współczynnik zakorkowania
//     (o ile procent dłużej jedzie się niż przy pustych drogach),
//  5) wpływ inwestycji wariantu (osiedla, drogi, zamknięcia, P&R, linie),
//  6) hałas drogowy (Lden) z natężenia ruchu i liczba osób narażonych.
// UWAGA: to model szacunkowy, a nie pomiary. Wyniki służą do porównań wariantów.
import * as turf from "@turf/turf";
import { z } from "./config.js";
import { MIASTO_CENTRUM } from "../data/queries.js";

// --- parametry klas dróg OSM ---
// sdr – ruch w przekroju (obie strony) [poj./dobę]; pas – przepustowość pasa [poj./h];
// v0 – prędkość swobodna [km/h]; pasy – domyślna liczba pasów (wszystkie kierunki)
export const KLASY_DROG = {
  motorway: { label: "Autostrada / ekspresowa", sdr: 40000, pas: 1800, v0: 110, pasy: 4 },
  // (pas = przepustowość pasa z uwzględnieniem skrzyżowań i sygnalizacji)
  trunk: { label: "Krajowa (GP)", sdr: 32000, pas: 1100, v0: 70, pasy: 4 },
  primary: { label: "Główna (G)", sdr: 26000, pas: 700, v0: 50, pasy: 2 },
  secondary: { label: "Zbiorcza (Z)", sdr: 13000, pas: 650, v0: 50, pasy: 2 },
  tertiary: { label: "Lokalna (L)", sdr: 6000, pas: 600, v0: 40, pasy: 2 },
};
const KLASA_INWESTYCJI = { lokalna: "tertiary", zbiorcza: "secondary", glowna: "primary" };

// Udział ruchu dobowego w kolejnych godzinach (typowy dzień roboczy w mieście średniej wielkości)
const PROFIL_ROBOCZY = norm([
  0.008, 0.005, 0.004, 0.004, 0.008, 0.022, 0.055, 0.085, 0.075, 0.058, 0.055, 0.058,
  0.062, 0.064, 0.07, 0.082, 0.083, 0.07, 0.055, 0.042, 0.032, 0.024, 0.018, 0.012,
]);
const PROFIL_WEEKEND = norm([
  0.012, 0.008, 0.006, 0.005, 0.006, 0.01, 0.02, 0.032, 0.048, 0.062, 0.072, 0.078,
  0.08, 0.078, 0.072, 0.068, 0.066, 0.064, 0.058, 0.048, 0.038, 0.03, 0.024, 0.018,
]);
export const PROFILE = { roboczy: PROFIL_ROBOCZY, weekend: PROFIL_WEEKEND };
const RUCH_WEEKEND = 0.75; // ruch dobowy w weekend względem dnia roboczego

// Indeks ruchu w latach (2025 = 1). Lata minione: trend + spadek pandemiczny 2020–21.
// To rekonstrukcja modelowa (brak otwartych pomiarów dla wszystkich ulic Torunia).
const ROK_BAZOWY = 2025;
const ZMIANY_HIST = { 2020: 0.85, 2021: 0.93 };
export const LATA = Array.from({ length: 2036 - 2015 + 1 }, (_, i) => 2015 + i);
export function indeksRoku(rok) {
  const t = (1 + z("wzrostRuchu")) ** (rok - ROK_BAZOWY);
  return t * (ZMIANY_HIST[rok] ?? 1);
}
// Inwestycje wariantu wchodzą stopniowo: 0 w 2027, 100% od 2030
export const wdrozenie = (rok) => Math.min(1, Math.max(0, (rok - 2027) / 3));

// BPR (Bureau of Public Roads) w wersji miejskiej: t/t0 = 1 + α·(V/C)^β
const ALFA = 0.6;
const BETA = 4;
const czasWzgl = (vc) => 1 + ALFA * vc ** BETA;

function norm(a) {
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / s);
}

// --- geometria w metrach (lokalne odwzorowanie) ---
const LAT0 = MIASTO_CENTRUM[0];
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110540;
const xy = ([lon, lat]) => [lon * KX, lat * KY];

function distPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function distPtLine(px, py, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const v = distPtSeg(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (v < d) d = v;
  }
  return pts.length === 1 ? Math.hypot(px - pts[0][0], py - pts[0][1]) : d;
}

// Punkty co ~krok m wzdłuż geometrii inwestycji (linii lub obrysu wielokąta)
function probkuj(geometry, krok = 100) {
  const g = geometry.geometry || geometry;
  const linie =
    g.type === "LineString" ? [g.coordinates]
    : g.type === "Polygon" ? g.coordinates
    : g.type === "MultiPolygon" ? g.coordinates.flat()
    : g.type === "Point" ? [[g.coordinates]]
    : [];
  const out = [];
  for (const l of linie) {
    const p = l.map(xy);
    out.push(p[0]);
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1];
      const [bx, by] = p[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / krok));
      for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
  }
  return out;
}

// --- SIEĆ ---
const cacheSieci = new WeakMap();

export function zbudujSiec(data) {
  const roads = data.roads;
  if (!roads?.features?.length) return null;
  const c = cacheSieci.get(roads);
  if (c && c.zones === data.zones) return c.siec;

  const centrum = xy([MIASTO_CENTRUM[1], MIASTO_CENTRUM[0]]);
  // strefy pracy: środek + powierzchnia (ha)
  const strefy = (data.zones?.features || [])
    .map((f) => {
      try {
        const c = turf.centroid(f).geometry.coordinates;
        return { p: xy(c), ha: turf.area(f) / 1e4, rodzaj: f.properties.rodzaj };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  // siatka stref (komórki 1,5 km = zasięg przyciągania) – zamiast sprawdzać każdą strefę dla każdego odcinka
  const OKO = 1500;
  const siatka = new Map();
  for (const s of strefy) {
    const k = `${Math.floor(s.p[0] / OKO)}:${Math.floor(s.p[1] / OKO)}`;
    (siatka.get(k) || siatka.set(k, []).get(k)).push(s);
  }
  const strefyObok = ([x, y]) => {
    const cx = Math.floor(x / OKO);
    const cy = Math.floor(y / OKO);
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = siatka.get(`${cx + i}:${cy + j}`);
      if (c) for (const s of c) out.push(s);
    }
    return out;
  };

  const odcinki = [];
  for (const f of roads.features) {
    if (f.geometry?.type !== "LineString") continue;
    const hw = f.properties.highway || "";
    const baza = hw.replace("_link", "");
    const K = KLASY_DROG[baza];
    if (!K) continue;
    const link = hw.endsWith("_link");
    const pts = f.geometry.coordinates.map(xy);
    let dl = 0;
    for (let i = 1; i < pts.length; i++) dl += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (dl < 1) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    const oneway = ["yes", "1", "true"].includes(f.properties.oneway) || baza === "motorway";
    const pasyOSM = parseInt(f.properties.lanes);
    const pasyKier = oneway
      ? pasyOSM || (["trunk", "primary"].includes(baza) ? 2 : 1)
      : Math.max(1, Math.floor((pasyOSM || K.pasy) / 2));
    const vmax = parseInt(f.properties.maxspeed) || K.v0;

    // ruch bazowy: klasa × bliskość centrum × przyciąganie stref pracy
    const dC = Math.hypot(mid[0] - centrum[0], mid[1] - centrum[1]);
    let atrakcja = 0;
    for (const s of strefyObok(mid)) {
      const d = Math.hypot(mid[0] - s.p[0], mid[1] - s.p[1]);
      if (d < 1500) atrakcja += s.ha * (s.rodzaj === "przemyslowa" ? 1 : 1.5) * Math.exp(-d / 500);
    }
    let sdr = K.sdr * (link ? 0.35 : 1) * (0.8 + 0.35 * Math.exp(-dC / 3000)) * (1 + Math.min(0.3, atrakcja / 200));
    // mosty skupiają ruch z całego miasta
    if (/^most\b/i.test(f.properties.name || "")) sdr *= 1.6;
    // jezdnia jednokierunkowa przenosi ok. połowę ruchu przekroju;
    // droga dwukierunkowa z 1 pasem na kierunek – mniej ruchu niż dwujezdniowa tej klasy
    const sdrJezdni = oneway ? sdr / 2 : pasyKier >= 2 ? sdr : sdr * 0.6;

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    odcinki.push({
      id: f.properties.id,
      nazwa: f.properties.name,
      klasa: baza,
      wsp: f.geometry.coordinates,
      pts,
      mid,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      dl,
      oneway,
      sdr: sdrJezdni,
      // przepustowość kierunku najbardziej obciążonego
      cap: pasyKier * K.pas,
      // udział kierunku dominującego w ruchu jezdni
      kier: oneway ? 1 : 0.6,
      v0: Math.min(vmax, K.v0 + 10),
    });
  }
  const siec = { odcinki, centrum, strefy };
  cacheSieci.set(roads, { zones: data.zones, siec });
  return siec;
}

// Odcinki w promieniu R od punktów inwestycji: [[indeks, odległość], ...]
function odcinkiObok(siec, punkty, R) {
  if (!punkty.length) return [];
  const xs = punkty.map((p) => p[0]);
  const ys = punkty.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs) - R, Math.min(...ys) - R, Math.max(...xs) + R, Math.max(...ys) + R];
  const out = [];
  siec.odcinki.forEach((o, i) => {
    const [a, b, c, d] = o.bbox;
    if (c < x0 || a > x1 || d < y0 || b > y1) return;
    let min = Infinity;
    for (const p of punkty) {
      const v = distPtLine(p[0], p[1], o.pts);
      if (v < min) min = v;
      if (min < 5) break;
    }
    if (min <= R) out.push([i, min]);
  });
  return out;
}

// --- WPŁYW INWESTYCJI NA RUCH ---
// Zwraca zmianę SDR na istniejących odcinkach (Float64Array) i nowe odcinki (nowe drogi).
export function wplywInwestycji(siec, investments, data) {
  const n = siec.odcinki.length;
  const delta = new Float64Array(n);
  const mnoznik = new Float64Array(n).fill(1);
  const nowe = [];
  const add = (lista, f) => lista.forEach(([i, d]) => (delta[i] += f(d, i)));

  for (const inv of investments) {
    const p = inv.params || {};
    try {
      if (inv.typ === "osiedle") {
        // nowe podróże autem rozkładają się na drogi w okolicy
        const T = p.mieszkania * z("osobNaMieszkanie") * z("podrozyNaOsobe") * z("udzialAuta");
        add(odcinkiObok(siec, probkuj(inv.geometry), 2000), (d) => T * 0.5 * Math.exp(-d / 700));
      } else if (inv.typ === "zamkniecie") {
        const pkt = probkuj(inv.geometry, 30);
        const zamkniete = odcinkiObok(siec, pkt, 25);
        let Q = 0;
        zamkniete.forEach(([i]) => {
          mnoznik[i] = 0.05;
          Q = Math.max(Q, siec.odcinki[i].sdr);
        });
        if (!Q) Q = 8000;
        const zamk = new Set(zamkniete.map(([i]) => i));
        add(
          odcinkiObok(siec, pkt, 1200).filter(([i]) => !zamk.has(i)),
          (d) => Q * z("udzialObjazdow") * 0.5 * Math.exp(-d / 350)
        );
      } else if (inv.typ === "droga") {
        const klasa = KLASA_INWESTYCJI[p.klasa] || "secondary";
        const K = KLASY_DROG[klasa];
        const przejete = K.sdr * z("udzialPrzejetegoRuchu");
        const g = inv.geometry.geometry || inv.geometry;
        const pts = g.coordinates.map(xy);
        let dl = 0;
        for (let i = 1; i < pts.length; i++) dl += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        nowe.push({
          id: "nowa-" + inv.id, nazwa: inv.nazwa, klasa, wsp: g.coordinates, pts, mid: pts[Math.floor(pts.length / 2)],
          dl, oneway: false, sdr: przejete, cap: K.pas, kier: 0.6, v0: K.v0, nowa: true,
        });
        add(odcinkiObok(siec, probkuj(inv.geometry), 1000), (d) => -przejete * 0.5 * Math.exp(-d / 400));
      } else if (inv.typ === "parking") {
        const miejsca = miejscaParkingu(inv);
        const pkt = probkuj(inv.geometry);
        if (p.parkRide) {
          // auta zostają na P&R → mniej ruchu w korytarzu do centrum
          const auta = miejsca * z("rotacjaPR");
          const c = turf.centroid(inv.geometry.geometry || inv.geometry).geometry.coordinates;
          const korytarz = [xy(c), siec.centrum];
          siec.odcinki.forEach((o, i) => {
            const d = distPtLine(o.mid[0], o.mid[1], korytarz);
            if (d < 600) delta[i] -= auta * 0.7 * Math.exp(-d / 300);
          });
          // dojazd do samego P&R
          add(odcinkiObok(siec, pkt, 800), (d) => auta * 0.3 * Math.exp(-d / 300));
        } else {
          add(odcinkiObok(siec, pkt, 1000), (d) => miejsca * 2.5 * 0.5 * Math.exp(-d / 350));
        }
      } else if (inv.typ === "tramwaj" || inv.typ === "autobus") {
        const s = statystykiLinii(inv, data);
        add(odcinkiObok(siec, probkuj(inv.geometry), 800), (d) => -(s.przejeteAuta / Math.max(1, s.dlKm)) * 0.6 * Math.exp(-d / 250));
      }
    } catch (e) {
      console.warn("Model ruchu: pominięto inwestycję", inv.nazwa, e);
    }
  }
  return { delta, mnoznik, nowe };
}

// Ruch dobowy (SDR) odcinków po uwzględnieniu inwestycji
function sdrOdcinkow(siec, wplyw) {
  const lista = siec.odcinki.map((o, i) => ({
    o,
    sdr: Math.max(o.sdr * 0.3, o.sdr * wplyw.mnoznik[i] + wplyw.delta[i]) * (wplyw.mnoznik[i] < 0.1 ? 0.05 : 1),
  }));
  for (const o of wplyw.nowe) lista.push({ o, sdr: o.sdr });
  return lista;
}

// --- OCENA SIECI W DANEJ GODZINIE ---
// skala: mnożnik ruchu (rok, weekend); zwraca V/C odcinków i wskaźniki
function ocenGodzine(lista, profil, h, skala) {
  let sumaVL = 0;
  let sumaOpoz = 0;
  let pojGodz = 0;
  const vc = new Float32Array(lista.length);
  lista.forEach(({ o, sdr }, i) => {
    const V = sdr * skala * profil[h]; // poj./h na jezdni
    const r = (V * o.kier) / o.cap;
    vc[i] = r;
    const tw = czasWzgl(r);
    const wagi = V * o.dl;
    sumaVL += wagi;
    sumaOpoz += wagi * (tw - 1);
    pojGodz += (V * (o.dl / 1000)) / o.v0 * tw;
  });
  return { vc, zakorkowanie: sumaVL ? sumaOpoz / sumaVL : 0, pojGodz };
}

// Pełna analiza ruchu dla zestawu inwestycji (cache na poziomie wywołującego)
export function analizaRuchu(siec, investments, data, { rok = ROK_BAZOWY } = {}) {
  const wplyw = wplywInwestycji(siec, investments, data);
  const lista = sdrOdcinkow(siec, wplyw);
  const skala = indeksRoku(rok);
  const godziny = [];
  const weekend = [];
  let pojGodzDzien = 0;
  for (let h = 0; h < 24; h++) {
    const g = ocenGodzine(lista, PROFIL_ROBOCZY, h, skala);
    godziny.push(g.zakorkowanie);
    pojGodzDzien += g.pojGodz;
    weekend.push(ocenGodzine(lista, PROFIL_WEEKEND, h, skala * RUCH_WEEKEND).zakorkowanie);
  }
  const szczyt = godziny.indexOf(Math.max(...godziny));
  return {
    lista,
    godziny, // współczynnik zakorkowania w kolejnych godzinach dnia roboczego
    weekend,
    szczyt,
    zakorkowanieSzczyt: godziny[szczyt],
    zakorkowanieDzien: godziny.reduce((a, b, h) => a + b * PROFIL_ROBOCZY[h], 0),
    pojGodzDzien, // pojazdogodziny na dobę
    halas: halas(lista, investments, data),
  };
}

// Stan sieci w konkretnej godzinie (do mapy natężenia)
export function stanGodziny(analiza, h, { weekend = false, rok = ROK_BAZOWY } = {}) {
  const skala = indeksRoku(rok) * (weekend ? RUCH_WEEKEND : 1);
  return ocenGodzine(analiza.lista, weekend ? PROFIL_WEEKEND : PROFIL_ROBOCZY, h, skala);
}

// Zakorkowanie w szczycie w kolejnych latach (historia modelowa + prognoza z inwestycjami)
export function zakorkowanieWLatach(siec, bazowa, zInwestycjami) {
  return LATA.map((rok) => {
    const s = indeksRoku(rok);
    const zakB = ocenGodzine(bazowa.lista, PROFIL_ROBOCZY, bazowa.szczyt, s).zakorkowanie;
    if (rok <= ROK_BAZOWY || !zInwestycjami) return { rok, baza: zakB, wariant: zakB };
    const zakW = ocenGodzine(zInwestycjami.lista, PROFIL_ROBOCZY, zInwestycjami.szczyt, s).zakorkowanie;
    const w = wdrozenie(rok);
    return { rok, baza: zakB, wariant: zakB * (1 - w) + zakW * w };
  });
}

// --- HAŁAS ---
// Lden w odległości 10 m od osi drogi: 10·log10(SDR) + 25 dB (+ poprawka na prędkość).
export function ldenOdcinka(sdr, v0) {
  return 10 * Math.log10(Math.max(1, sdr)) + 25 + (v0 >= 90 ? 3 : v0 >= 70 ? 1.5 : 0);
}
// odległość (m), w której hałas spada do progu (źródło liniowe: −3 dB na podwojenie odległości)
const zasiegHalasu = (L10, prog) => (L10 <= prog ? 0 : 10 * 10 ** ((L10 - prog) / 10));

function halas(lista, investments, data) {
  const prog = z("progWHO");
  const gestosc = z("gestoscMiasta") / 1e6; // os./m²
  const lden = new Float32Array(lista.length);
  let narazeni = 0;
  lista.forEach(({ o, sdr }, i) => {
    // jezdnia jednokierunkowa: druga jezdnia leży obok – liczymy połowę pasa, by nie dublować
    const L = ldenOdcinka(o.oneway ? sdr * 2 : sdr, o.v0);
    lden[i] = L;
    const zasieg = Math.min(400, zasiegHalasu(L, prog));
    const szer = Math.max(0, zasieg - 10) * 2 * (o.oneway ? 0.5 : 1);
    narazeni += szer * o.dl * gestosc * 0.6; // 0.6 – część terenu przy drogach to nie zabudowa
  });
  // tramwaje z nowych linii
  for (const inv of investments) {
    if (inv.typ !== "tramwaj") continue;
    const s = statystykiLinii(inv, data);
    const L = 10 * Math.log10(Math.max(1, s.kursyDzien)) + 40;
    narazeni += Math.max(0, zasiegHalasu(L, prog) - 10) * 2 * s.dlKm * 1000 * gestosc * 0.6;
  }
  return { lden, narazeni };
}

// Najwyższy poziom hałasu drogowego przy danym obszarze (np. nowym osiedlu)
export function halasPrzy(analiza, geometry) {
  const pkt = probkuj(geometry, 50);
  let max = 0;
  let zrodlo = null;
  analiza.lista.forEach(({ o }, i) => {
    const [a, b, c, d] = o.bbox || [o.mid[0], o.mid[1], o.mid[0], o.mid[1]];
    if (pkt.every((p) => p[0] < a - 500 || p[0] > c + 500 || p[1] < b - 500 || p[1] > d + 500)) return;
    let dmin = Infinity;
    for (const p of pkt) dmin = Math.min(dmin, distPtLine(p[0], p[1], o.pts));
    const L = analiza.halas.lden[i] - 10 * Math.log10(Math.max(10, dmin) / 10);
    if (L > max) {
      max = L;
      zrodlo = o.nazwa;
    }
  });
  return { max, zrodlo };
}

// --- POMOCNICZE DLA INWESTYCJI ---
export function miejscaParkingu(inv) {
  const p = inv.params || {};
  if (p.miejsca) return p.miejsca;
  try {
    return Math.max(10, Math.round(turf.area(inv.geometry) / z("m2NaMiejsce")));
  } catch {
    return 50;
  }
}

// Statystyki nowej linii komunikacji: długość, przystanki, zasięg, pasażerowie, przejęte auta
const cacheLinii = new WeakMap();
export function statystykiLinii(inv, data) {
  const c = cacheLinii.get(inv);
  if (c && c.data === data) return c.s;
  const tram = inv.typ === "tramwaj";
  const dlKm = turf.length(inv.geometry, { units: "kilometers" });
  const R = tram ? z("promienTramwaju") : z("promienPrzystanku");
  const zasieg = turf.buffer(inv.geometry, R / 1000, { units: "kilometers" });
  const mieszkancy = (turf.area(zasieg) / 1e6) * z("gestoscMiasta");
  // przystanki wyznaczone przy tworzeniu linii (auto / ręcznie); zapas: co kilkaset metrów
  const zapisane = inv.params?.przystanki;
  const nPrzyst = Math.max(2, Math.round((dlKm * 1000) / z("odstepPrzystankow")) + 1);
  const przystanki = zapisane?.length
    ? zapisane.map((s) => turf.point(s.coords, { name: s.nazwa, istniejacy: s.istniejacy }))
    : Array.from({ length: nPrzyst }, (_, i) => turf.along(inv.geometry, (dlKm * i) / (nPrzyst - 1), { units: "kilometers" }));
  // strefy pracy w zasięgu (miejsca pracy przyciągają pasażerów)
  let haPracy = 0;
  for (const f of data?.zones?.features || []) {
    try {
      if (turf.booleanPointInPolygon(turf.centroid(f), zasieg)) haPracy += turf.area(f) / 1e4;
    } catch {
      /* pomijamy */
    }
  }
  const czest = inv.params?.czestotliwosc || (tram ? 10 : 15);
  const kursyDzien = 2 * (60 / czest) * z("godzinKursowania");
  const wozokmRok = kursyDzien * dlKm * 365;
  const czasKursu = (dlKm / z("predkoscKomunikacji")) * 60 + 10; // min, z postojem na pętli
  const pojazdy = Math.ceil((2 * czasKursu) / czest);
  const atrakcyjnosc = (tram ? 1.3 : 1) * Math.min(1.6, 1 + haPracy / 100) * Math.min(1.2, 10 / czest);
  const podrozeAuto = mieszkancy * z("podrozyNaOsobe") * z("udzialAuta");
  const przejeteAuta = podrozeAuto * z("przejecieAut") * atrakcyjnosc * (tram ? 1 : 0.6);
  const pasazerowieDzien = mieszkancy * z("podrozyNaOsobe") * z("udzialKomunikacji") * 0.25 * atrakcyjnosc + przejeteAuta;
  const s = { dlKm, zasieg, mieszkancy, przystanki, haPracy, kursyDzien, wozokmRok, pojazdy, przejeteAuta, pasazerowieDzien };
  cacheLinii.set(inv, { data, s });
  return s;
}

export const ROK_BAZY = ROK_BAZOWY;
