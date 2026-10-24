// POPYT: gdzie mieszkają ludzie i gdzie pracują (wspólne dla propozycji linii i dróg).
// Mieszkańcy: punkty co ok. 120 m na terenach mieszkaniowych OSM w granicach miasta.
// Gęstość maleje z odległością od centrum (bloki w środku, domy na obrzeżach), a suma
// zgadza się z ludnością miasta (GUS) – to szacunek, OSM nie mówi, ile osób mieszka w budynku.
// Miejsca pracy: strefy przemysłowe, handlowe i biurowe OSM × typowa liczba miejsc pracy na ha.
import { MIASTO } from "../data/miasta.js";
import { dist } from "./network.js";

const KROK_LON = 0.0018; // ok. 120 m
const KROK_LAT = 0.0011; // ok. 120 m
export const HA_PUNKTU = 1.44;
const SPADEK_GESTOSCI = 6000; // m – gęstość w odległości 6 km od centrum ≈ 37% gęstości w centrum
const PRACA_NA_HA = { przemyslowa: 25, handlowa: 45, biurowa: 150 };

function wPierscieniu(x, y, r) {
  let w = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) w = !w;
  }
  return w;
}
export const wWielokacie = (c, g) => {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => wPierscieniu(c[0], c[1], p[0]) && !p.slice(1).some((h) => wPierscieniu(c[0], c[1], h)));
};
function pole(ring) {
  const kx = 111320 * Math.cos((ring[0][1] * Math.PI) / 180);
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * kx * (ring[i][1] * 110540) - ring[i][0] * kx * (ring[j][1] * 110540);
  return Math.abs(s) / 2 / 1e4;
}

// prosta siatka punktów { c: [lon, lat] } – obok(c, r) zwraca punkty z sąsiednich komórek
export function siatkaPunktow(punkty, rozmiar = 0.004) {
  const s = new Map();
  for (const p of punkty) {
    const k = `${Math.floor(p.c[0] / rozmiar)}:${Math.floor(p.c[1] / (rozmiar * 0.6))}`;
    (s.get(k) || s.set(k, []).get(k)).push(p);
  }
  return (c, r = 1) => {
    const cx = Math.floor(c[0] / rozmiar);
    const cy = Math.floor(c[1] / (rozmiar * 0.6));
    const out = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const k = s.get(`${cx + i}:${cy + j}`);
      if (k) for (const p of k) out.push(p);
    }
    return out;
  };
}

const cacheMieszk = new WeakMap();
// [{ c, os }] – mieszkańcy (szacunek) w punktach siatki
export function punktyMieszkancow(residential, boundary) {
  const miasto = boundary?.features?.[0]?.geometry;
  if (!residential?.features?.length || !miasto) return [];
  const c0 = cacheMieszk.get(residential);
  if (c0 && c0.miasto === miasto) return c0.p;
  const centrum = [MIASTO.centrum[1], MIASTO.centrum[0]];
  const punkty = [];
  for (const f of residential.features) {
    const g = f.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) {
      const ring = p[0];
      if (!ring?.length) continue;
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of ring) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
      const przed = punkty.length;
      for (let x = Math.floor(w / KROK_LON) * KROK_LON + KROK_LON / 2; x < e; x += KROK_LON)
        for (let y = Math.floor(s / KROK_LAT) * KROK_LAT + KROK_LAT / 2; y < n; y += KROK_LAT)
          if (wPierscieniu(x, y, ring) && wWielokacie([x, y], miasto)) punkty.push({ c: [x, y] });
      // mały teren (mniejszy niż oczko siatki) – jeden punkt w środku, z wagą wg powierzchni
      if (punkty.length === przed) {
        const sr = [(w + e) / 2, (s + n) / 2];
        if (wWielokacie(sr, miasto)) punkty.push({ c: sr, ha: Math.min(HA_PUNKTU, pole(ring)) });
      }
    }
  }
  let suma = 0;
  for (const p of punkty) {
    p.waga = (p.ha ?? HA_PUNKTU) * Math.exp(-dist(p.c, centrum) / SPADEK_GESTOSCI);
    suma += p.waga;
  }
  const ludnosc = MIASTO.ludnosc || 0;
  for (const p of punkty) p.os = suma ? (ludnosc * p.waga) / suma : 0;
  cacheMieszk.set(residential, { miasto, p: punkty });
  return punkty;
}

// [{ c, prac }] – miejsca pracy (szacunek) w środkach stref
export function miejscaPracy(zones) {
  const out = [];
  for (const f of zones?.features || []) {
    const g = f.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) {
      const ring = p[0];
      if (!ring?.length) continue;
      const ha = pole(ring);
      let sx = 0, sy = 0;
      for (const [x, y] of ring) (sx += x), (sy += y);
      out.push({ c: [sx / ring.length, sy / ring.length], ha, prac: ha * (PRACA_NA_HA[f.properties.rodzaj] || 30), nazwa: f.properties.name || "" });
    }
  }
  return out;
}
