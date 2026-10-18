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
          highway: t.highway,
          waterway: t.waterway,
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
    if (/^d{5,}$/.test(t.ref)) continue; // numery 5-cyfrowe to linie regionalne (np. PKS), nie miejskie
    const id = `${t.route}:${t.ref}`;
    const L = (linie[id] ??= { ref: t.ref, mode: t.route, kierunki: new Set(), odcinki: new Map(), przystanki: new Set() });
    if (t.from && t.to) L.kierunki.add(`${t.from} → ${t.to}`);

    for (const m of r.members || []) {
      if (m.type === "way" && m.geometry && ["", "forward", "backward"].includes(m.role)) {
        if (!L.odcinki.has(m.ref)) L.odcinki.set(m.ref, m.geometry.map((p) => [round(p.lon), round(p.lat)]));
      }
      if (m.type === "node" && /stop|platform/.test(m.role)) L.przystanki.add(`node/${m.ref}`);
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

// linie nocne: „N1” (Toruń) albo „31N”, „33NŁ” (Bydgoszcz)
export const czyNocna = (ref) => /^N|^d+N/i.test(ref);

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
