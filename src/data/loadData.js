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
// Linia wskazuje przystanek przez peron albo punkt zatrzymania – oba są w „aliasy” przystanku.
// Gdy linia nie ma w OSM listy przystanków (albo ma ich bardzo mało – np. część linii w Elblągu),
// dopasowujemy przystanki leżące przy jej trasie (do 30 m).
// Perony kolejowe odrzucamy.
const PRZY_TRASIE = 30; // m

function odlM([lon1, lat1], [lon2, lat2]) {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110540);
}

export function attachLinesToStops(stops, lines) {
  if (!stops) return stops;
  const lista = stops.features.filter((f) => f.properties.railway !== "platform" && f.properties.train !== "yes");
  const glowne = new Map(); // id lub alias -> id przystanku
  for (const f of lista) {
    glowne.set(f.properties.id, f.properties.id);
    for (const a of f.properties.aliasy || []) glowne.set(a, f.properties.id);
  }
  const mapa = new Map();
  const dodaj = (idPrzyst, idLinii) => {
    const l = mapa.get(idPrzyst) || mapa.set(idPrzyst, new Set()).get(idPrzyst);
    l.add(idLinii);
  };

  // siatka przystanków (ok. 70 m) do dopasowania po trasie
  const OKO = 0.001;
  let siatka = null;
  const obok = (c) => {
    if (!siatka) {
      siatka = new Map();
      for (const f of lista) {
        const [x, y] = f.geometry.coordinates;
        const k = `${Math.floor(x / OKO)}:${Math.floor(y / OKO)}`;
        (siatka.get(k) || siatka.set(k, []).get(k)).push(f);
      }
    }
    const cx = Math.floor(c[0] / OKO);
    const cy = Math.floor(c[1] / OKO);
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(siatka.get(`${cx + i}:${cy + j}`) || []));
    return out;
  };

  for (const l of lines?.features || []) {
    const id = l.properties.id;
    let trafione = 0;
    for (const s of l.properties.przystanki) {
      const g = glowne.get(s);
      if (g) dodaj(g, id), trafione++;
    }
    // długość trasy (km) – linia miejska ma zwykle przystanek co 400–600 m w każdą stronę
    const odcinki = l.geometry.type === "MultiLineString" ? l.geometry.coordinates : [l.geometry.coordinates];
    let dl = 0;
    for (const o of odcinki) for (let i = 1; i < o.length; i++) dl += odlM(o[i - 1], o[i]);
    if (trafione >= Math.max(3, (dl / 1000) * 0.5)) continue;
    // za mało przystanków w danych: dopasowanie po trasie (próbki co 15 m)
    const juz = new Set();
    for (const o of odcinki)
      for (let i = 1; i < o.length; i++) {
        const [a, b] = [o[i - 1], o[i]];
        const n = Math.max(1, Math.ceil(odlM(a, b) / 15));
        for (let k = 0; k <= n; k++) {
          const c = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          for (const f of obok(c)) {
            if (juz.has(f.properties.id) || odlM(c, f.geometry.coordinates) > PRZY_TRASIE) continue;
            juz.add(f.properties.id);
            dodaj(f.properties.id, id);
          }
        }
      }
  }
  const features = lista.map((f) => ({ ...f, properties: { ...f.properties, linie: [...(mapa.get(f.properties.id) || [])] } }));
  return { ...stops, features };
}
