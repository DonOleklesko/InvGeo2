// Zapytania do Overpass API (OpenStreetMap) – dla wybranego miasta (src/data/miasta.js).
import { MIASTO } from "./miasta.js";

// Prostokąt (bbox) miasta z małym zapasem: południe, zachód, północ, wschód
export const MIASTO_BBOX = MIASTO.bbox;

// Środek mapy (okolice Starego Miasta)
export const MIASTO_CENTRUM = MIASTO.centrum;

// Każda warstwa: nazwa pliku + zapytanie Overpass QL.
// "kind" mówi, jak zamienić wynik na GeoJSON:
//   "points" – obiekty zamieniane na punkty (węzły lub środki budynków)
//   "lines"  – drogi / rzeki jako linie (wymaga "out geom")
//   "osm"    – pełna konwersja przez osmtogeojson (wielokąty, relacje)
//   "zones"  – jak "osm", ale z rodzajem strefy (przemysłowa, biurowa, handlowa)
//   "routes" – linie tramwajowe i autobusowe (relacje route)
export function warstwyDla(miasto) {
  const bb = miasto.bbox.join(",");
  return {
    boundary: {
      label: "Granica miasta",
      kind: "osm",
      query: `[out:json][timeout:60];
rel["boundary"="administrative"]["name"="${miasto.osmNazwa}"]["admin_level"~"^(6|7|8)$"](${bb});
(._;>;);
out body;`,
    },
    stops: {
      label: "Przystanki",
      kind: "points",
      // perony (miejsca, gdzie czekają pasażerowie) – tak samo oznaczone są w trasach linii
      query: `[out:json][timeout:60];
(
  node["highway"="bus_stop"](${bb});
  node["public_transport"="platform"](${bb});
  node["railway"="tram_stop"](${bb});
);
out body;`,
    },
    lines: {
      label: "Linie tramwajowe i autobusowe",
      kind: "routes",
      query: `[out:json][timeout:120];
rel["type"="route"]["route"~"^(bus|tram)$"](${bb});
out geom;`,
    },
    schools: {
      label: "Szkoły",
      kind: "points",
      query: `[out:json][timeout:60];
nwr["amenity"="school"](${bb});
out center tags;`,
    },
    parks: {
      label: "Parki i zieleń",
      kind: "osm",
      query: `[out:json][timeout:90];
(
  way["leisure"="park"](${bb});
  relation["leisure"="park"](${bb});
  way["landuse"="recreation_ground"](${bb});
  way["landuse"="village_green"](${bb});
);
(._;>;);
out body;`,
    },
    roads: {
      label: "Drogi główne",
      kind: "lines",
      query: `[out:json][timeout:90];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb});
out geom tags;`,
    },
    // ulice lokalne – razem z drogami głównymi tworzą sieć, po której prowadzimy nowe trasy
    streets: {
      label: "Ulice lokalne",
      kind: "lines",
      query: `[out:json][timeout:120];
way["highway"~"^(unclassified|residential|living_street)$"](${bb});
out geom tags;`,
    },
    // tereny zabudowy mieszkaniowej – popyt na przystanki (bez przystanków „na łące”)
    residential: {
      label: "Tereny mieszkaniowe",
      kind: "osm",
      query: `[out:json][timeout:120];
(
  way["landuse"="residential"](${bb});
  relation["landuse"="residential"](${bb});
);
(._;>;);
out body;`,
    },
    rivers: {
      label: "Rzeki",
      kind: "lines",
      query: `[out:json][timeout:60];
way["waterway"="river"](${bb});
out geom tags;`,
    },
    parkings: {
      label: "Parkingi",
      kind: "points",
      query: `[out:json][timeout:60];
nwr["amenity"="parking"]["access"!~"private|no"](${bb});
out center tags;`,
    },
    hospitals: {
      label: "Szpitale",
      kind: "points",
      query: `[out:json][timeout:60];
nwr["amenity"="hospital"](${bb});
out center tags;`,
    },
    chargers: {
      label: "Ładowarki EV",
      kind: "points",
      query: `[out:json][timeout:60];
nwr["amenity"="charging_station"](${bb});
out center tags;`,
    },
    zones: {
      label: "Strefy przemysłowe i biurowe",
      kind: "zones",
      query: `[out:json][timeout:120];
(
  way["landuse"~"^(industrial|commercial|retail)$"](${bb});
  relation["landuse"~"^(industrial|commercial|retail)$"](${bb});
  way["building"="office"](${bb});
);
(._;>;);
out body;`,
    },
  };
}

export const LAYERS = warstwyDla(MIASTO);

// Kilka publicznych serwerów Overpass – jeśli jeden nie działa, próbujemy następny.
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
