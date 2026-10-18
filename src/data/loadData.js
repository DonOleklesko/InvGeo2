// Wczytywanie danych w przeglądarce.
// Kolejność: 1) pliki w public/data (z "npm run fetch-data")
//            2) pamięć przeglądarki (localStorage, ważna 7 dni)
//            3) na żywo z Overpass API
import * as turf from "@turf/turf";
import { LAYERS, OVERPASS_URLS } from "./queries.js";
import { MIASTO, PREFIKS } from "./miasta.js";

const CACHE_PREFIX = PREFIKS + "data:";
const CACHE_DAYS = 7;

// Pliki statyczne pobieramy równolegle (wywołanie prefetch), a przetwarzamy po kolei
const pobierane = new Map();
export function prefetchStatic(names) {
  for (const n of names) if (!pobierane.has(n)) pobierane.set(n, pobierzPlik(n));
}

function fromStaticFile(name) {
  const p = pobierane.get(name) || pobierzPlik(name);
  pobierane.delete(name); // jednorazowo – ponowne wczytanie (np. „ponów”) pobiera od nowa
  return p;
}

async function pobierzPlik(name) {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${MIASTO.id}/${name}.geojson`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.features ? json : null;
  } catch {
    return null;
  }
}

function fromCache(name) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + name);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (Date.now() - savedAt > CACHE_DAYS * 864e5) return null;
    return data;
  } catch {
    return null;
  }
}

function toCache(name, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + name, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* brak miejsca lub zablokowane – trudno, działamy dalej */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Publiczne serwery Overpass bywają przeciążone (HTTP 429/502/504),
// więc próbujemy kolejne serwery w kilku rundach, z przerwą.
async function fromOverpass(name, onRetry) {
  const layer = LAYERS[name];
  let lastError;
  for (let round = 0; round < 3; round++) {
    // w trybie dev najpierw przez pośrednika Vite (bez problemów z CORS)
    const urls = import.meta.env.DEV ? ["/overpass", ...OVERPASS_URLS] : OVERPASS_URLS;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(layer.query),
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // konwersja (osmtogeojson) ładowana tylko, gdy brak plików i trzeba pytać Overpass
        const { overpassToGeoJSON } = await import("./convert.js");
        const fc = overpassToGeoJSON(await res.json(), layer.kind);
        if (!fc.features.length && name === "boundary") throw new Error("pusta granica");
        return fc;
      } catch (e) {
        lastError = e;
      }
    }
    onRetry?.(round + 1);
    await sleep(4000 * (round + 1));
  }
  throw lastError || new Error("Overpass niedostępny");
}

export async function loadLayer(name, { force = false, onRetry } = {}) {
  if (!force) {
    const file = await fromStaticFile(name);
    if (file) return { data: file, source: "plik" };
    const cached = fromCache(name);
    if (cached) return { data: cached, source: "pamięć" };
  }
  const data = await fromOverpass(name, onRetry);
  toCache(name, data);
  return { data, source: "Overpass" };
}

// Zostawia tylko obiekty leżące w granicach miasta.
export function clipToBoundary(fc, boundary) {
  if (!fc || !boundary?.features?.length) return fc;
  const city = boundary.features[0];
  return {
    ...fc,
    features: fc.features.filter((f) => {
      try {
        const pt = f.geometry.type === "Point" ? f : turf.centroid(f);
        return turf.booleanPointInPolygon(pt, city);
      } catch {
        return false;
      }
    }),
  };
}

// Wybiera najlepszą granicę: największy wielokąt z nazwą miasta.
export function pickCityBoundary(fc) {
  if (!fc?.features?.length) return fc;
  const best = [...fc.features].sort((a, b) => turf.area(b) - turf.area(a))[0];
  return { type: "FeatureCollection", features: [best] };
}

// Dopisuje do każdego przystanku listę linii, które się na nim zatrzymują.
// Przystanki bez żadnej linii i bez nazwy (np. perony kolejowe) odrzucamy.
export function attachLinesToStops(stops, lines) {
  if (!stops) return stops;
  const mapa = {};
  for (const l of lines?.features || []) {
    for (const s of l.properties.przystanki) (mapa[s] ??= []).push(l.properties.id);
  }
  const features = stops.features
    .filter((f) => f.properties.railway !== "platform" && f.properties.train !== "yes")
    .map((f) => ({ ...f, properties: { ...f.properties, linie: mapa[f.properties.id] || [] } }));
  return { ...stops, features };
}
