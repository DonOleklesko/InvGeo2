// Zwijany moduł panelu: klik w nagłówek zwija / rozwija treść.
// Stan zwinięcia pamiętamy w przeglądarce, a przyciski „zwiń / rozwiń wszystko”
// działają na wszystkie moduły naraz (wspólny magazyn stanu).
import { useSyncExternalStore } from "react";
import Ikona from "./Ikona.jsx";

const KLUCZ = "torun2036:zwiniete";
let zwiniete = (() => {
  try {
    return JSON.parse(localStorage.getItem(KLUCZ)) || {};
  } catch {
    return {};
  }
})();
const sluchacze = new Set();
const znane = new Set(); // id wszystkich modułów, które się wyrenderowały

function ustaw(nowe) {
  zwiniete = nowe;
  try {
    localStorage.setItem(KLUCZ, JSON.stringify(zwiniete));
  } catch {
    /* zapis niedostępny – działamy bez niego */
  }
  sluchacze.forEach((f) => f());
}
const subskrybuj = (f) => {
  sluchacze.add(f);
  return () => sluchacze.delete(f);
};
const useZwiniete = () => useSyncExternalStore(subskrybuj, () => zwiniete);

export function zwinWszystko(zwin) {
  ustaw(Object.fromEntries([...znane].map((id) => [id, zwin])));
}

export default function Modul({ id, tytul, className = "", sub = false, children, prawa }) {
  const stan = useZwiniete();
  znane.add(id);
  const zwiniety = !!stan[id];
  const Naglowek = sub ? "h3" : "h2";
  const Tag = sub ? "div" : "section";
  return (
    <Tag className={`modul ${sub ? "sub" : ""} ${zwiniety ? "zwiniety" : ""} ${className}`}>
      <Naglowek className="mod-naglowek">
        <button
          className="mod-przelacznik"
          aria-expanded={!zwiniety}
          onClick={() => ustaw({ ...zwiniete, [id]: !zwiniety })}
          title={zwiniety ? "Rozwiń" : "Zwiń"}
        >
          <Ikona n="expand_more" className="strzalka" />
          {tytul}
        </button>
        {prawa}
      </Naglowek>
      {!zwiniety && <div className="mod-tresc">{children}</div>}
    </Tag>
  );
}

// Przyciski do zwijania / rozwijania wszystkich modułów naraz
export function ZwinWszystko() {
  const stan = useZwiniete();
  const wszystkieZwiniete = [...znane].length > 0 && [...znane].every((id) => stan[id]);
  return (
    <button className="link zwin-wszystko" onClick={() => zwinWszystko(!wszystkieZwiniete)}>
      {wszystkieZwiniete ? "rozwiń wszystkie" : "zwiń wszystkie"}
    </button>
  );
}
