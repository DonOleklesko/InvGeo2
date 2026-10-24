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
      kind: "stops",
      // perony (punkty i obszary) oraz punkty zatrzymania na jezdni / torowisku – w części miast
      // (np. Bydgoszcz) wiele przystanków ma w OSM tylko jedno z nich; scalamy je w convert.js
      query: `[out:json][timeout:90];
(
  node["highway"="bus_stop"](${bb});
  way["highway"="bus_stop"](${bb});
  node["public_transport"="platform"](${bb});
  way["public_transport"="platform"]["railway"!="platform"](${bb});
  node["railway"="tram_stop"](${bb});
  node["public_transport"="stop_position"]["bus"="yes"](${bb});
  node["public_transport"="stop_position"]["tram"="yes"](${bb});
);
out center;`,
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
    // drogi główne – także w budowie (highway=construction): wkrótce będą otwarte, a bez nich
    // model proponowałby drogi, które miasto właśnie buduje
    roads: {
      label: "Drogi główne",
      kind: "lines",
      query: `[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb});
  way["highway"="construction"]["construction"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb});
);
out geom tags;`,
    },
    // ulice lokalne i drogi dojazdowe (service) – bez nich model „nie widzi” istniejących
    // połączeń i proponuje drogi, które już są; bez prywatnych dojazdów i alejek parkingowych
    streets: {
      label: "Ulice lokalne",
      kind: "lines",
      query: `[out:json][timeout:180];
(
  way["highway"~"^(unclassified|residential|living_street|road)$"](${bb});
  way["highway"="service"]["access"!~"^(private|no|customers|delivery)$"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"](${bb});
  way["highway"="construction"]["construction"~"^(unclassified|residential|living_street|road|service)$"](${bb});
);
out geom tags;`,
    },
    // budynki – zapisywane jako siatka zajętości (ok. 5 m), żeby nowe drogi omijały domy
    buildings: {
      label: "Budynki",
      kind: "raster",
      query: (bbKafla) => `[out:json][timeout:180];
way["building"](${bbKafla});
out skel geom qt;`,
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
    // przeszkody dla nowych dróg: tory kolejowe (wiadukt) i kanały (most)
    railways: {
      label: "Tory kolejowe i kanały",
      kind: "lines",
      query: `[out:json][timeout:90];
(
  way["railway"="rail"]["service"!~"yard|siding|spur"](${bb});
  way["waterway"="canal"](${bb});
);
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
