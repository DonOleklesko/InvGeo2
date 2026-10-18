// Prawy panel: dane z oficjalnych źródeł (GIOŚ na żywo, GUS, urząd miasta)
// zestawione z wynikami modelu, żeby było widać, gdzie model odbiega od pomiarów.
import { useCallback, useEffect, useState } from "react";
import Modul from "./Modul.jsx";
import Ikona from "./Ikona.jsx";
import {
  indeksyPowietrza, statystykiRoczne, REFERENCYJNE, ZRODLA_OFICJALNE, NORMY_POWIETRZA,
} from "../data/official.js";
import { MIASTO } from "../data/miasta.js";
import { fmtInt } from "../model/simulate.js";

// Pobieranie danych GIOŚ (używane też przez raport PDF)
export function useDaneOficjalne() {
  const [stan, setStan] = useState({ status: "ladowanie" });
  const odswiez = useCallback(async (wymus = false) => {
    const ac = new AbortController();
    setStan((s) => ({ ...s, status: "ladowanie" }));
    const [ind, stat] = await Promise.allSettled([indeksyPowietrza(ac.signal, !!wymus), statystykiRoczne(ac.signal)]);
    setStan({
      status: ind.status === "rejected" && stat.status === "rejected" ? "blad" : "ok",
      indeksy: ind.status === "fulfilled" ? ind.value : null,
      statystyki: stat.status === "fulfilled" ? stat.value : null,
      czas: new Date(),
    });
    return () => ac.abort();
  }, []);
  useEffect(() => {
    odswiez();
  }, [odswiez]);
  return [stan, odswiez];
}

const Zrodlo = ({ id }) => (
  <a className="src-link" href={ZRODLA_OFICJALNE[id].url} target="_blank" rel="noopener noreferrer">
    {ZRODLA_OFICJALNE[id].nazwa} <Ikona n="open_in_new" />
  </a>
);

const fmtRef = (r) =>
  r.format === "int" ? fmtInt(r.wartosc) : r.wartosc.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function OfficialPanel({ dane, onOdswiez, modelNarazeni }) {
  const { status, indeksy, statystyki, czas } = dane;
  const lata = statystyki ? [...new Set([...statystyki.PM10, ...statystyki.NO2].map((x) => x.rok))].sort((a, b) => b - a).slice(0, 6) : [];
  const wiersz = (wsk, rok) => statystyki?.[wsk]?.find((x) => x.rok === rok);
  const ludnosc = REFERENCYJNE.find((r) => r.id === "ludnosc").wartosc;
  const halasProc = REFERENCYJNE.find((r) => r.id === "halasDrogowy")?.wartosc;

  return (
    <Modul id="oficjalne" tytul="Dane z oficjalnych źródeł">
      <div className={status === "blad" ? "of-live err" : "of-live"}>
        <span className="dot" />
        {status === "ladowanie" && "Pobieranie pomiarów GIOŚ…"}
        {status === "ok" && `Pomiary GIOŚ pobrane ${czas?.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`}
        {status === "blad" && "Brak połączenia z API GIOŚ (wymaga serwera Vite: npm run dev)"}
        <button className="link" onClick={onOdswiez} style={{ marginLeft: "auto" }}>
          odśwież
        </button>
      </div>

      <h3>Jakość powietrza teraz – stacje w {MIASTO.miejscownik}</h3>
      {indeksy ? (
        <ul className="aq-list">
          {indeksy.map((s) => (
            <li key={s.id}>
              <span className={`aq-badge aq-${s.blad || s.wartosc == null || s.wartosc < 0 ? "x" : s.wartosc}`}>
                {s.blad ? "brak danych" : s.kategoria}
              </span>
              <span className="grow">
                {s.nazwa}
                <span className="muted small" style={{ display: "block" }}>
                  {s.data ? `dane z ${s.data.slice(0, 16)}` : ""}
                  {s.pm10 ? ` · PM10: ${s.pm10}` : ""}
                  {s.no2 ? ` · NO₂: ${s.no2}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{status === "ladowanie" ? "Wczytywanie…" : "Niedostępne."}</p>
      )}

      <h3>Średnie roczne stężenia (średnia ze stacji, µg/m³)</h3>
      {lata.length > 0 ? (
        <table className="of-table">
          <thead>
            <tr>
              <th>Rok</th>
              <th>PM10</th>
              <th title="Liczba dni z dobowym PM10 > 50 µg/m³ (norma: maks. 35)">dni &gt;50</th>
              <th>NO₂</th>
            </tr>
          </thead>
          <tbody>
            {lata.map((r) => {
              const pm = wiersz("PM10", r);
              const no = wiersz("NO2", r);
              return (
                <tr key={r}>
                  <td>{r}</td>
                  <td className={pm && pm.srednia > NORMY_POWIETRZA.PM10.norma ? "over" : ""}>{pm ? pm.srednia.toFixed(1) : "–"}</td>
                  <td className={pm && pm.dni50 > 35 ? "over" : ""}>{pm?.dni50 ?? "–"}</td>
                  <td className={no && no.srednia > NORMY_POWIETRZA.NO2.norma ? "over" : ""}>{no ? no.srednia.toFixed(1) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">{status === "ladowanie" ? "Wczytywanie…" : "Niedostępne."}</p>
      )}
      <p className="muted small">
        Norma średniej rocznej (dyrektywa 2008/50/WE): PM10 i NO₂ – 40 µg/m³. Zalecenia WHO 2021: PM10 – 15, NO₂ – 10 µg/m³.
      </p>

      <h3>Wartości referencyjne</h3>
      <ul className="of-ref">
        {REFERENCYJNE.map((r) => (
          <li key={r.id}>
            {r.etykieta}: <b>{fmtRef(r)} {r.jedn}</b>
            <span className="meta">
              stan: {r.stan} · <Zrodlo id={r.zrodlo} />
            </span>
          </li>
        ))}
      </ul>

      {modelNarazeni != null && halasProc != null && (
        <div className="of-compare">
          <b>Model a dane miasta – hałas drogowy</b>
          <br />
          Mapa akustyczna: ok. {fmtInt((ludnosc * halasProc) / 100)} os. powyżej normy (LDWN). Model prototypu: {fmtInt(modelNarazeni)} os.
          powyżej progu WHO 53 dB. Progi są różne (norma krajowa jest łagodniejsza), więc liczby nie są wprost porównywalne – ale pokazują
          skalę rozbieżności, którą trzeba skalibrować przed użyciem wyników.
        </div>
      )}

      <ul className="lista-zrodel" style={{ marginTop: 10 }}>
        {["gios", "giosMapa", "dyrektywa", "who2021", "gpr"].map((id) => (
          <li key={id}>
            <Zrodlo id={id} />
          </li>
        ))}
      </ul>
    </Modul>
  );
}
