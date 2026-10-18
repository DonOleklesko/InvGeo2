// Warstwy z efektem podświetlenia po najechaniu myszką:
// linie komunikacji, przystanki i parki.
import { memo } from "react";
import { GeoJSON, CircleMarker, Tooltip } from "react-leaflet";
import * as turf from "@turf/turf";
import { lineColor, lineLabel } from "../data/lineColors.js";
import { fmtHa } from "../model/simulate.js";

// ---------- LINIE ----------
// highlighted = zbiór id linii do podświetlenia (najechana linia, chip w panelu albo przystanek)
export function LinesLayer({ lines, visible, highlighted, onHover }) {
  if (!lines) return null;
  const cosPodswietlone = highlighted.size > 0;
  return lines.features
    .filter((f) => visible.has(f.properties.id))
    .map((f) => {
      const p = f.properties;
      const hl = highlighted.has(p.id);
      const kolor = lineColor(p);
      const base = p.mode === "tram" ? 4 : 2.5;
      return (
        <GeoJSON
          key={p.id}
          data={f}
          pane="linie"
          style={{
            color: kolor,
            weight: hl ? base + 4 : base,
            opacity: cosPodswietlone ? (hl ? 1 : 0.15) : 0.75,
            dashArray: p.nocna ? "6 6" : null,
            lineCap: "round",
          }}
          eventHandlers={{
            mouseover: (e) => {
              e.target.bringToFront();
              onHover(p.id);
            },
            mouseout: () => onHover(null),
          }}
        >
          <Tooltip sticky>
            <b>{lineLabel(p)}</b>
            {p.kierunki.slice(0, 2).map((k) => (
              <div key={k}>{k}</div>
            ))}
          </Tooltip>
        </GeoJSON>
      );
    });
}

// ---------- PRZYSTANKI ----------
// memo: nie przerysowujemy setek kropek, gdy zmienia się coś innego
export const StopsLayer = memo(function StopsLayer({ stops, linesById, onHover }) {
  if (!stops) return null;
  const normal = (f) => ({
    radius: f.properties.railway === "tram_stop" ? 4 : 3.5,
    color: "#fff",
    weight: 1,
    fillColor: f.properties.railway === "tram_stop" ? "#c92a2a" : "#1864ab",
    fillOpacity: 0.9,
  });
  return stops.features.map((f) => (
    <CircleMarker
      key={f.properties.id}
      center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
      pane="przystanki"
      pathOptions={normal(f)}
      eventHandlers={{
        mouseover: (e) => {
          e.target.setStyle({ radius: 8, weight: 3, color: "#ffd43b", fillOpacity: 1 });
          e.target.bringToFront();
          onHover(f.properties.linie);
        },
        mouseout: (e) => {
          e.target.setStyle(normal(f));
          onHover(null);
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -6]}>
        <b>{f.properties.name || "Przystanek"}</b>
        <div className="tt-lines">
          {f.properties.linie.length === 0 && <span className="muted">brak linii w danych</span>}
          {f.properties.linie.map((id) => {
            const p = linesById[id];
            return p ? (
              <span key={id} className="chip-mini" style={{ background: lineColor(p) }}>
                {p.ref}
              </span>
            ) : null;
          })}
        </div>
      </Tooltip>
    </CircleMarker>
  ));
});

// ---------- PARKI ----------
const PARK = { color: "#2f9e44", weight: 1, fillColor: "#69db7c", fillOpacity: 0.35 };
const PARK_HL = { color: "#2b8a3e", weight: 3, fillColor: "#40c057", fillOpacity: 0.7 };

export const ParksLayer = memo(function ParksLayer({ parks }) {
  if (!parks) return null;
  return (
    <GeoJSON
      key={"parks" + parks.features.length}
      data={parks}
      pane="parki"
      style={PARK}
      onEachFeature={(f, layer) => {
        let pow = 0;
        try {
          pow = turf.area(f);
        } catch {
          /* uszkodzona geometria */
        }
        const nazwa = f.properties?.name || f.properties?.tags?.name || "Teren zieleni";
        layer.bindTooltip(`<b>${escapeHtml(nazwa)}</b><br>${fmtHa(pow)}`, { sticky: true });
        layer.on({
          mouseover: () => {
            layer.setStyle(PARK_HL);
          },
          mouseout: () => layer.setStyle(PARK),
        });
      }}
    />
  );
});

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
