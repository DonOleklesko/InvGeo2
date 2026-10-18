// Panel ruchu pod mapą: warstwa (natężenie / hałas), godzina, dzień, rok,
// współczynnik zakorkowania i wykresy: przebieg doby oraz lata 2015–2036.
import { useEffect, useState } from "react";
import Uchwyt from "./Uchwyt.jsx";
import Ikona from "./Ikona.jsx";

const WYS_KEY = "torun2036:wys-panelu-ruchu";
function wczytajWysokosc() {
  try {
    return +localStorage.getItem(WYS_KEY) || null;
  } catch {
    return null;
  }
}
import { LATA, ROK_BAZY } from "../model/traffic.js";
import { fmtInt } from "../model/simulate.js";
import { z } from "../model/config.js";

// Kolory wariantów: stałe sloty palety kategorialnej (A, B, C) + szary dla stanu bez inwestycji
export const KOLOR_WARIANTU = { A: "#2a78d6", B: "#eb6834", C: "#1baf7a" };
const KOLOR_BAZY = "#8a8984";

// Pasma obciążenia V/C – paleta statusów, zawsze z etykietą
export const PASMA_RUCHU = [
  { do: 0.6, kolor: "#0ca30c", label: "płynnie" },
  { do: 0.85, kolor: "#fab219", label: "gęsto" },
  { do: 1.0, kolor: "#ec835a", label: "korek" },
  { do: Infinity, kolor: "#d03b3b", label: "zator" },
];
// Pasma hałasu Lden przy drodze – jedna barwa, od jasnej do ciemnej
export const PASMA_HALASU = [
  { do: 60, kolor: "#d0bfff", label: "< 60 dB" },
  { do: 65, kolor: "#9775fa", label: "60–65 dB" },
  { do: 70, kolor: "#7048e8", label: "65–70 dB" },
  { do: Infinity, kolor: "#4c2a9e", label: "> 70 dB" },
];
export const pasmo = (pasma, v) => pasma.find((p) => v < p.do) || pasma[pasma.length - 1];

const proc = (x) => `${Math.round(x * 100)}%`;

function Wykres({ serie, xs, xLabel, zaznaczone, onKlik, formatX, tytul }) {
  const [hover, setHover] = useState(null);
  const W = 320;
  const H = 120;
  const L = 34;
  const R = 8;
  const T = 8;
  const B = 20;
  const wszystkie = serie.flatMap((s) => s.dane);
  const max = Math.max(0.05, ...wszystkie) * 1.1;
  const x = (i) => L + (i / (xs.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ticksY = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  const krokX = Math.ceil(xs.length / 6);
  const idx = hover ?? zaznaczone;

  return (
    <figure className="chart">
      <figcaption>{tytul}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={tytul}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (xs.length - 1));
          setHover(Math.max(0, Math.min(xs.length - 1, i)));
        }}
        onClick={() => hover != null && onKlik?.(xs[hover])}
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 4} y={y(v) + 3} className="tick" textAnchor="end">
              {proc(v)}
            </text>
          </g>
        ))}
        {xs.map((v, i) =>
          i % krokX === 0 || i === xs.length - 1 ? (
            <text key={v} x={x(i)} y={H - 6} className="tick" textAnchor="middle">
              {formatX(v)}
            </text>
          ) : null
        )}
        {zaznaczone != null && <line x1={x(zaznaczone)} x2={x(zaznaczone)} y1={T} y2={H - B} className="sel" />}
        {serie.map((s) => (
          <polyline
            key={s.id}
            points={s.dane.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={s.kolor}
            strokeWidth={s.aktywny ? 2.5 : 2}
            strokeDasharray={s.przerywana ? "4 4" : null}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {idx != null && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={T} y2={H - B} className="cross" />
            {serie.map((s) => (
              <circle key={s.id} cx={x(idx)} cy={y(s.dane[idx])} r={4} fill={s.kolor} strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>
            {xLabel} {formatX(xs[hover])}
          </b>
          {serie.map((s) => (
            <div key={s.id}>
              <i style={{ background: s.kolor }} /> {s.nazwa}: <b>{proc(s.dane[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

export default function TrafficPanel({
  warianty, activeId, warstwa, onWarstwa, godzina, onGodzina, weekend, onWeekend, rok, onRok, stanSieci,
}) {
  const [otwarty, setOtwarty] = useState(true);
  // wysokość panelu ustawiana przeciąganiem górnej krawędzi (null = domyślna)
  const [wysokosc, setWysokosc] = useState(wczytajWysokosc);
  const [startWys, setStartWys] = useState(null);
  const zapiszWys = (h) => {
    setWysokosc(h);
    try {
      localStorage.setItem(WYS_KEY, String(h));
    } catch {
      /* zapis niedostępny */
    }
  };
  const [gra, setGra] = useState(false);
  const [tabela, setTabela] = useState(false);

  // animacja doby: co 0,7 s następna godzina
  useEffect(() => {
    if (!gra) return;
    const t = setInterval(() => onGodzina((h) => (h + 1) % 24), 700);
    return () => clearInterval(t);
  }, [gra, onGodzina]);

  const aktywny = warianty.find((w) => w.id === activeId);
  const zRuchem = warianty.filter((w) => w.ruch);
  if (!aktywny?.ruch) {
    return <div className="traffic-panel muted">Model ruchu czeka na dane o drogach…</div>;
  }
  const zakTeraz = stanSieci?.zakorkowanie ?? 0;
  const zakSzczyt = aktywny.suma.zakorkowanie;
  const zakBaza = aktywny.suma.zakorkowanieBaza;
  const dHalas = aktywny.suma.narazeniHalas - aktywny.suma.narazeniHalasBaza;

  const serieDoby = [
    { id: "baza", nazwa: "Bez inwestycji", kolor: KOLOR_BAZY, przerywana: true, dane: aktywny.bazowa?.[weekend ? "weekend" : "godziny"] },
    ...zRuchem
      .filter((w) => w.liczbaInwestycji)
      .map((w) => ({ id: w.id, nazwa: `Wariant ${w.id}`, kolor: KOLOR_WARIANTU[w.id], aktywny: w.id === activeId, dane: w.ruch[weekend ? "weekend" : "godziny"] })),
  ].filter((s) => s.dane);
  const serieLat = [
    { id: "baza", nazwa: "Bez inwestycji", kolor: KOLOR_BAZY, przerywana: true, dane: aktywny.lata?.map((l) => l.baza) },
    ...zRuchem
      .filter((w) => w.liczbaInwestycji && w.lata)
      .map((w) => ({ id: w.id, nazwa: `Wariant ${w.id}`, kolor: KOLOR_WARIANTU[w.id], aktywny: w.id === activeId, dane: w.lata.map((l) => l.wariant) })),
  ].filter((s) => s.dane);

  const pasma = warstwa === "halas" ? PASMA_HALASU : PASMA_RUCHU;

  return (
    <div
      className={otwarty ? "traffic-panel" : "traffic-panel closed"}
      style={otwarty && wysokosc ? { height: wysokosc, maxHeight: "none" } : null}
    >
      {otwarty && (
        <Uchwyt
          kierunek="poziom"
          title="Przeciągnij, aby zmienić wysokość panelu ruchu"
          onStart={(e) => setStartWys(document.querySelector(".traffic-panel").getBoundingClientRect().height)}
          onRuch={(dy) => startWys != null && zapiszWys(Math.max(120, Math.min(window.innerHeight * 0.75, startWys - dy)))}
          onKoniec={() => setStartWys(null)}
        />
      )}
      <div className="tp-head">
        <b>Ruch drogowy · wariant {activeId}</b>
        <div className="seg">
          {[
            ["brak", "Bez warstwy"],
            ["ruch", "Natężenie"],
            ["halas", "Hałas"],
          ].map(([k, l]) => (
            <button key={k} className={warstwa === k ? "on" : ""} onClick={() => onWarstwa(k)}>
              {l}
            </button>
          ))}
        </div>
        <button className="link" onClick={() => setOtwarty(!otwarty)}>
          {otwarty ? "zwiń" : "rozwiń"} <Ikona n={otwarty ? "expand_more" : "expand_less"} />
        </button>
      </div>

      {otwarty && (
        <>
          <div className="tp-controls">
            <button className="play" onClick={() => setGra(!gra)} title="Animuj dobę">
              <Ikona n={gra ? "pause" : "play_arrow"} />
            </button>
            <label className="hour">
              Godzina <b>{String(godzina).padStart(2, "0")}:00</b>
              <input type="range" min="0" max="23" value={godzina} onChange={(e) => onGodzina(+e.target.value)} />
            </label>
            <div className="seg small">
              <button className={!weekend ? "on" : ""} onClick={() => onWeekend(false)}>
                dzień roboczy
              </button>
              <button className={weekend ? "on" : ""} onClick={() => onWeekend(true)}>
                weekend
              </button>
            </div>
            <label>
              Rok{" "}
              <select value={rok} onChange={(e) => onRok(+e.target.value)}>
                {LATA.map((r) => (
                  <option key={r} value={r}>
                    {r}
                    {r > ROK_BAZY ? " (prognoza)" : r < ROK_BAZY ? " (historia)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="tp-kpis">
            <div className="kpi">
              <span>Zakorkowanie teraz</span>
              <b>{proc(zakTeraz)}</b>
              <small>dłuższy czas przejazdu niż przy pustych drogach</small>
            </div>
            <div className="kpi">
              <span>W szczycie ({String(aktywny.ruch.szczyt).padStart(2, "0")}:00)</span>
              <b>{proc(zakSzczyt)}</b>
              <small>
                {aktywny.liczbaInwestycji
                  ? `${zakSzczyt > zakBaza ? "+" : "−"}${(Math.abs(zakSzczyt - zakBaza) * 100).toFixed(2)} p.p. wobec stanu bez inwestycji`
                  : "stan bez inwestycji"}
              </small>
            </div>
            <div className="kpi">
              <span>Narażeni na hałas &gt;{z("progWHO")} dB</span>
              <b>{fmtInt(aktywny.suma.narazeniHalas)}</b>
              <small>{aktywny.liczbaInwestycji ? `${dHalas > 0 ? "+" : "−"}${fmtInt(Math.abs(dHalas))} os. wobec stanu bez inwestycji` : "szacunek z natężenia ruchu"}</small>
            </div>
          </div>

          <div className="tp-charts">
            <Wykres
              tytul={`Zakorkowanie w ciągu doby (${weekend ? "weekend" : "dzień roboczy"})`}
              serie={serieDoby}
              xs={Array.from({ length: 24 }, (_, i) => i)}
              xLabel="godz."
              formatX={(h) => `${h}:00`}
              zaznaczone={godzina}
              onKlik={onGodzina}
            />
            <Wykres
              tytul="Zakorkowanie w szczycie: historia i prognoza"
              serie={serieLat}
              xs={LATA}
              xLabel="rok"
              formatX={(r) => String(r)}
              zaznaczone={LATA.indexOf(rok)}
              onKlik={onRok}
            />
          </div>

          <div className="tp-legend">
            {serieDoby.map((s) => (
              <span key={s.id}>
                <i className={s.przerywana ? "dash" : ""} style={{ borderColor: s.kolor }} /> {s.nazwa}
              </span>
            ))}
            {warstwa !== "brak" && <span className="sep">Mapa:</span>}
            {warstwa !== "brak" &&
              pasma.map((p) => (
                <span key={p.label}>
                  <i className="band" style={{ background: p.kolor }} /> {p.label}
                </span>
              ))}
            <button className="link" onClick={() => setTabela(!tabela)}>
              {tabela ? "ukryj tabelę" : "tabela"}
            </button>
          </div>
          {tabela && (
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Godz.</th>
                  {serieDoby.map((s) => (
                    <th key={s.id}>{s.nazwa}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 24 }, (_, h) => (
                  <tr key={h} className={h === godzina ? "sel" : ""}>
                    <td>{h}:00</td>
                    {serieDoby.map((s) => (
                      <td key={s.id}>{proc(s.dane[h])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Model szacunkowy: ruch z klasy drogi, liczby pasów, położenia i stref pracy (OSM); profile godzinowe typowe
            dla miast średniej wielkości; lata przed {ROK_BAZY} to rekonstrukcja (trend + spadek w pandemii 2020–21), nie
            pomiary. Inwestycje wchodzą stopniowo w latach 2028–2030.
          </p>
        </>
      )}
    </div>
  );
}
