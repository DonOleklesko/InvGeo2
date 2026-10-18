// Prawy panel: skutki zaznaczonej inwestycji, dane oficjalne, założenia i źródła.
import { useState } from "react";
import { TYPY, ZALOZENIA, ZRODLA, ZRODLA_ZALOZEN, ZRODLA_MODELU, z } from "../model/config.js";
import { fmtZl } from "../model/simulate.js";
import Modul, { ZwinWszystko } from "./Modul.jsx";
import Ikona from "./Ikona.jsx";
import OfficialPanel from "./OfficialPanel.jsx";

// Linki do źródeł; „szacunek” oznacza wartość przyjętą przez autorów (do weryfikacji)
function Zrodla({ wpis, pelne = false }) {
  if (!wpis) return null;
  return (
    <span className="zrodla">
      {wpis.szacunek && <span className="badge-szacunek" title="Wartość przyjęta przez autorów prototypu – do weryfikacji">szacunek</span>}
      {wpis.z.map((id) => (
        <a key={id} href={ZRODLA[id].url} target="_blank" rel="noopener noreferrer" title={ZRODLA[id].nazwa}>
          {pelne ? ZRODLA[id].nazwa : ZRODLA[id].nazwa.split(" – ")[0]} <Ikona n="open_in_new" />
        </a>
      ))}
    </span>
  );
}

const ZNAK = { plus: "add_circle", minus: "do_not_disturb_on", uwaga: "error" };

function Kompromisy({ lista }) {
  return (
    <ul className="tradeoffs">
      {lista.map((k, i) => (
        <li key={i} className={k.typ}>
          <Ikona n={ZNAK[k.typ]} />
          <span>{k.tekst}</span>
        </li>
      ))}
    </ul>
  );
}

function Finanse({ f }) {
  if (!f) return null;
  return (
    <Modul id="finanse" sub tytul="Analiza inwestycji">
      <dl className="kv">
        <div><dt>Nakłady (CAPEX)</dt><dd>{fmtZl(f.capex)}</dd></div>
        <div><dt>Koszty roczne netto</dt><dd>{fmtZl(f.opexRok)}/rok</dd></div>
        <div><dt>Korzyści roczne</dt><dd>{fmtZl(f.korzysciRok)}/rok</dd></div>
        <div className={f.npv >= 0 ? "total good" : "total bad"}>
          <dt>NPV ({z("horyzontAnalizy")} lat, {Math.round(z("stopaDyskonta") * 100)}%)</dt>
          <dd>{fmtZl(f.npv)}</dd>
        </div>
        <div><dt>Zwrot nakładów</dt><dd>{f.zwrot == null ? "brak (korzyści < koszty)" : `${f.zwrot.toFixed(1)} lat`}</dd></div>
      </dl>
      <p className="muted small">
        Korzyści: czas w korkach ({z("wartoscCzasu")} zł/h), energia, opłaty za ładowanie, krótsze trasy. Szacunek do porównań, nie
        analiza kosztów i korzyści w rozumieniu wytycznych.
      </p>
    </Modul>
  );
}

const Tytul = ({ inv }) => (
  <span className="inv-title" style={{ "--c": TYPY[inv.typ].kolor }}>
    <Ikona n={TYPY[inv.typ].ikona} className="s16" /> {inv.nazwa}
  </span>
);

export default function ResultsPanel({
  selected, wynikSel, zalozenia, onZalozenia,
  auto, onAuto, onAktualizuj, nieaktualne, liczy,
  oficjalne, onOdswiezOficjalne, modelNarazeni,
}) {
  const [pokazZal, setPokazZal] = useState(false);
  const zmienione = Object.keys(zalozenia).length;

  return (
    <aside className={nieaktualne ? "results stale" : "results"}>
      <section className="recalc">
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
          Przeliczaj automatycznie
        </label>
        <button className={nieaktualne ? "update attention" : "update"} onClick={onAktualizuj} disabled={auto}>
          <Ikona n="refresh" className="s16" /> Aktualizuj
        </button>
        <span className="recalc-state">
          {liczy ? "Liczę…" : nieaktualne ? "Wyniki nieaktualne – kliknij Aktualizuj" : "Wyniki aktualne"}
          <ZwinWszystko />
        </span>
      </section>

      {!selected && (
        <Modul id="inwestycja-brak" tytul="Wybrana inwestycja">
          <p className="muted">Kliknij inwestycję na mapie lub na liście, aby zobaczyć jej skutki i analizę.</p>
        </Modul>
      )}
      {selected && !wynikSel && (
        <Modul id="inwestycja" tytul={<Tytul inv={selected} />}>
          <p className="muted">Kliknij „Aktualizuj”, aby policzyć skutki tej inwestycji.</p>
        </Modul>
      )}
      {selected && wynikSel && (
        <Modul id="inwestycja" tytul={<Tytul inv={selected} />}>
          <dl className="kv">
            {wynikSel.szczegoly.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div className="total">
              <dt>Koszt (szac.)</dt>
              <dd>{fmtZl(wynikSel.metryki.koszt)}</dd>
            </div>
          </dl>
          <Modul id="kompromisy" sub tytul="Kompromisy">
            <Kompromisy lista={wynikSel.kompromisy} />
          </Modul>
          <Finanse f={wynikSel.finanse} />
          <details>
            <summary>Skąd te liczby?</summary>
            <ul className="explain">
              {wynikSel.wyjasnienia.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
          <div className="legend">
            {wynikSel.wplyw.strefy.map((s) => (
              <span key={s.opis}>
                <i style={{ borderColor: s.kolor }} /> {s.opis}
              </span>
            ))}
          </div>
        </Modul>
      )}

      <OfficialPanel dane={oficjalne} onOdswiez={onOdswiezOficjalne} modelNarazeni={modelNarazeni} />

      <Modul id="zalozenia" tytul="Założenia modelu">
        <button className="link" onClick={() => setPokazZal(!pokazZal)}>
          {pokazZal ? "Ukryj" : "Pokaż i zmień"} założenia modelu
        </button>
        {zmienione > 0 && (
          <button className="link" onClick={() => onZalozenia({})}>
            przywróć domyślne ({zmienione})
          </button>
        )}
        {pokazZal && (
          <table className="assumptions">
            <tbody>
              {Object.entries(ZALOZENIA).map(([k, a]) => {
                const v = zalozenia[k] ?? a.v;
                return (
                  <tr key={k} className={k in zalozenia ? "changed" : ""}>
                    <td>
                      {a.opis}
                      <Zrodla wpis={ZRODLA_ZALOZEN[k]} />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step={a.v < 1 ? 0.01 : a.v < 100 ? 0.1 : 10}
                        value={v}
                        onChange={(e) => {
                          const n = e.target.value === "" ? null : +e.target.value;
                          const { [k]: _, ...reszta } = zalozenia;
                          onZalozenia(n == null || n === a.v || Number.isNaN(n) ? reszta : { ...reszta, [k]: n });
                        }}
                      />{" "}
                      {a.jedn}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">Wyniki są orientacyjne: uproszczone założenia i dane OpenStreetMap.</p>
      </Modul>

      <Modul id="zrodla" tytul="Źródła danych modelu">
        <ul className="lista-zrodel">
          {ZRODLA_MODELU.map((m) => (
            <li key={m.temat}>
              <b>{m.temat}</b>
              <Zrodla wpis={m} pelne />
            </li>
          ))}
        </ul>
        <details>
          <summary>Wszystkie źródła ({Object.keys(ZRODLA).length})</summary>
          <ul className="lista-zrodel">
            {Object.entries(ZRODLA).map(([id, zr]) => (
              <li key={id}>
                <a href={zr.url} target="_blank" rel="noopener noreferrer">
                  {zr.nazwa} <Ikona n="open_in_new" />
                </a>
              </li>
            ))}
          </ul>
        </details>
        <p className="muted small">„szacunek” = wartość przyjęta w prototypie; link wskazuje, gdzie ją sprawdzić lub doprecyzować.</p>
      </Modul>
    </aside>
  );
}
