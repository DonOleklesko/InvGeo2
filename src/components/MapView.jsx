// Mapa wybranego miasta: podkład OSM, maska poza miastem, warstwy danych (komunikacja, ruch,
// hałas, strefy pracy, parkingi, ładowarki), inwestycje z aktywnego wariantu i mapa skutków.
import { memo, useEffect, useMemo, useRef } from "react";
import Ikona, { ikonaHtml } from "./Ikona.jsx";
import L from "leaflet";
import {
  MapContainer, TileLayer, GeoJSON, CircleMarker, Polygon, Polyline, Tooltip, Popup,
  LayersControl, LayerGroup, ScaleControl, Pane, Marker, useMap, useMapEvents,
} from "react-leaflet";
import { useLeafletContext } from "@react-leaflet/core";
import "leaflet/dist/leaflet.css";
import DrawControl from "./DrawControl.jsx";
import { zaladujGeoman } from "./geoman.js";
import { LinesLayer, StopsLayer, ParksLayer } from "./TransitLayers.jsx";
import { PASMA_RUCHU, PASMA_HALASU, pasmo } from "./TrafficPanel.jsx";
import { MIASTO_BBOX, MIASTO_CENTRUM } from "../data/queries.js";
import { TYPY } from "../model/config.js";
import { KLASY_DROG } from "../model/traffic.js";

const [S, W, N, E] = MIASTO_BBOX;
const MAX_BOUNDS = [[S - 0.05, W - 0.1], [N + 0.05, E + 0.1]];

// Maska: cały świat z "dziurą" w kształcie miasta
function CityMask({ boundary }) {
  const positions = useMemo(() => {
    const f = boundary?.features?.[0];
    if (!f) return null;
    const world = [[90, -180], [90, 180], [-90, 180], [-90, -180]];
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const holes = polys.map((p) => p[0].map(([lng, lat]) => [lat, lng]));
    return [world, ...holes];
  }, [boundary]);
  if (!positions) return null;
  return (
    <Polygon
      positions={positions}
      interactive={false}
      pathOptions={{ color: "#343a40", weight: 2, fillColor: "#212529", fillOpacity: 0.45 }}
    />
  );
}

// Warstwa natężenia ruchu / hałasu: tysiące odcinków, więc rysujemy je bezpośrednio
// w Leaflet i przy zmianie godziny tylko zmieniamy kolory (bez przebudowy).
function RuchLayer({ stan, tryb }) {
  const map = useMap();
  const linie = useRef([]);
  const style = useRef([]); // ostatnio ustawiony styl odcinka (pomijamy setStyle, gdy bez zmian)
  const biezacy = useRef({ stan, tryb });
  biezacy.current = { stan, tryb };
  const lista = stan?.lista;

  useEffect(() => {
    if (!lista || tryb === "brak") return;
    const renderer = L.canvas({ padding: 0.3, pane: "ruch" });
    const g = L.layerGroup().addTo(map);
    // treść tooltipa liczona dopiero przy najechaniu (z bieżącej godziny), nie dla tysięcy odcinków naraz
    const tresc = (i) => () => {
      const { stan: st, tryb: tr } = biezacy.current;
      const { o, sdr } = st.lista[i];
      if (tr === "halas") {
        const db = st.lden[i];
        return `<b>${o.nazwa || "droga bez nazwy"}</b><br>Hałas Lden przy jezdni: ${Math.round(db)} dB (${pasmo(PASMA_HALASU, db).label})`;
      }
      const vc = st.vc[i];
      return (
        `<b>${o.nazwa || "droga bez nazwy"}</b>${o.nowa ? " (nowa)" : ""}<br>${KLASY_DROG[o.klasa]?.label || o.klasa}` +
        `<br>Ruch dobowy: ${Math.round(sdr).toLocaleString("pl-PL")} poj.` +
        `<br>Obciążenie: ${Math.round(vc * 100)}% przepustowości – ${pasmo(PASMA_RUCHU, vc).label}`
      );
    };
    linie.current = lista.map(({ o }, i) =>
      L.polyline(o.wsp.map(([lng, lat]) => [lat, lng]), { renderer, pane: "ruch", weight: 3, opacity: 0.9 })
        .bindTooltip(tresc(i), { sticky: true })
        .addTo(g)
    );
    style.current = [];
    return () => {
      g.remove();
      renderer.remove(); // inaczej każda zmiana zostawiała pusty canvas na mapie
      linie.current = [];
      style.current = [];
    };
  }, [map, lista, tryb]);

  useEffect(() => {
    if (!stan || tryb === "brak") return;
    lista.forEach(({ o }, i) => {
      const l = linie.current[i];
      if (!l) return;
      const gruba = o.klasa === "motorway" || o.klasa === "trunk" ? 5 : o.klasa === "primary" ? 4 : 3;
      const p = tryb === "halas" ? pasmo(PASMA_HALASU, stan.lden[i]) : pasmo(PASMA_RUCHU, stan.vc[i]);
      if (style.current[i] === p) return;
      style.current[i] = p;
      l.setStyle(
        tryb === "halas"
          ? { color: p.kolor, weight: gruba + 6, opacity: 0.55, dashArray: null }
          : { color: p.kolor, weight: gruba, opacity: 0.9, dashArray: o.nowa ? "8 6" : null }
      );
    });
  }, [stan, tryb, lista]);

  return null;
}

// Inwestycje i propozycje rysujemy w SVG: canvas w najwyższym panelu przykrywałby całą mapę
// i przechwytywał kliknięcia/najechania na parkingi i przystanki pod spodem.
// Renderer panelu ustawiamy dla każdej instancji mapy, zanim trafią na nią warstwy
// (efekt – po <Pane>, który przy ponownym montowaniu czyści renderery panelu)
function PanelSvg({ name }) {
  const map = useMap();
  useEffect(() => {
    const r = L.svg({ pane: name });
    map._paneRenderers[name] = r;
    return () => {
      if (map._paneRenderers[name] === r) delete map._paneRenderers[name];
      r.remove();
    };
  }, [map, name]);
  return null;
}

// Szpital: biały kwadrat z czerwonym krzyżem (łatwy do odróżnienia od przystanków)
const IKONA_SZPITALA = L.divIcon({ className: "ikona-szpitala", html: ikonaHtml("local_hospital"), iconSize: [20, 20], iconAnchor: [10, 10] });

// Przystanek nowej linii: kwadrat z numerem (czarna obwódka = istniejący przystanek)
// ikony z pamięci podręcznej – bez nowych obiektów przy każdym renderze (Leaflet nie podmienia wtedy DOM)
const ikonyPrzystankow = new Map();
const pinPrzystanku = (nr, kolor, istn) => {
  const k = `${nr}|${kolor}|${istn ? 1 : 0}`;
  let ik = ikonyPrzystankow.get(k);
  if (!ik) ikonyPrzystankow.set(k, (ik = nowyPin(nr, kolor, istn)));
  return ik;
};
const nowyPin = (nr, kolor, istn) =>
  L.divIcon({
    className: `pin-przystanek${istn ? " istn" : ""}`,
    html: `<span style="background:${kolor};display:grid;place-items:center;width:100%;height:100%">${nr}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

// Klucz zmiany geometrii (liczony raz na obiekt geometrii – nie serializujemy całych tras przy każdym renderze)
const kluczeGeo = new WeakMap();
function kluczGeometrii(g) {
  let k = kluczeGeo.get(g);
  if (k === undefined) {
    k = JSON.stringify(g);
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    k = `${k.length}:${h}`;
    kluczeGeo.set(g, k);
  }
  return k;
}

// Kliknięcia w mapę (ręczne dodawanie przystanków)
function KlikMapy({ onKlik }) {
  useMapEvents({ click: (e) => onKlik?.([e.latlng.lng, e.latlng.lat]) });
  return null;
}

// Edycja kształtu wielokąta (Geoman): przeciąganie, dodawanie i usuwanie narożników.
// onZmiana zwraca false, gdy nowy kształt jest niedozwolony – wtedy cofamy zmianę.
function EdycjaKsztaltu({ inv, onZmiana }) {
  const map = useMap();
  const cb = useRef(onZmiana);
  cb.current = onZmiana;
  const id = inv?.id;
  useEffect(() => {
    if (!inv) return;
    const kolor = TYPY[inv.typ].kolor;
    let warstwa = null;
    let aktywne = true;
    const opcje = { allowSelfIntersection: false, snappable: false };
    let poprzedni;
    const zapisz = () => {
      const geo = warstwa.toGeoJSON();
      if (cb.current(geo) === false) {
        warstwa.setLatLngs(poprzedni);
        warstwa.pm.disable();
        warstwa.pm.enable(opcje);
      } else poprzedni = warstwa.getLatLngs();
    };
    // warstwę tworzymy dopiero po załadowaniu Geomana (wtedy dostaje warstwa.pm)
    zaladujGeoman(map).then(() => {
      if (!aktywne) return;
      warstwa = L.geoJSON(inv.geometry, { pane: "inwestycje", style: { color: kolor, weight: 3, fillColor: kolor, fillOpacity: 0.25, dashArray: "6 4" } }).getLayers()[0];
      if (!warstwa) return;
      warstwa.addTo(map);
      warstwa.pm.enable(opcje);
      poprzedni = warstwa.getLatLngs();
      warstwa.on("pm:edit", zapisz);
    });
    return () => {
      aktywne = false;
      if (!warstwa) return;
      warstwa.off("pm:edit", zapisz);
      warstwa.pm.disable();
      warstwa.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);
  return null;
}

// Mapa sama dopasowuje się, gdy zwijamy boczne panele
function DopasujRozmiar() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

const KOLOR_STREFY = { przemyslowa: "#5c5f66", biurowa: "#1971c2", handlowa: "#ae3ec9" };
const NAZWA_STREFY = { przemyslowa: "Strefa przemysłowa", biurowa: "Biura", handlowa: "Handel i usługi" };

// Parkingi z OSM (ok. 3,5 tys.): jedna warstwa Leaflet na canvasie zamiast tysięcy komponentów React;
// popup budowany dopiero po kliknięciu.
const escapeHtml = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ParkingsLayer = memo(function ParkingsLayer({ parkings, onAdd }) {
  // rodzic to LayerGroup z LayersControl – dodajemy do niej, żeby warstwę dało się wyłączyć
  const ctx = useLeafletContext();
  const cb = useRef(onAdd);
  cb.current = onAdd;
  useEffect(() => {
    if (!parkings) return;
    // bez własnego renderera: Leaflet użyje wspólnego canvasu panelu (drugi canvas zasłaniałby kliknięcia)
    const warstwa = L.geoJSON(parkings, {
      pane: "przystanki",
      pointToLayer: (f, ll) =>
        L.circleMarker(ll, {
          pane: "przystanki",
          radius: +f.properties.capacity >= 50 ? 6 : 4,
          color: "#fff",
          weight: 1,
          fillColor: "#0c8599",
          fillOpacity: 0.85,
        }),
      onEachFeature: (f, layer) => {
        const pr = f.properties;
        layer.bindTooltip(() => `Parking: ${escapeHtml(pr.name || "bez nazwy")}${pr.capacity ? ` · ${escapeHtml(pr.capacity)} miejsc` : ""}`);
        layer.bindPopup(() => {
          const el = L.DomUtil.create("div");
          el.innerHTML =
            `<b>${escapeHtml(pr.name || "Parking")}</b><br>` +
            (pr.capacity ? `${escapeHtml(pr.capacity)} miejsc` : "liczba miejsc nieznana (przyjęto 40)") +
            `<div class="popup-actions"><button class="mini" data-pr="1">${ikonaHtml("add")} Park &amp; Ride</button>` +
            `<button class="mini" data-pr="0">${ikonaHtml("add")} ładowarki i panele PV</button></div>`;
          el.querySelectorAll("button").forEach((b) =>
            L.DomEvent.on(b, "click", () => {
              cb.current?.(f, { parkRide: b.dataset.pr === "1" });
              layer.closePopup();
            })
          );
          return el;
        });
      },
    });
    const kontener = ctx.layerContainer || ctx.map;
    kontener.addLayer(warstwa);
    return () => kontener.removeLayer(warstwa);
  }, [parkings, ctx]);
  return null;
});

export default function MapView({
  data, investments, selectedId, onSelect, wynik, drawType, onCreated, onCancelDraw,
  propozycje = [], dodanePropozycje, onAddProposal, onAddFromParking,
  visibleLines, highlightedLines, linesById, onHoverLine, onHoverStop,
  warstwaRuchu, stanSieci, granica = true, stops, swobodnie, zabudowa,
  edytowanyId, onEdytuj, ustawianie, onKlikMapy, onUsunPrzystanek,
}) {
  const doLatLng = (g) => (g.geometry || g).coordinates.map(([lng, lat]) => [lat, lng]);

  return (
    <MapContainer
      center={MIASTO_CENTRUM}
      zoom={13}
      minZoom={11}
      maxZoom={19}
      maxBounds={MAX_BOUNDS}
      maxBoundsViscosity={1}
      preferCanvas
      className="map"
      doubleClickZoom={!drawType}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {granica && <CityMask boundary={data.boundary} />}
      {granica && data.boundary && (
        <GeoJSON
          key={"granica" + data.boundary.features[0]?.id}
          data={data.boundary}
          interactive={false}
          style={{ color: "#9c2a2a", weight: 3, fill: false, dashArray: "8 4" }}
        />
      )}

      {/* Poziomy (panes) – wyższy zIndex = wyżej na mapie i pierwszeństwo przy najechaniu myszką */}
      <Pane name="strefy" style={{ zIndex: 401 }} />
      <Pane name="parki" style={{ zIndex: 402 }} />
      <Pane name="drogi" style={{ zIndex: 404 }} />
      <Pane name="ruch" style={{ zIndex: 405 }} />
      <Pane name="linie" style={{ zIndex: 406 }} />
      <Pane name="skutki" style={{ zIndex: 408 }} />
      <Pane name="przystanki" style={{ zIndex: 410 }} />
      <Pane name="inwestycje" style={{ zIndex: 415 }} />
      <PanelSvg name="inwestycje" />

      <RuchLayer stan={stanSieci} tryb={warstwaRuchu} />
      <DopasujRozmiar />

      <LayersControl position="topright">
        <LayersControl.Overlay checked name="Proponowane nowe drogi i P&R">
          <LayerGroup>
            {propozycje
              .filter((p) => !dodanePropozycje?.has(p.id) && (swobodnie || !(zabudowa?.[p.id] > 0)))
              .map((p) => {
                const tresc = (
                  <Popup>
                    <b>{p.nazwa}</b>
                    <br />
                    {p.dlugosc ? `${Math.round(p.dlugosc)} m${p.most ? " · wymaga mostu" : ""}` : null}
                    {p.dlugosc ? <br /> : null}
                    {p.powod}
                    <br />
                    <button className="mini" onClick={() => onAddProposal?.(p)}>
                      <Ikona n="add" /> Dodaj do wariantu
                    </button>
                  </Popup>
                );
                return p.rodzaj === "parkride" ? (
                  <CircleMarker
                    key={p.id}
                    pane="inwestycje"
                              center={[p.geometry.geometry.coordinates[1], p.geometry.geometry.coordinates[0]]}
                    radius={11}
                    pathOptions={{ color: "#0c8599", weight: 3, dashArray: "3 4", fillColor: "#fff", fillOpacity: 0.8 }}
                  >
                    <Tooltip>{`P&R? ${p.nazwa}`}</Tooltip>
                    {tresc}
                  </CircleMarker>
                ) : (
                  <Polyline
                    key={p.id}
                    pane="inwestycje"
                              positions={doLatLng(p.geometry)}
                    pathOptions={{ color: "#6741d9", weight: 5, opacity: 0.85, dashArray: "4 8" }}
                  >
                    <Tooltip sticky>{p.nazwa}</Tooltip>
                    {tresc}
                  </Polyline>
                );
              })}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Strefy przemysłowe i biurowe">
          <LayerGroup>
            {data.zones && (
              <GeoJSON
                key={"zones" + data.zones.features.length}
                data={data.zones}
                pane="strefy"
                style={(f) => ({
                  color: KOLOR_STREFY[f.properties.rodzaj],
                  weight: 1,
                  fillColor: KOLOR_STREFY[f.properties.rodzaj],
                  fillOpacity: 0.18,
                })}
                onEachFeature={(f, layer) =>
                  layer.bindTooltip(`${NAZWA_STREFY[f.properties.rodzaj]}${f.properties.name ? ": " + f.properties.name : ""}`, { sticky: true })
                }
              />
            )}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Parki i zieleń">
          <LayerGroup>
            <ParksLayer parks={data.parks} />
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Drogi główne (klasy)">
          <LayerGroup>
            {data.roads && (
              <GeoJSON
                key={"roads" + data.roads.features.length}
                data={data.roads}
                pane="drogi"
                interactive={false}
                style={{ color: "#e8590c", weight: 3, opacity: 0.6 }}
              />
            )}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Linie tramwajowe i autobusowe">
          <LayerGroup>
            <LinesLayer lines={data.lines} visible={visibleLines} highlighted={highlightedLines} onHover={onHoverLine} />
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Przystanki istniejące">
          <LayerGroup>
            <StopsLayer stops={stops} linesById={linesById} onHover={onHoverStop} />
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Parkingi (kliknij: P&R, ładowarki, PV)">
          <LayerGroup>
            <ParkingsLayer parkings={data.parkings} onAdd={onAddFromParking} />
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Ładowarki EV">
          <LayerGroup>
            {data.chargers?.features.map((f) => (
              <CircleMarker
                key={f.properties.id}
                pane="przystanki"
                center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
                radius={5}
                pathOptions={{ color: "#fff", weight: 1.5, fillColor: "#2b8a3e", fillOpacity: 1 }}
              >
                <Tooltip>{`Ładowarka EV: ${f.properties.name || f.properties.operator || "bez nazwy"}`}</Tooltip>
              </CircleMarker>
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Szpitale">
          <LayerGroup>
            {data.hospitals?.features.map((f) => (
              <Marker
                key={f.properties.id}
                pane="inwestycje"
                position={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
                icon={IKONA_SZPITALA}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  <b>{f.properties.name || "Szpital"}</b>
                  {f.properties.emergency === "yes" && <div>SOR / izba przyjęć</div>}
                </Tooltip>
              </Marker>
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Szkoły">
          <LayerGroup>
            {data.schools?.features.map((f) => (
              <CircleMarker
                key={f.properties.id}
                pane="przystanki"
                center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
                radius={5}
                pathOptions={{ color: "#e67700", weight: 1, fillOpacity: 0.7 }}
              >
                <Tooltip>{f.properties.name || "Szkoła"}</Tooltip>
              </CircleMarker>
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
      </LayersControl>

      {/* Mapa skutków dla zaznaczonej inwestycji */}
      {wynik?.wplyw?.strefy.map(
        (s, i) =>
          s.geo && (
            <GeoJSON
              key={`strefa-${selectedId}-${i}-${JSON.stringify(s.geo.geometry.coordinates[0]?.[0])}`}
              data={s.geo}
              pane="skutki"
              interactive={false}
              style={{ color: s.kolor, weight: 2, dashArray: "6 6", fillOpacity: 0.06 }}
            />
          )
      )}
      {wynik?.wplyw?.punkty.map(({ p, kolor }) => (
        <CircleMarker
          key={"hl" + p.properties.id}
          pane="inwestycje"
          center={[p.geometry.coordinates[1], p.geometry.coordinates[0]]}
          radius={7}
          pathOptions={{ color: "#fff", weight: 2, fillColor: kolor, fillOpacity: 1 }}
        >
          <Tooltip>{p.properties.name || "obiekt w zasięgu"}</Tooltip>
        </CircleMarker>
      ))}

      {/* Inwestycje aktywnego wariantu */}
      {investments.filter((inv) => inv.id !== edytowanyId).map((inv) => {
        const t = TYPY[inv.typ];
        const sel = inv.id === selectedId;
        const linia = t.rysuj === "Line";
        return (
          <GeoJSON
            key={inv.id + (sel ? "-sel" : "") + kluczGeometrii(inv.geometry)}
            data={inv.geometry}
            pane="inwestycje"
              style={{
              color: t.kolor,
              weight: linia ? (sel ? 8 : 6) : sel ? 4 : 2,
              fillColor: t.kolor,
              fillOpacity: sel ? 0.45 : 0.3,
              dashArray: inv.typ === "zamkniecie" ? "10 6" : inv.typ === "autobus" ? "2 8" : null,
              lineCap: "round",
            }}
            eventHandlers={{ click: () => onSelect(inv.id) }}
          >
            <Tooltip sticky>
              <span className="tt-ikona">
                <Ikona n={t.ikona} /> {inv.nazwa}
              </span>
            </Tooltip>
          </GeoJSON>
        );
      })}

      {/* Przystanki nowych linii i dróg */}
      {investments.flatMap((inv) =>
        (inv.params?.przystanki || []).map((s, i) => (
          <Marker
            key={`${inv.id}-st${i}-${s.coords.join(",")}`}
            pane="inwestycje"
            position={[s.coords[1], s.coords[0]]}
            icon={pinPrzystanku(i + 1, TYPY[inv.typ].kolor, s.istniejacy)}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                if (ustawianie === inv.id) onUsunPrzystanek?.(inv.id, i);
                else onSelect(inv.id);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <b>{i + 1}. {s.nazwa}</b>
              <div>{s.istniejacy ? "istniejący przystanek (przesiadka)" : inv.typ === "droga" ? "proponowany przystanek" : "nowy przystanek"}</div>
              {s.uwaga && <div>Uwaga: {s.uwaga}</div>}
              {ustawianie === inv.id && <div>Kliknij, aby usunąć</div>}
            </Tooltip>
          </Marker>
        ))
      )}

      {ustawianie && <KlikMapy onKlik={onKlikMapy} />}
      <EdycjaKsztaltu inv={investments.find((i) => i.id === edytowanyId)} onZmiana={(g) => onEdytuj?.(edytowanyId, g)} />

      <DrawControl
        mode={drawType ? TYPY[drawType].rysuj : null}
        color={drawType ? TYPY[drawType].kolor : null}
        onCreated={onCreated}
        onCancel={onCancelDraw}
      />
      <ScaleControl imperial={false} />
    </MapContainer>
  );
}
