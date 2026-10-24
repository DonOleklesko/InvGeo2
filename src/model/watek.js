// Liczenie w osobnych wątkach (Web Worker). Dwa wątki: „ruch” (model rozkładu ruchu dla mapy
// i wariantów – musi odpowiadać szybko) i „propozycje” (propozycje dróg, linii, P&R – mogą liczyć
// dłużej, bo oceniają kandydatów modelem ruchu). Gdy przeglądarka nie uruchomi wątku, liczymy
// na miejscu (zapas), jak dawniej.
import { MIASTO } from "../data/miasta.js";

const watki = new Map(); // nazwa → Worker | false
let licznik = 0;
const czeka = new Map();

function watek(nazwa) {
  if (watki.has(nazwa)) return watki.get(nazwa);
  let w = false;
  try {
    w = new Worker(new URL("./propozycje.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      const c = czeka.get(data.id);
      if (!c) return;
      czeka.delete(data.id);
      if (data.blad) c.reject(new Error(data.blad));
      else c.resolve(data.wynik);
    };
    w.onerror = () => {
      for (const [id, c] of czeka) if (c.watek === nazwa) c.reject(new Error("wątek niedostępny")), czeka.delete(id);
      watki.set(nazwa, false);
    };
  } catch {
    w = false;
  }
  watki.set(nazwa, w);
  return w;
}
const ktoryWatek = (rodzaj) => (rodzaj === "ruch" || rodzaj === "dane" ? "ruch" : "propozycje");

// Duże dane (np. sieć ulic do modelu ruchu) wysyłamy do wątku raz, pod nazwą; potem
// liczWWatku("ruch", { nazwa, scenariusz }) używa ich bez ponownego kopiowania.
const wyslane = new Map(); // nazwa → obiekt danych, który już jest w wątku
export function ustawDaneWatku(nazwa, dane) {
  const w = watek("ruch");
  if (!w || wyslane.get(nazwa) === dane) return;
  wyslane.set(nazwa, dane);
  const id = ++licznik;
  czeka.set(id, { resolve() {}, reject() {}, watek: "ruch" });
  w.postMessage({ id, rodzaj: "dane", nazwa, dane, miasto: MIASTO.id });
}

// rodzaj: "laczniki" | "linie" | "parkride" | "ruch"; zapas: ta sama funkcja liczona na miejscu
export function liczWWatku(rodzaj, dane, zapas) {
  const nazwa = ktoryWatek(rodzaj);
  const w = watek(nazwa);
  if (!w) return Promise.resolve().then(zapas);
  const id = ++licznik;
  return new Promise((resolve, reject) => {
    czeka.set(id, { resolve, reject, watek: nazwa });
    w.postMessage({ id, rodzaj, dane, miasto: MIASTO.id });
  }).catch(zapas);
}
