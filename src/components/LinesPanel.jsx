// Panel wyboru linii: przyciski z numerami linii (klik = pokaż/ukryj, najechanie = podświetl).
import { lineColor } from "../data/lineColors.js";

const GRUPY = [
  { key: "tram", label: "Tramwaje", test: (p) => p.mode === "tram" },
  { key: "bus", label: "Autobusy", test: (p) => p.mode === "bus" && !p.nocna },
  { key: "noc", label: "Nocne", test: (p) => p.mode === "bus" && p.nocna },
];

export default function LinesPanel({ lines, visible, setVisible, onHover }) {
  if (!lines?.features.length) return <p className="muted">Linie wczytują się…</p>;

  const toggle = (id) => {
    const n = new Set(visible);
    n.has(id) ? n.delete(id) : n.add(id);
    setVisible(n);
  };
  const setGroup = (ids, on) => {
    const n = new Set(visible);
    ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
    setVisible(n);
  };

  return (
    <div className="lines-panel">
      {GRUPY.map((g) => {
        const grupa = lines.features.map((f) => f.properties).filter(g.test);
        if (!grupa.length) return null;
        const ids = grupa.map((p) => p.id);
        const wszystkie = ids.every((id) => visible.has(id));
        return (
          <div key={g.key} className="line-group">
            <div className="line-group-head">
              <span>{g.label}</span>
              <button className="link" onClick={() => setGroup(ids, !wszystkie)}>
                {wszystkie ? "ukryj" : "pokaż"} wszystkie
              </button>
            </div>
            <div className="chips">
              {grupa.map((p) => {
                const on = visible.has(p.id);
                return (
                  <button
                    key={p.id}
                    className={on ? "chip on" : "chip"}
                    style={{ "--c": lineColor(p) }}
                    title={p.kierunki.join("\n")}
                    onClick={() => toggle(p.id)}
                    onMouseEnter={() => onHover(p.id)}
                    onMouseLeave={() => onHover(null)}
                  >
                    {p.ref}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="muted small">Klik – pokaż/ukryj linię. Najedź na linię lub przystanek, aby ją podświetlić.</p>
    </div>
  );
}
