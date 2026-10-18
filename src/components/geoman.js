// Leaflet-Geoman (rysowanie i edycja kształtów) ładowany na żądanie – ok. 280 KB mniej
// przy starcie. Mapa powstaje wcześniej, więc po załadowaniu dopinamy do niej map.pm.
import L from "leaflet";

let ladowanie = null;
export function zaladujGeoman(map) {
  ladowanie ||= Promise.all([
    import("@geoman-io/leaflet-geoman-free"),
    import("@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"),
  ]);
  return ladowanie.then(() => {
    if (!map.pm) {
      L.PM.reInitLayer(map);
      map.pm.setLang("pl");
    }
    return map;
  });
}
