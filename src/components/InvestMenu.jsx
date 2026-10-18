// Menu inwestycji nad mapą: typy do narysowania + opcje widoku mapy.
import { TYPY } from "../model/config.js";
import Ikona from "./Ikona.jsx";

const PODPOWIEDZ = {
  Line: {
    droga: "Klikaj kolejne punkty przebiegu drogi",
    zamkniecie: "Klikaj punkty wzdłuż zamykanej ulicy",
    tramwaj: "Klikaj punkty trasy linii – przystanki wyznaczą się automatycznie",
    autobus: "Klikaj punkty trasy linii – przystanki wyznaczą się automatycznie",
  },
};

export default function InvestMenu({
  drawType, onStartDraw, onCancelDraw, swobodnie, onSwobodnie,
  przystankiWidok, onPrzystankiWidok, granica, onGranica, ustawianie, onKoniecUstawiania,
}) {
  const linia = drawType && TYPY[drawType].rysuj === "Line";
  return (
    <>
      <nav className="inv-menu" aria-label="Dodaj inwestycję">
        <div className="tb-label">
          <Ikona n="add_location_alt" className="s16" /> Inwestycje
        </div>
        <div className="tb-items">
          {Object.entries(TYPY).map(([typ, t]) => (
            <button
              key={typ}
              className={drawType === typ ? "tb-item active" : "tb-item"}
              style={{ "--c": t.kolor }}
              onClick={() => (drawType === typ ? onCancelDraw() : onStartDraw(typ))}
              title={t.label}
              aria-pressed={drawType === typ}
            >
              <Ikona n={t.ikona} />
              <span>{t.krotko || t.label}</span>
            </button>
          ))}
        </div>
        <div className="tb-opts">
          <label className="check" title="Linie autobusowe i zamknięcia mogą biec poza istniejącą siecią ulic (tramwaj i nowa droga zawsze biegną swobodnie)">
            <input type="checkbox" checked={swobodnie} onChange={(e) => onSwobodnie(e.target.checked)} />
            Nadpisz zasadę: swobodny przebieg
          </label>
          <span className="tb-opt-label">
            Przystanki
            <span className="seg-mini">
              <button className={przystankiWidok === "wokol" ? "on" : ""} onClick={() => onPrzystankiWidok("wokol")}>
                przy inwestycjach
              </button>
              <button className={przystankiWidok === "wszystkie" ? "on" : ""} onClick={() => onPrzystankiWidok("wszystkie")}>
                wszystkie
              </button>
            </span>
          </span>
          <label className="check">
            <input type="checkbox" checked={granica} onChange={(e) => onGranica(e.target.checked)} />
            Granica miasta
          </label>
        </div>
      </nav>
      {drawType && (
        <div className="draw-hint" role="status">
          <Ikona n="draw" className="s16" />
          <span className="grow">
            {linia
              ? `${PODPOWIEDZ.Line[drawType]}, zakończ podwójnym kliknięciem. ${
                  !TYPY[drawType].poUlicach
                    ? "Przebieg dokładnie jak narysowany (nowe torowisko / nowa jezdnia, bez przyklejania do ulic)."
                    : swobodnie
                      ? "Tryb swobodny: przebieg dokładnie jak narysowany (może przecinać zabudowę)."
                      : "Trasa zostanie poprowadzona po istniejących ulicach."
                }`
              : drawType === "osiedle"
                ? "Klikaj narożniki osiedla, zakończ klikając pierwszy punkt. Osiedla nie mogą nachodzić na inne osiedla."
                : "Klikaj narożniki obszaru, zakończ klikając pierwszy punkt."}{" "}
            <kbd>Esc</kbd> anuluje.
          </span>
        </div>
      )}
      {ustawianie && (
        <div className="draw-hint" role="status">
          <Ikona n="add_location" className="s16" />
          <span className="grow">
            Klikaj na mapie, aby dodać przystanek na trasie linii „{ustawianie}”. Kliknięcie istniejącego punktu linii usuwa przystanek.
          </span>
          <button className="btn sm" onClick={onKoniecUstawiania}>
            Zakończ
          </button>
        </div>
      )}
    </>
  );
}
