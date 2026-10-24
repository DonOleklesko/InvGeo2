// Wczytanie siatki budynków miasta (public/data/<miasto>/buildings.bin, z npm run fetch-data).
// Działa w oknie i w wątku (Web Worker). Brak pliku = null (propozycje bez sprawdzania budynków).
import { MIASTO } from "./miasta.js";
import { odkoduj } from "./raster.js";

let obietnica = null;
export function wczytajBudynki() {
  if (!obietnica)
    obietnica = fetch(`${import.meta.env?.BASE_URL || "/"}data/${MIASTO.id}/buildings.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? odkoduj(b) : null))
      .catch(() => null);
  return obietnica;
}
