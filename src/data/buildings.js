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

// Zwraca { [idPropozycji]: liczbaPrzecinanychBudynków }
export async function budynkiNaTrasach(propozycje, sygnal) {
  const linie = propozycje.filter((p) => p.geometry?.geometry?.type === "LineString" || p.geometry?.type === "LineString");
  if (!linie.length) return {};
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
