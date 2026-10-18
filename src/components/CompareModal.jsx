// Okno porównania wariantów (otwierane przyciskiem w prawym dolnym rogu mapy,
// dostępnym, gdy co najmniej dwa warianty mają inwestycje).
import { useEffect } from "react";
import { GRUPY, najlepsza, punktacja } from "../model/porownanie.js";
import Ikona from "./Ikona.jsx";

export default function CompareModal({ warianty, activeId, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const lista = warianty.filter((w) => w.liczbaInwestycji > 0);
  const pkt = punktacja(lista);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
        <div className="modal-head">
          <Ikona n="compare_arrows" />
          <h2 id="cmp-title">Porównanie wariantów</h2>
          <button className="icon-btn" onClick={onClose} title="Zamknij (Esc)">
            <Ikona n="close" />
          </button>
        </div>
        <div className="modal-body">
          <table className="compare">
            <thead>
              <tr>
                <th>Wskaźnik</th>
                {lista.map((w) => (
                  <th key={w.id} className={w.id === activeId ? "active" : ""}>
                    Wariant {w.id}
                    <span className="vname">
                      {w.nazwa} · {w.liczbaInwestycji} inw.
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRUPY.map(([grupa, wiersze]) => [
                <tr key={grupa} className="grp">
                  <td colSpan={lista.length + 1}>{grupa}</td>
                </tr>,
                ...wiersze.map(([label, val, fmt, kier]) => {
                  const vals = lista.map((w) => val(w.suma));
                  const best = najlepsza(vals, kier);
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      {lista.map((w, i) => (
                        <td key={w.id} className={`${w.id === activeId ? "active" : ""} ${best != null && vals[i] === best ? "best" : ""}`}>
                          {fmt(w.suma)}
                        </td>
                      ))}
                    </tr>
                  );
                }),
              ])}
              <tr className="grp">
                <td>Najkorzystniejszy w (liczba wskaźników)</td>
                {lista.map((w) => (
                  <td key={w.id} className={w.id === activeId ? "active" : ""}>
                    {pkt[w.id]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="modal-foot">
          Zielony kolor = najkorzystniejsza wartość w wierszu. Wartości z modelu szacunkowego na danych testowych – nie do analiz
          inwestycyjnych.
        </div>
      </div>
    </div>
  );
}
