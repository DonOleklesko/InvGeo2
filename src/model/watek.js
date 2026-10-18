// Liczenie w osobnym wątku (Web Worker) – jeden wspólny wątek na propozycje.
// Gdy przeglądarka nie uruchomi wątku, liczymy na miejscu (zapas), jak dawniej.
import { MIASTO } from "../data/miasta.js";

let worker = null; // null – jeszcze nie tworzony, false – niedostępny
let licznik = 0;
const czeka = new Map();

function watek() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL("./propozycje.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const c = czeka.get(data.id);
      if (!c) return;
      czeka.delete(data.id);
      if (data.blad) c.reject(new Error(data.blad));
      else c.resolve(data.wynik);
    };
    worker.onerror = () => {
      for (const c of czeka.values()) c.reject(new Error("wątek niedostępny"));
      czeka.clear();
      worker = false;
    };
  } catch {
    worker = false;
  }
  return worker;
}

// rodzaj: "laczniki" | "parkride"; zapas: ta sama funkcja liczona na miejscu
export function liczWWatku(rodzaj, dane, zapas) {
  const w = watek();
  if (!w) return Promise.resolve().then(zapas);
  const id = ++licznik;
  return new Promise((resolve, reject) => {
    czeka.set(id, { resolve, reject });
    w.postMessage({ id, rodzaj, dane, miasto: MIASTO.id });
  }).catch(zapas);
}
