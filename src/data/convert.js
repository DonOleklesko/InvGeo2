// Zamiana odpowiedzi Overpass (JSON) na GeoJSON.
import osmtogeojson from "osmtogeojson";

export function overpassToGeoJSON(json, kind) {
  if (kind === "osm") {
    const fc = osmtogeojson(json);
    // zostawiamy tylko wielokąty (granice, parki)
    fc.features = fc.features.filter((f) => f.geometry && /Polygon/.test(f.geometry.type));
    return fc;
  }

  if (kind === "zones") {
    const fc = osmtogeojson(json);
    const features = [];
    for (const f of fc.features) {
      if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue;
      const t = f.properties?.tags || f.properties || {};
      const rodzaj = t.building === "office" || t.office ? "biurowa" : t.landuse === "industrial" ? "przemyslowa" : "handlowa";
      features.push({
        type: "Feature",
        properties: { id: f.id || f.properties?.id, name: t.name || "", rodzaj },
        geometry: roundGeom(f.geometry),
      });
    }
    return { type: "FeatureCollection", features };
  }

  if (kind === "points") {
    const features = [];
    for (const el of json.elements || []) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      features.push({
        type: "Feature",
        properties: { id: `${el.type}/${el.id}`, name: el.tags?.name || "", ...pickTags(el.tags) },
        geometry: { type: "Point", coordinates: [round(lon), round(lat)] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  if (kind === "stops") return stopsToGeoJSON(json);

  if (kind === "lines") {
    const features = [];
    for (const el of json.elements || []) {
      if (!el.geometry) continue;
      const t = el.tags || {};
      features.push({
        type: "Feature",
        properties: {
          id: `${el.type}/${el.id}`,
          name: t.name || "",
          // droga w budowie: klasa docelowa z tagu „construction” (np. tertiary), oznaczona jako w budowie
          highway: t.highway === "construction" ? t.construction : t.highway,
          ...(t.highway === "construction" ? { budowa: "yes" } : {}),
          waterway: t.waterway,
          railway: t.railway,
          // tory na moście lub w tunelu nie są przeszkodą dla nowej drogi
          bridge: t.bridge && t.bridge !== "no" ? "yes" : undefined,
          tunnel: t.tunnel && t.tunnel !== "no" ? "yes" : undefined,
          lanes: t.lanes,
          maxspeed: t.maxspeed,
          oneway: t.oneway,
          ref: t.ref,
        },
        geometry: { type: "LineString", coordinates: el.geometry.map((p) => [p.lon, p.lat]) },
      });
    }
    return { type: "FeatureCollection", features };
  }

  if (kind === "routes") return routesToGeoJSON(json);

  throw new Error("Nieznany typ warstwy: " + kind);
}

// Linie komunikacji: w OSM każda linia ma kilka relacji (kierunki, warianty).
// Łączymy je w JEDNĄ linię (np. "tram:2") z unikalnymi odcinkami trasy
// i listą przystanków, na których się zatrzymuje.
function routesToGeoJSON(json) {
  const linie = {};
  for (const r of json.elements || []) {
    const t = r.tags || {};
    if (!t.ref) continue;
    if (/flix/i.test(`${t.operator || ""} ${t.network || ""}`)) continue; // pomijamy autobusy dalekobieżne
    // numery 4+ cyfrowe (także z literą, np. „K1299”) to linie regionalne, dalekobieżne i międzynarodowe
    if (/^[A-Z]?\d{4,}$/i.test(t.ref)) continue;
    const id = `${t.route}:${t.ref}`;
    const L = (linie[id] ??= { ref: t.ref, mode: t.route, kierunki: new Set(), odcinki: new Map(), przystanki: new Set() });
    if (t.from && t.to) L.kierunki.add(`${t.from} → ${t.to}`);

    for (const m of r.members || []) {
      if (m.type === "way" && m.geometry && ["", "forward", "backward"].includes(m.role)) {
        if (!L.odcinki.has(m.ref)) L.odcinki.set(m.ref, m.geometry.map((p) => [round(p.lon), round(p.lat)]));
      }
      // przystanek: peron (punkt lub obszar) albo punkt zatrzymania
      if ((m.type === "node" || (m.type === "way" && /platform/.test(m.role))) && /stop|platform/.test(m.role)) L.przystanki.add(`${m.type}/${m.ref}`);
    }
  }

  const features = Object.entries(linie)
    .filter(([, L]) => L.odcinki.size > 0)
    .map(([id, L]) => ({
      type: "Feature",
      properties: {
        id,
        ref: L.ref,
        mode: L.mode, // "tram" albo "bus"
        nocna: czyNocna(L.ref),
        kierunki: [...L.kierunki],
        przystanki: [...L.przystanki],
      },
      geometry: { type: "MultiLineString", coordinates: [...L.odcinki.values()] },
    }))
    .sort((a, b) => sortRef(a.properties) - sortRef(b.properties));

  return { type: "FeatureCollection", features };
}

// Przystanki: w OSM jeden przystanek bywa opisany kilkoma obiektami – peronem (punkt albo
// obszar) i punktem zatrzymania na jezdni/torowisku. Część przystanków ma tylko jeden z nich.
// Scalamy je: punkt zatrzymania do 40 m od peronu o tej samej nazwie (albo bez nazwy) i peron-obszar
// tuż przy peronie-punkcie to ten sam przystanek. Wszystkie id trafiają do „aliasy”, żeby trasy
// linii (które wskazują raz peron, raz punkt zatrzymania) trafiały w jeden przystanek.
const SCAL_PERON = 40; // m
const SCAL_DUBEL = 15; // m – dwa perony tej samej nazwy tak blisko to jeden peron

function odlM([lon1, lat1], [lon2, lat2]) {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110540);
}
const ta_sama_nazwa = (a, b) => !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

function stopsToGeoJSON(json) {
  const obiekty = [];
  for (const el of json.elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    if (t.railway === "platform" || t.train === "yes") continue; // perony kolejowe
    const punktZatrzymania = t.public_transport === "stop_position" || (t.railway === "tram_stop" && t.public_transport !== "platform");
    obiekty.push({
      id: `${el.type}/${el.id}`,
      c: [round(lon), round(lat)],
      nazwa: t.name || "",
      peron: !punktZatrzymania,
      tram: t.tram === "yes" || t.railway === "tram_stop",
      tagi: pickTags(t),
    });
  }
  // siatka ok. 70 m do szukania sąsiadów
  const OKO = 0.001;
  const siatka = new Map();
  const kl = (c) => `${Math.floor(c[0] / OKO)}:${Math.floor(c[1] / OKO)}`;
  for (const o of obiekty) if (o.peron) (siatka.get(kl(o.c)) || siatka.set(kl(o.c), []).get(kl(o.c))).push(o);
  const obok = (c) => {
    const cx = Math.floor(c[0] / OKO);
    const cy = Math.floor(c[1] / OKO);
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(siatka.get(`${cx + i}:${cy + j}`) || []));
    return out;
  };

  const glowny = new Map(); // id obiektu -> obiekt, do którego go dołączono
  // 1) perony-obszary i podwójne perony: dołącz do peronu-punktu (pierwszeństwo: węzeł)
  const perony = obiekty.filter((o) => o.peron).sort((a, b) => (a.id.startsWith("node") ? 0 : 1) - (b.id.startsWith("node") ? 0 : 1));
  for (const o of perony) {
    if (glowny.has(o.id)) continue;
    for (const p of obok(o.c)) {
      if (p === o || glowny.has(p.id) || !ta_sama_nazwa(o.nazwa, p.nazwa)) continue;
      if (odlM(o.c, p.c) <= SCAL_DUBEL) glowny.set(p.id, o);
    }
  }
  // 2) punkty zatrzymania: do najbliższego peronu tej samej nazwy w 40 m
  for (const o of obiekty) {
    if (o.peron) continue;
    let best = null;
    for (const p of obok(o.c)) {
      if (glowny.has(p.id) || !ta_sama_nazwa(o.nazwa, p.nazwa) || (o.tram && !p.tram && !p.nazwa)) continue;
      const d = odlM(o.c, p.c);
      if (d <= SCAL_PERON && (!best || d < best.d)) best = { d, p };
    }
    if (best) glowny.set(o.id, best.p);
  }

  const poId = new Map(obiekty.map((o) => [o.id, o]));
  const aliasy = new Map();
  for (const [id, g] of glowny) (aliasy.get(g.id) || aliasy.set(g.id, []).get(g.id)).push(id);
  const features = obiekty
    .filter((o) => !glowny.has(o.id))
    .map((o) => {
      const dolaczone = (aliasy.get(o.id) || []).map((id) => poId.get(id));
      const nazwa = o.nazwa || dolaczone.find((x) => x?.nazwa)?.nazwa || "";
      const tram = o.tram || dolaczone.some((x) => x?.tram);
      return {
        type: "Feature",
        properties: {
          ...o.tagi,
          id: o.id,
          name: nazwa,
          ...(tram && !o.tagi.railway ? { tram: "yes" } : {}),
          ...(aliasy.has(o.id) ? { aliasy: aliasy.get(o.id) } : {}),
          ...(o.peron ? {} : { tylkoPunktZatrzymania: true }),
        },
        geometry: { type: "Point", coordinates: o.c },
      };
    });
  return { type: "FeatureCollection", features };
}

// linie nocne: „N1” (Toruń) albo „31N”, „33NŁ” (Bydgoszcz)
export const czyNocna = (ref) => /^N|^\d+N/i.test(ref);

// tramwaje najpierw, potem autobusy dzienne, na końcu nocne
function sortRef(p) {
  const n = parseInt(p.ref.replace(/\D/g, "")) || 0;
  return (p.mode === "tram" ? 0 : p.nocna ? 20000 : 10000) + n;
}

const round = (x) => Math.round(x * 1e5) / 1e5; // ~1 m dokładności, mniejsze pliki

function roundGeom(g) {
  const r = (c) => (typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(r));
  return { type: g.type, coordinates: r(g.coordinates) };
}

function pickTags(tags = {}) {
  const out = {};
  for (const k of [
    "highway", "railway", "amenity", "bus", "tram", "public_transport", "train", "isced:level", "operator",
    "capacity", "park_ride", "parking", "fee", "socket:type2", "capacity:charging", "emergency", "healthcare:speciality",
  ]) {
    if (tags[k]) out[k] = tags[k];
  }
  return out;
}
