// Pobiera dane z OpenStreetMap (Overpass) i zapisuje je do public/data/<miasto>/*.geojson.
// Uruchom:  npm run fetch-data                       (wszystkie miasta, tylko brakujące pliki)
//           npm run fetch-data -- --miasto elblag    (jedno miasto: torun, bydgoszcz, elblag)
//           npm run fetch-data -- --force            (pobiera wszystko od nowa)
// Dzięki temu aplikacja nie musi pytać Overpass przy każdym uruchomieniu.
import { writeFile, mkdir, access } from "node:fs/promises";
import { warstwyDla, OVERPASS_URLS } from "../src/data/queries.js";
import { MIASTA } from "../src/data/miasta.js";
import { overpassToGeoJSON } from "../src/data/convert.js";

const FORCE = process.argv.includes("--force");
const iArg = process.argv.indexOf("--miasto");
const wybrane = iArg > 0 ? [process.argv[iArg + 1]] : Object.keys(MIASTA);
for (const id of wybrane) if (!MIASTA[id]) throw new Error(`Nieznane miasto: ${id} (dostępne: ${Object.keys(MIASTA).join(", ")})`);
const ROUNDS = 4; // ile razy próbujemy całą listę serwerów

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(q) {
  let lastError;
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(q),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            // Overpass odrzuca zapytania bez User-Agent (HTTP 406)
            "User-Agent": "invgeo-prototype/1.0 (hackathon)",
          },
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} z ${url}`);
        return await res.json();
      } catch (e) {
        lastError = e;
        console.warn("  ! " + e.message + " – próbuję kolejny serwer");
      }
    }
    const wait = 5000 * (round + 1);
    console.warn(`  … serwery zajęte, czekam ${wait / 1000} s`);
    await sleep(wait);
  }
  throw lastError;
}

const exists = (OUT, name) =>
  access(new URL(`${name}.geojson`, OUT)).then(
    () => true,
    () => false
  );

let failed = 0;
for (const id of wybrane) {
  const OUT = new URL(`../public/data/${id}/`, import.meta.url);
  await mkdir(OUT, { recursive: true });
  console.log(`=== ${MIASTA[id].nazwa} ===`);
  for (const [name, layer] of Object.entries(warstwyDla(MIASTA[id]))) {
    if (!FORCE && (await exists(OUT, name))) {
      console.log(`Pomijam: ${layer.label} (plik już jest, użyj --force)`);
      continue;
    }
    console.log(`Pobieram: ${layer.label}...`);
    try {
      const json = await query(layer.query);
      const fc = overpassToGeoJSON(json, layer.kind);
      fc.metadata = {
        source: "© OpenStreetMap contributors, ODbL 1.0",
        fetchedAt: new Date().toISOString(),
      };
      await writeFile(new URL(`${name}.geojson`, OUT), JSON.stringify(fc));
      console.log(`  OK: ${fc.features.length} obiektów -> public/data/${id}/${name}.geojson`);
    } catch (e) {
      failed++;
      console.error(`  BŁĄD: Nie udało się pobrać: ${layer.label} (${e.message})`);
    }
    await sleep(1500); // grzecznie wobec serwera
  }
}
console.log(failed ? `Gotowe, ale ${failed} warstw nie pobrano – uruchom ponownie.` : "Gotowe.");
process.exitCode = failed ? 1 : 0;
