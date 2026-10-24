// Lewy panel: wybór wariantu, lista inwestycji, parametry (z edycją kształtu i przystankami),
// propozycje, strefy pracy i linie komunikacji.
import { TYPY, KLASY_ULIC } from "../model/config.js";
import LinesPanel from "./LinesPanel.jsx";
import Modul, { ZwinWszystko } from "./Modul.jsx";
import Ikona from "./Ikona.jsx";
import { nazwaRodzaju } from "../model/zones.js";

function Suwak({ label, value, min, max, step = 1, jedn = "", onChange }) {
  return (
    <label>
      {label}: <b>{value}{jedn}</b>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function KlasaUlicy({ value, onChange, label = "Klasa ulicy" }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(KLASY_ULIC).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label} (~{v.natezenie.toLocaleString("pl-PL")} poj./dobę)
          </option>
        ))}
      </select>
    </label>
  );
}

// Przebieg trasy: po sieci ulic albo swobodny (nadpisana zasada).
// Tramwaj i nowa droga mają własny przebieg – nie przyklejają się do ulic.
function Przebieg({ inv, onRouteOnRoads }) {
  if (!TYPY[inv.typ]?.poUlicach)
    return (
      <>
        <p className="note">
          {inv.typ === "tramwaj" ? "Nowe torowisko" : "Nowa droga"} biegnie dokładnie tak, jak narysowano (niezależnie od istniejących ulic).
        </p>
        <div className="row-btns">
          <button className="btn sm" onClick={() => onRouteOnRoads(inv.id)}>
            <Ikona n="route" /> Poprowadź po istniejących ulicach
          </button>
        </div>
      </>
    );
  return inv.params.swobodnie ? (
    <>
      <p className="note err">Przebieg swobodny – trasa może przecinać zabudowę (zasada nadpisana).</p>
      <div className="row-btns">
        <button className="btn sm" onClick={() => onRouteOnRoads(inv.id)}>
          <Ikona n="route" /> Poprowadź po istniejących ulicach
        </button>
      </div>
    </>
  ) : (
    <p className="note">Trasa poprowadzona po istniejących ulicach (OSM).</p>
  );
}

function Przystanki({ inv, ustawianie, onAutoStops, onPlaceStops, onRemoveStop, onTryb, linia = true }) {
  const lista = inv.params.przystanki || [];
  const tryb = inv.params.przystankiTryb || "auto";
  return (
    <>
      <h3>Przystanki ({lista.length})</h3>
      {linia && (
        <div className="row-btns">
          <label className="check">
            <input type="radio" name={`tryb-${inv.id}`} checked={tryb === "auto"} onChange={() => onTryb(inv.id, "auto")} />
            automatycznie
          </label>
          <label className="check">
            <input type="radio" name={`tryb-${inv.id}`} checked={tryb === "reczne"} onChange={() => onTryb(inv.id, "reczne")} />
            ręcznie
          </label>
        </div>
      )}
      {lista.length > 0 && (
        <ol className="stops-list">
          {lista.map((s, i) => (
            <li key={i}>
              <span className="nr">{i + 1}.</span>
              <span className="grow">{s.nazwa}</span>
              {s.istniejacy && <span className="tag">istniejący</span>}
              {s.uwaga && <span className="tag warn">{s.uwaga}</span>}
              {tryb === "reczne" && (
                <button className="icon" title="Usuń przystanek" onClick={() => onRemoveStop(inv.id, i)}>
                  <Ikona n="close" className="s16" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="row-btns">
        {(tryb === "auto" || !linia) && (
          <button className="btn sm" onClick={() => onAutoStops(inv.id)}>
            <Ikona n="auto_fix_high" /> {lista.length ? "Wyznacz ponownie" : "Wyznacz przystanki"}
          </button>
        )}
        {tryb === "reczne" && linia && (
          <button className={ustawianie === inv.id ? "btn sm primary" : "btn sm"} onClick={() => onPlaceStops(ustawianie === inv.id ? null : inv.id)}>
            <Ikona n="add_location" /> {ustawianie === inv.id ? "Zakończ dodawanie" : "Dodaj na mapie"}
          </button>
        )}
      </div>
      <p className="note">
        Automatycznie: co ok. 350–700 m, nie na skrzyżowaniach, tylko przy zabudowie lub celach podróży; istniejące przystanki w
        pobliżu trasy są wykorzystywane.
      </p>
    </>
  );
}

export default function Sidebar({
  variants, activeId, onActivate, onRenameVariant, onCopyVariant,
  selectedId, onSelect, onUpdate, onDelete,
  edytowanyId, onEdit, ustawianie, onPlaceStops, onAutoStops, onRemoveStop, onRouteOnRoads, onBusFromRoad,
  propozycje, dodanePropozycje, onAddProposal, drogiWczytane, zabudowa,
  lines, visibleLines, setVisibleLines, onHoverLine, strefy = [], onZoneLine,
}) {
  const variant = variants[activeId];
  const selected = variant.investments.find((i) => i.id === selectedId);
  const linia = selected && (selected.typ === "tramwaj" || selected.typ === "autobus");
  const wielokat = selected && TYPY[selected.typ].rysuj === "Polygon";

  return (
    <aside className="sidebar">
      <div className="panel-tools">
        <ZwinWszystko />
      </div>
      <Modul id="warianty" tytul="Warianty">
        <div className="tabs" role="tablist">
          {Object.entries(variants).map(([id, v]) => (
            <button key={id} role="tab" aria-selected={id === activeId} className={id === activeId ? "tab active" : "tab"} onClick={() => onActivate(id)}>
              {id}
              <span className="count">{v.investments.length}</span>
            </button>
          ))}
        </div>
        <input className="name-input" value={variant.nazwa} onChange={(e) => onRenameVariant(activeId, e.target.value)} aria-label="Nazwa wariantu" />
        <div className="copy-row">
          Skopiuj do:
          {Object.keys(variants)
            .filter((id) => id !== activeId)
            .map((id) => (
              <button key={id} className="link" onClick={() => onCopyVariant(activeId, id)}>
                {id}
              </button>
            ))}
        </div>
      </Modul>

      <Modul id="lista" tytul={`Inwestycje w wariancie ${activeId}`}>
        {variant.investments.length === 0 && <p className="muted">Brak. Wybierz typ inwestycji w menu nad mapą i narysuj ją.</p>}
        <ul className="inv-list">
          {variant.investments.map((inv) => (
            <li
              key={inv.id}
              className={inv.id === selectedId ? "sel" : ""}
              style={{ "--c": TYPY[inv.typ].kolor }}
              onClick={() => onSelect(inv.id)}
            >
              <Ikona n={TYPY[inv.typ].ikona} />
              <span className="grow">{inv.nazwa}</span>
              <button
                className="icon"
                title="Usuń"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(inv.id);
                }}
              >
                <Ikona n="delete" className="s16" />
              </button>
            </li>
          ))}
        </ul>
      </Modul>

      {selected && (
        <Modul id="parametry" tytul="Parametry" className="params">
          <label>
            Nazwa
            <input value={selected.nazwa} onChange={(e) => onUpdate(selected.id, { nazwa: e.target.value })} />
          </label>

          {wielokat && (
            <div className="row-btns">
              <button className={edytowanyId === selected.id ? "btn sm primary" : "btn sm"} onClick={() => onEdit(edytowanyId === selected.id ? null : selected.id)}>
                <Ikona n={edytowanyId === selected.id ? "check" : "edit"} />
                {edytowanyId === selected.id ? "Zakończ edycję kształtu" : "Edytuj kształt na mapie"}
              </button>
            </div>
          )}
          {edytowanyId === selected.id && (
            <p className="note">Przeciągaj narożniki na mapie. Kliknięcie narożnika usuwa go, środek krawędzi dodaje nowy.</p>
          )}

          {selected.typ === "osiedle" && (
            <>
              <Suwak label="Liczba mieszkań" value={selected.params.mieszkania} min={20} max={3000} step={20}
                onChange={(mieszkania) => onUpdate(selected.id, { params: { mieszkania } })} />
              <Suwak label="Zieleń na terenie osiedla" value={selected.params.zielenProc} min={0} max={60} step={5} jedn="%"
                onChange={(zielenProc) => onUpdate(selected.id, { params: { zielenProc } })} />
              <p className="note">Na osiedlu można dodawać drogi i parki; nowe osiedle nie może na nie nachodzić.</p>
            </>
          )}

          {selected.typ === "zamkniecie" && (
            <>
              <KlasaUlicy value={selected.params.klasa} onChange={(klasa) => onUpdate(selected.id, { params: { klasa } })} />
              <Przebieg inv={selected} onRouteOnRoads={onRouteOnRoads} />
            </>
          )}

          {selected.typ === "droga" && (
            <>
              <KlasaUlicy label="Klasa drogi" value={selected.params.klasa} onChange={(klasa) => onUpdate(selected.id, { params: { klasa } })} />
              <label className="check">
                <input type="checkbox" checked={!!selected.params.most} onChange={(e) => onUpdate(selected.id, { params: { most: e.target.checked } })} />
                Z mostem (przez rzekę lub kanał)
              </label>
              <label className="check">
                <input type="checkbox" checked={!!selected.params.wiadukt} onChange={(e) => onUpdate(selected.id, { params: { wiadukt: e.target.checked } })} />
                Z wiaduktem nad torami
              </label>
              <Przebieg inv={selected} onRouteOnRoads={onRouteOnRoads} />
              <Przystanki inv={selected} linia={false} onAutoStops={onAutoStops} />
              {selected.params.przystanki?.length > 0 && (
                <div className="row-btns">
                  <button className="btn sm" onClick={() => onBusFromRoad(selected.id)}>
                    <Ikona n="directions_bus" /> Utwórz linię autobusową na tej drodze
                  </button>
                </div>
              )}
            </>
          )}

          {selected.typ === "parking" && (
            <>
              <label className="check">
                <input type="checkbox" checked={!!selected.params.parkRide} onChange={(e) => onUpdate(selected.id, { params: { parkRide: e.target.checked } })} />
                Park &amp; Ride (przesiadka na komunikację)
              </label>
              {selected.params.istniejacy && (
                <Suwak label="Miejsca (istniejący parking)" value={selected.params.miejsca || 40} min={10} max={1000} step={10}
                  onChange={(miejsca) => onUpdate(selected.id, { params: { miejsca } })} />
              )}
              <Suwak label="Ładowarki EV" value={selected.params.ladowarki} min={0} max={40}
                onChange={(ladowarki) => onUpdate(selected.id, { params: { ladowarki } })} />
              <Suwak label="Wiata z panelami PV nad parkingiem" value={selected.params.pvProc} min={0} max={100} step={10} jedn="%"
                onChange={(pvProc) => onUpdate(selected.id, { params: { pvProc } })} />
            </>
          )}

          {linia && (
            <>
              <Suwak label="Kursy co" value={selected.params.czestotliwosc} min={3} max={30} jedn=" min"
                onChange={(czestotliwosc) => onUpdate(selected.id, { params: { czestotliwosc } })} />
              {selected.typ === "autobus" && (
                <label className="check">
                  <input type="checkbox" checked={!!selected.params.elektryczny} onChange={(e) => onUpdate(selected.id, { params: { elektryczny: e.target.checked } })} />
                  Autobusy elektryczne
                </label>
              )}
              <Przebieg inv={selected} onRouteOnRoads={onRouteOnRoads} />
              <Przystanki
                inv={selected}
                ustawianie={ustawianie}
                onAutoStops={onAutoStops}
                onPlaceStops={onPlaceStops}
                onRemoveStop={onRemoveStop}
                onTryb={(id, przystankiTryb) => onUpdate(id, { params: { przystankiTryb } })}
              />
            </>
          )}

          {selected.typ === "park" && <p className="muted">Park liczony jest z narysowanej powierzchni.</p>}
        </Modul>
      )}

      <Modul id="propozycje" tytul={`Propozycje: drogi, linie i Park & Ride (${propozycje.length})`}>
        <p className="muted small">
          Wyznaczane automatycznie z danych OSM: łączniki tam, gdzie dziś trzeba jechać dużym objazdem (także ulicami lokalnymi) i
          tylko w zabudowie; linie autobusowe do osiedli bez przystanku w 450 m (albo przedłużenia istniejących linii); dojazdy do
          nowych osiedli i parkingi przy wjazdach do miasta (kandydaci na P&amp;R). Nowe drogi są sprawdzane pod kątem kolizji z budynkami (OSM).
        </p>
        {!drogiWczytane && <p className="muted">Czekam na dane o drogach…</p>}
        {drogiWczytane && propozycje.length === 0 && <p className="muted">Brak propozycji.</p>}
        {zabudowa.status === "ladowanie" && <p className="muted small">Sprawdzanie zabudowy wzdłuż propozycji…</p>}
        {zabudowa.status === "blad" && <p className="muted small">Nie udało się sprawdzić zabudowy (Overpass niedostępny).</p>}
        <ul className="proposals">
          {propozycje.map((p) => {
            const dodana = dodanePropozycje.has(p.id);
            const budynki = zabudowa.wynik?.[p.id];
            const blok = budynki > 0;
            return (
              <li key={p.id} className={`${p.rodzaj} ${blok ? "blocked" : ""}`}>
                <div className="grow">
                  <b>{p.nazwa}</b>
                  <span className="muted small">
                    {p.dlugosc ? `${Math.round(p.dlugosc)} m${p.most ? " · most" : ""}${p.wiadukt ? " · wiadukt" : ""} · ` : ""}
                    {p.powod}
                  </span>
                  {blok && (
                    <span className="problem">
                      <Ikona n="domain_disabled" className="s14" /> przecina {budynki} bud. – wymaga nadpisania zasady
                    </span>
                  )}
                  {budynki === 0 && (
                    <span className="verified">
                      <Ikona n="check" className="s14" /> bez kolizji z budynkami
                    </span>
                  )}
                </div>
                <button className="mini" disabled={dodana} onClick={() => onAddProposal(p)}>
                  <Ikona n={dodana ? "check" : "add"} /> {dodana ? "dodana" : activeId}
                </button>
              </li>
            );
          })}
        </ul>
      </Modul>

      <Modul id="strefy" tytul={`Strefy pracy (${strefy.length})`}>
        <p className="muted small">Największe obszary przemysłowe, biurowe i handlowe (OSM) – dostęp do komunikacji i obciążenie dróg w szczycie.</p>
        <ul className="zones">
          {strefy.map((s) => (
            <li key={s.id} className={s.problemy.length ? "warn" : ""}>
              <div className="grow">
                <b>{s.nazwa}</b>
                <span className="muted small">
                  {nazwaRodzaju(s.rodzaj)} · {Math.round(s.ha)} ha · {s.linie} linii w 500 m
                  {s.vc != null ? ` · drogi w szczycie ${Math.round(s.vc * 100)}%` : ""}
                </span>
                {s.problemy.length > 0 && (
                  <span className="problem">
                    <Ikona n="warning" className="s14" /> {s.problemy.join(", ")}
                  </span>
                )}
              </div>
              {s.wezel && (
                <button className="mini" onClick={() => onZoneLine(s)} title="Dodaj linię autobusową do najbliższego węzła przesiadkowego">
                  <Ikona n="directions_bus" /> dowóz
                </button>
              )}
            </li>
          ))}
        </ul>
      </Modul>

      <Modul id="komunikacja" tytul="Komunikacja miejska">
        <LinesPanel lines={lines} visible={visibleLines} setVisible={setVisibleLines} onHover={onHoverLine} />
      </Modul>
    </aside>
  );
}
