// Leaflet rysuje każdy panel (pane) na osobnym canvasie na całą mapę, więc górny canvas
// przechwytuje mysz nawet tam, gdzie nic nie ma – warstwy niżej (ruch, parki, strefy, linie)
// nie dostają kliknięć ani tooltipów. Łatka: zdarzenie obsługuje najwyższy canvas, który
// ma pod kursorem obiekt; gdy żaden – górny (mapa dostaje zdarzenie dokładnie raz).
import L from "leaflet";

const P = L.Canvas.prototype;
const initContainer = P._initContainer;
const destroyContainer = P._destroyContainer;

P._initContainer = function () {
  initContainer.call(this);
  this._container._lRenderer = this;
  // wyjście kursora z mapy (albo wejście na element SVG/znacznik) – czyścimy hover we wszystkich canvasach
  L.DomEvent.on(this._container, "mouseout", (e) => {
    for (const r of rendereryMapy(this)) if (r !== this) r._handleMouseOut(e);
  });
};
P._destroyContainer = function () {
  if (this._container) delete this._container._lRenderer;
  destroyContainer.call(this);
};

function rendereryMapy(r) {
  const map = r._map;
  if (!map) return [];
  return [...map.getContainer().querySelectorAll(".leaflet-pane > canvas")].map((c) => c._lRenderer).filter((x) => x && x._map === map);
}

// canvasy (renderery) pod kursorem, od najwyższego
function stos(r, e) {
  const out = [];
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const x = el._lRenderer;
    if (x && x._map === r._map) out.push(x);
  }
  return out.length ? out : [r];
}

function trafienie(r, point, e) {
  let hit = null;
  for (let o = r._drawFirst; o; o = o.next) {
    const l = o.layer;
    if (l.options.interactive && l._containsPoint(point)) {
      if (!(e.type === "click" || e.type === "preclick") || !r._map._draggableMoved(l)) hit = l;
    }
  }
  return hit;
}

P._onClick = function (e) {
  const point = this._map.mouseEventToLayerPoint(e);
  for (const r of stos(this, e)) {
    const l = trafienie(r, point, e);
    if (l) return r._fireEvent([l], e);
  }
  this._fireEvent(false, e);
};

P._onMouseMove = function (e) {
  if (!this._map || this._map.dragging.moving() || this._map._animatingZoom) return;
  const point = this._map.mouseEventToLayerPoint(e);
  const lista = stos(this, e);
  let obslugujacy = this;
  for (const r of lista) {
    if (trafienie(r, point, { type: "mousemove" })) {
      obslugujacy = r;
      break;
    }
  }
  for (const r of rendereryMapy(this)) if (r !== obslugujacy) r._handleMouseOut(e);
  obslugujacy._handleMouseHover(e, point);
  // kursor „rączka” pokazuje górny canvas
  L.DomUtil[obslugujacy._hoveredLayer ? "addClass" : "removeClass"](this._container, "leaflet-interactive");
};
