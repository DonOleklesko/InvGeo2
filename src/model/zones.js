// STREFY PRACY (przemysłowe, biurowe, handlowe) i PROPOZYCJE PARK & RIDE
import * as turf from "@turf/turf";
import { MIASTO_CENTRUM } from "../data/queries.js";
import { stanGodziny } from "./traffic.js";

const LAT0 = MIASTO_CENTRUM[0];
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110540;
const xy = ([lon, lat]) => [lon * KX, lat * KY];
const odl = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const CENTRUM = xy([MIASTO_CENTRUM[1], MIASTO_CENTRUM[0]]);

// Odległość punktu od odcinka (metry, lokalne odwzorowanie)
function odlOdcinek(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

// Odcinki granicy miasta w metrach, liczone raz dla danej granicy.
// (turf.pointToLineDistance dla każdego parkingu trwało kilkanaście sekund)
const cacheGranicy = new WeakMap();
function odcinkiGranicy(miasto) {
  if (cacheGranicy.has(miasto)) return cacheGranicy.get(miasto);
  const g = miasto.geometry;
  const pierscienie = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  const odc = [];
  for (const r of pierscienie) {
    const pts = r.map(xy);
    for (let i = 1; i < pts.length; i++) odc.push([pts[i - 1], pts[i]]);
  }
  cacheGranicy.set(miasto, odc);
  return odc;
}
function odlOdGranicy(p, odc) {
  let d = Infinity;
  for (const [a, b] of odc) {
    // szybkie pominięcie: odcinek dalej niż obecne minimum
    if (Math.min(Math.abs(p[0] - a[0]), Math.abs(p[0] - b[0])) > d && (p[0] - a[0]) * (p[0] - b[0]) > 0) continue;
    if (Math.min(Math.abs(p[1] - a[1]), Math.abs(p[1] - b[1])) > d && (p[1] - a[1]) * (p[1] - b[1]) > 0) continue;
    const v = odlOdcinek(p, a, b);
    if (v < d) d = v;
  }
  return d;
}

// Siatka przystanków (komórki 300 m) – sąsiedzi bez przeglądania wszystkich przystanków
function siatkaPrzystankow(przyst, rozmiar) {
  const s = new Map();
  for (const x of przyst) {
    const k = `${Math.floor(x.p[0] / rozmiar)}:${Math.floor(x.p[1] / rozmiar)}`;
    (s.get(k) || s.set(k, []).get(k)).push(x);
  }
  return (p) => {
    const cx = Math.floor(p[0] / rozmiar);
    const cy = Math.floor(p[1] / rozmiar);
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(s.get(`${cx + i}:${cy + j}`) || []));
    return out;
  };
}

function przystankiZLiniami(stops) {
  return (stops?.features || [])
    .filter((f) => f.properties.linie?.length)
    .map((f) => ({ f, p: xy(f.geometry.coordinates), n: f.properties.linie.length }));
}

// Drogi wlotowe: drogi główne, które przecinają granicę miasta (tą drogą przyjeżdżają ludzie
// spoza miasta). Cała droga o tym samym numerze (np. DK10) lub nazwie to korytarz wlotowy.
// Zwraca siatkę punktów (co ok. 50 m) i nazwę drogi.
function korytarzeWlotowe(roads, miasto) {
  const glowne = (roads?.features || []).filter((f) => /^(motorway|trunk|primary|secondary)$/.test(f.properties.highway || "") && f.geometry?.type === "LineString");
  const klucz = (f) => f.properties.ref || f.properties.name || "";
  const wlotowe = new Set();
  for (const f of glowne) {
    const c = f.geometry.coordinates;
    if (!klucz(f)) continue;
    let wew = false;
    let zew = false;
    for (const p of [c[0], c[Math.floor(c.length / 2)], c[c.length - 1]]) {
      if (turf.booleanPointInPolygon(p, miasto)) wew = true;
      else zew = true;
    }
    if (wew && zew) wlotowe.add(klucz(f));
  }
  const punkty = [];
  for (const f of glowne) {
    if (!wlotowe.has(klucz(f))) continue;
    const c = f.geometry.coordinates.map(xy);
    for (let i = 1; i < c.length; i++) {
      const n = Math.max(1, Math.ceil(odl(c[i - 1], c[i]) / 50));
      for (let k = 0; k <= n; k++) punkty.push({ p: [c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * k) / n, c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * k) / n], nazwa: f.properties.ref ? `${f.properties.name || "droga"} (${f.properties.ref})` : f.properties.name });
    }
  }
  return punkty;
}

// 1 linia, 2–4 linie, 5+ linii (12–14 linii)
const odmianaLinii = (n) => (n === 1 ? "linia" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "linie" : "linii");

// Linie, które dojeżdżają do centrum (trasa do 700 m od centrum) – z P&R jedzie się bez przesiadki
function linieDoCentrum(lines) {
  const out = new Set();
  for (const l of lines?.features || []) {
    const odc = l.geometry.type === "MultiLineString" ? l.geometry.coordinates : [l.geometry.coordinates];
    if (odc.some((o) => o.some((c) => odl(xy(c), CENTRUM) < 700))) out.add(l.properties.id);
  }
  return out;
}

// Parkingi przy drogach WLOTOWYCH, z linią jadącą BEZPOŚREDNIO do centrum → kandydaci na Park & Ride.
// P&R ma przechwytywać auta przyjeżdżające spoza miasta, zanim wjadą w zatłoczone ulice.
export function proponujParkRide(data) {
  const parkingi = data.parkings?.features;
  const miasto = data.boundary?.features?.[0];
  if (!parkingi?.length || !miasto) return [];
  const przyst = przystankiZLiniami(data.stops);
  if (!przyst.length) return [];
  const granica = odcinkiGranicy(miasto);
  const obok = siatkaPrzystankow(przyst, 300);
  const wloty = korytarzeWlotowe(data.roads, miasto);
  const wlotyObok = siatkaPrzystankow(wloty, 400);
  const doCentrum = linieDoCentrum(data.lines);

  const kandydaci = [];
  for (const f of parkingi) {
    const p = xy(f.geometry.coordinates);
    const dC = odl(p, CENTRUM);
    if (dC < 2500) continue; // w centrum P&R nie ma sensu
    const pojemnosc = +f.properties.capacity || 0;
    if (pojemnosc && pojemnosc < 20) continue;
    let linie = new Set();
    let najblizszy = null;
    for (const s of obok(p)) {
      const d = odl(p, s.p);
      if (d < 300) {
        s.f.properties.linie.forEach((l) => linie.add(l));
        if (!najblizszy || d < najblizszy.d) najblizszy = { d, nazwa: s.f.properties.name };
      }
    }
    // linie bezpośrednio do centrum (bez przesiadki)
    const bezposrednie = [...linie].filter((l) => doCentrum.has(l));
    if (!bezposrednie.length) continue;
    const dG = odlOdGranicy(p, granica);
    // P&R ma przechwytywać auta przy wjeździe: w zewnętrznej części miasta (bliżej granicy niż centrum)
    if (dG > 3500 || dG >= dC) continue;
    // przy drodze wlotowej (do 400 m)
    let wlot = null;
    for (const w of wlotyObok(p)) {
      const d = odl(p, w.p);
      if (d < 400 && (!wlot || d < wlot.d)) wlot = { d, nazwa: w.nazwa };
    }
    if (!wlot) continue;
    const tram = bezposrednie.some((l) => l.startsWith("tram:"));
    const ocena = bezposrednie.length * 1.5 + (tram ? 5 : 0) + Math.min(6, pojemnosc / 50) + (3500 - dG) / 1000 - wlot.d / 200;
    kandydaci.push({ f, p, linie: bezposrednie.length, tram, ocena, dG, dC, najblizszy, pojemnosc, wlot });
  }
  kandydaci.sort((a, b) => b.ocena - a.ocena);
  const wybrane = [];
  for (const k of kandydaci) {
    if (wybrane.length >= 5) break;
    if (wybrane.some((w) => odl(w.p, k.p) < 1500)) continue;
    wybrane.push(k);
  }
  return wybrane.map((k) => ({
    id: `pr-${k.f.properties.id}`,
    rodzaj: "parkride",
    nazwa: `Park & Ride: ${k.f.properties.name || k.najblizszy?.nazwa || "parking przy wjeździe"}`,
    geometry: turf.point(k.f.geometry.coordinates),
    dlugosc: 0,
    most: false,
    powod: `Przy drodze wlotowej ${k.wlot.nazwa || ""} (${Math.round(k.wlot.d)} m), ${(k.dG / 1000).toFixed(1)} km od granicy miasta; ${k.linie} ${odmianaLinii(k.linie)} bezpośrednio do centrum${k.tram ? " (w tym tramwaj)" : ""}, ${(k.dC / 1000).toFixed(1)} km${k.pojemnosc ? `; ${k.pojemnosc} miejsc` : ""}.`,
    parking: k.f,
  }));
}

// Analiza stref pracy: dostęp do komunikacji i obciążenie dróg dojazdowych
export function analizaStref(data, ruch) {
  const strefy = data.zones?.features;
  if (!strefy?.length) return [];
  const przyst = przystankiZLiniami(data.stops);
  const stan = ruch ? stanGodziny(ruch, ruch.szczyt) : null;

  // łączymy sąsiednie małe strefy tego samego rodzaju w obszary (siatka 600 m)
  const grupy = new Map();
  for (const f of strefy) {
    let c, ha;
    try {
      c = turf.centroid(f).geometry.coordinates;
      ha = turf.area(f) / 1e4;
    } catch {
      continue;
    }
    const p = xy(c);
    const k = `${f.properties.rodzaj}:${Math.floor(p[0] / 600)}:${Math.floor(p[1] / 600)}`;
    const g = grupy.get(k) || { rodzaj: f.properties.rodzaj, ha: 0, sx: 0, sy: 0, nazwy: new Set(), wsp: [] };
    g.ha += ha;
    g.sx += p[0] * ha;
    g.sy += p[1] * ha;
    g.wsp.push([c, ha]);
    if (f.properties.name) g.nazwy.add(f.properties.name);
    grupy.set(k, g);
  }

  const wynik = [];
  for (const g of grupy.values()) {
    if (g.ha < 3) continue;
    const p = [g.sx / g.ha, g.sy / g.ha];
    const lon = p[0] / KX;
    const lat = p[1] / KY;
    let linie = new Set();
    let dPrzyst = Infinity;
    let wezel = null; // najbliższy przystanek z co najmniej 3 liniami (do dowozu)
    for (const s of przyst) {
      const d = odl(p, s.p);
      dPrzyst = Math.min(dPrzyst, d);
      if (d < 500) s.f.properties.linie.forEach((l) => linie.add(l));
      if (s.n >= 3 && (!wezel || d < wezel.d)) wezel = { d, f: s.f };
    }
    let vc = null;
    if (stan) {
      let suma = 0;
      let waga = 0;
      ruch.lista.forEach(({ o }, i) => {
        const d = odl(p, o.mid);
        if (d < 800) {
          suma += stan.vc[i] * o.dl;
          waga += o.dl;
        }
      });
      vc = waga ? suma / waga : null;
    }
    const problemy = [];
    if (dPrzyst > 500) problemy.push("brak przystanku w 500 m");
    else if (linie.size < 2) problemy.push("tylko 1 linia");
    if (vc != null && vc > 0.85) problemy.push("zatłoczone drogi dojazdowe");
    wynik.push({
      id: `strefa-${Math.round(p[0])}-${Math.round(p[1])}`,
      rodzaj: g.rodzaj,
      nazwa: [...g.nazwy].slice(0, 2).join(", ") || nazwaRodzaju(g.rodzaj),
      ha: g.ha,
      srodek: [lon, lat],
      linie: linie.size,
      dPrzyst,
      vc,
      problemy,
      // dowóz proponujemy tylko strefie bez przystanku w 500 m (inaczej linia już tam dojeżdża)
      wezel: dPrzyst > 500 && wezel ? wezel.f : null,
    });
  }
  return wynik.sort((a, b) => b.problemy.length - a.problemy.length || b.ha - a.ha).slice(0, 15);
}

export const nazwaRodzaju = (r) => ({ przemyslowa: "Strefa przemysłowa", biurowa: "Biura", handlowa: "Strefa handlowo-usługowa" })[r] || r;
