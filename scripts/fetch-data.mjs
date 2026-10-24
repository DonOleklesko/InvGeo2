// Pobiera dane z OpenStreetMap (Overpass) i zapisuje je do public/data/<miasto>/*.geojson.
// Uruchom:  npm run fetch-data                       (wszystkie miasta, tylko brakujące pliki)
//           npm run fetch-data -- --miasto elblag    (jedno miasto: torun, bydgoszcz, elblag)
//           npm run fetch-data -- --force            (pobiera wszystko od nowa)
//           npm run fetch-data -- --warstwy stops,lines (tylko wybrane warstwy, zawsze od nowa)
// Dzięki temu aplikacja nie musi pytać Overpass przy każdym uruchomieniu.
import { writeFile, mkdir, access, readFile } from "node:fs/promises";
import { warstwyDla, OVERPASS_URLS } from "../src/data/queries.js";
import { MIASTA } from "../src/data/miasta.js";
import { overpassToGeoJSON } from "../src/data/convert.js";
import { nowaSiatka, zaznaczWielokat, zakoduj } from "../src/data/raster.js";

const FORCE = process.argv.includes("--force");
const iArg = process.argv.indexOf("--miasto");
const wybrane = iArg > 0 ? [process.argv[iArg + 1]] : Object.keys(MIASTA);
for (const id of wybrane) if (!MIASTA[id]) throw new Error(`Nieznane miasto: ${id} (dostępne: ${Object.keys(MIASTA).join(", ")})`);
const iWarstwy = process.argv.indexOf("--warstwy");
const tylkoWarstwy = iWarstwy > 0 ? process.argv[iWarstwy + 1].split(",") : null;
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

const exists = (OUT, name, ext = "geojson") =>
  access(new URL(`${name}.${ext}`, OUT)).then(
    () => true,
    () => false
  );

let failed = 0;
for (const id of wybrane) {
  const OUT = new URL(`../public/data/${id}/`, import.meta.url);
  await mkdir(OUT, { recursive: true });
  console.log(`=== ${MIASTA[id].nazwa} ===`);
  for (const [name, layer] of Object.entries(warstwyDla(MIASTA[id]))) {
    if (tylkoWarstwy && !tylkoWarstwy.includes(name)) continue;
    if (!FORCE && !tylkoWarstwy && (await exists(OUT, name, layer.kind === "raster" ? "bin" : "geojson"))) {
      console.log(`Pomijam: ${layer.label} (plik już jest, użyj --force)`);
      continue;
    }
    console.log(`Pobieram: ${layer.label}...`);
    if (layer.kind === "raster") {
      // budynki: kafle ok. 5 × 4 km (całe miasto naraz to zbyt duże zapytanie), od razu na siatkę
      try {
        const [S, W, N, E] = MIASTA[id].bbox;
        const siatka = nowaSiatka(MIASTA[id].bbox);
        // małe kafle (ok. 1,7 × 1,7 km) – duże przy gęstej zabudowie przekraczają limity serwerów
        const KL = 0.025, KS = 0.015;
        // kafle poza granicą miasta pomijamy (granica z pliku, jeśli już jest)
        let granica = null;
        try {
          const b = JSON.parse(await readFile(new URL("boundary.geojson", OUT), "utf8"));
          granica = b.features.map((f) => f.geometry).filter((g) => /Polygon/.test(g?.type));
        } catch {
          /* bez granicy – wszystkie kafle */
        }
        const wPierscieniu = (x, y, r) => {
          let w = false;
          for (let i = 0, j = r.length - 1; i < r.length; j = i++)
            if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) w = !w;
          return w;
        };
        const wMiescie = (x, y) =>
          !granica || granica.some((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).some((p) => wPierscieniu(x, y, p[0])));
        const kafelWMiescie = (x, y) => {
          for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (wMiescie(x + (KL * i) / 4, y + (KS * j) / 4)) return true;
          return false;
        };
        let budynki = 0;
        let nr = 0;
        const kafle = Math.ceil((E - W) / KL) * Math.ceil((N - S) / KS);
        for (let x = W; x < E; x += KL)
          for (let y = S; y < N; y += KS) {
            nr++;
            if (!kafelWMiescie(x, y)) continue;
            const json = await query(layer.query([y, x, Math.min(N, y + KS), Math.min(E, x + KL)].map((v) => v.toFixed(5)).join(",")));
            for (const el of json.elements || []) {
              if (el.type !== "way" || !el.geometry) continue;
              zaznaczWielokat(siatka, el.geometry.map((g) => [g.lon, g.lat]));
              budynki++;
            }
            if (nr % 10 === 0) console.log(`  kafel ${nr}/${kafle}: razem ${budynki} budynków`);
            await sleep(500);
          }
        const bin = zakoduj(siatka);
        await writeFile(new URL(`${name}.bin`, OUT), bin);
        console.log(`  OK: ${budynki} budynków -> public/data/${id}/${name}.bin (${Math.round(bin.length / 1024)} kB)`);
      } catch (e) {
        failed++;
        console.error(`  BŁĄD: Nie udało się pobrać: ${layer.label} (${e.message})`);
      }
      continue;
    }
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
