// Rysowanie na mapie (biblioteka Leaflet-Geoman, ładowana przy pierwszym użyciu).
// Gdy "mode" = "Polygon" albo "Line", włącza rysowanie.
// Po zakończeniu rysowania przekazuje kształt (GeoJSON) do onCreated.
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { zaladujGeoman } from "./geoman.js";

export default function DrawControl({ mode, color, onCreated, onCancel }) {
  const map = useMap();

  // wstępne ładowanie w wolnej chwili – pierwsze rysowanie bez opóźnienia
  useEffect(() => {
    const ric = window.requestIdleCallback || ((f) => setTimeout(f, 2000));
    ric(() => zaladujGeoman(map));
  }, [map]);

  useEffect(() => {
    if (!mode) {
      map.pm?.disableDraw();
      return;
    }
    const handleKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    const handleCreate = (e) => {
      const geo = e.layer.toGeoJSON();
      map.removeLayer(e.layer); // sami rysujemy inwestycje ze stanu aplikacji
      onCreated(geo);
    };
    let aktywne = true;
    zaladujGeoman(map).then(() => {
      if (!aktywne) return;
      map.pm.enableDraw(mode, {
        snappable: false,
        finishOn: mode === "Line" ? "dblclick" : null,
        templineStyle: { color },
        hintlineStyle: { color, dashArray: [5, 5] },
        pathOptions: { color },
      });
      map.on("pm:create", handleCreate);
    });
    return () => {
      aktywne = false;
      map.off("pm:create", handleCreate);
      window.removeEventListener("keydown", handleKey);
      map.pm?.disableDraw();
    };
  }, [map, mode, color, onCreated, onCancel]);

  return null;
}
