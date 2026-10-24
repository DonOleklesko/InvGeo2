// Sprawdzanie zabudowy wzdłuż proponowanych dróg.
// Budynków całego miasta nie trzymamy w plikach (za duże), więc pytamy Overpass
// tylko o budynki w pasie kilku metrów wokół każdej propozycji (filtr „around” z linią).
import * as turf from "@turf/turf";
import { OVERPASS_URLS } from "./queries.js";

const KLUCZ = "torun2036:zabudowa:";

function zPamieci(k) {
  try {
    return JSON.parse(localStorage.getItem(KLUCZ + k));
  } catch {
    return null;
  }
}
function doPamieci(k, v) {
  try {
    localStorage.setItem(KLUCZ + k, JSON.stringify(v));
  } catch {
    /* brak miejsca */
  }
}

// Z siatki budynków miasta (plik buildings.bin): liczba osobnych „trafień” w budynki wzdłuż linii
// (próbki co 2 m, ciągły odcinek zajętych komórek = jeden budynek). Pierwsze i ostatnie 12 m
// pomijamy – tam nowa droga włącza się do istniejącej ulicy, przy której stoją domy.
function budynkiZSiatki(siatka, coords) {
  let ile = 0;
  let wBudynku = false;
  const odl = ([a, b], [c, d]) => Math.hypot((c - a) * 111320 * Math.cos((b * Math.PI) / 180), (d - b) * 110540);
  let dlCala = 0;
  for (let i = 1; i < coords.length; i++) dlCala += odl(coords[i - 1], coords[i]);
  let przebyte = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const L = odl(a, b);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k <= n; k++) {
      const d = przebyte + (L * k) / n;
      if (d < 12 || d > dlCala - 12) continue;
      const zaj = siatka.zajete([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      if (zaj && !wBudynku) ile++;
      wBudynku = zaj;
    }
    przebyte += L;
  }
  return ile;
}

// Zwraca { [idPropozycji]: liczbaPrzecinanychBudynków }
// Najpierw siatka budynków z pliku (natychmiast, bez internetu); bez pliku – zapytanie Overpass.
export async function budynkiNaTrasach(propozycje, sygnal) {
  const linie = propozycje.filter((p) => p.geometry?.geometry?.type === "LineString" || p.geometry?.type === "LineString");
  if (!linie.length) return {};
  const { wczytajBudynki } = await import("./budynki.js");
  const siatka = await wczytajBudynki();
  if (siatka) return Object.fromEntries(linie.map((p) => [p.id, budynkiZSiatki(siatka, (p.geometry.geometry || p.geometry).coordinates)]));
  const k = linie.map((p) => p.id).join("|");
  const zap = zPamieci(k);
  if (zap) return zap;

  const czesci = linie.map((p) => {
    const coords = (p.geometry.geometry || p.geometry).coordinates;
    return `way["building"](around:3,${coords.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(",")});`;
  });
  const q = `[out:json][timeout:60];(${czesci.join("")});out geom;`;
  const urls = import.meta.env.DEV ? ["/overpass", ...OVERPASS_URLS] : OVERPASS_URLS;
  let json = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        signal: sygnal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
      break;
    } catch (e) {
      if (e.name === "AbortError") throw e;
    }
  }
  if (!json) throw new Error("Overpass niedostępny");

  const budynki = (json.elements || [])
    .filter((el) => el.geometry?.length >= 4)
    .map((el) => {
      const ring = el.geometry.map((g) => [g.lon, g.lat]);
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
      try {
        return turf.polygon([ring]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const wynik = {};
  for (const p of linie) {
    const l = p.geometry.geometry ? p.geometry : turf.feature(p.geometry);
    wynik[p.id] = budynki.filter((b) => {
      try {
        return turf.booleanIntersects(l, b);
      } catch {
        return false;
      }
    }).length;
  }
  doPamieci(k, wynik);
  return wynik;
}
