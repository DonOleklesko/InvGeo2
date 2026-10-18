// Propozycje nowych dróg (łączniki) i Park & Ride liczone w osobnym wątku (Web Worker),
// żeby nie blokować mapy przy starcie – na słabszym laptopie to kilka sekund pracy.
// Wątek nie ma localStorage ani adresu strony, więc miasto przychodzi w wiadomości,
// a modele ładujemy dopiero po jego ustawieniu (patrz src/data/miasta.js).
let modele = null;

self.onmessage = async ({ data: { id, rodzaj, dane, miasto } }) => {
  try {
    if (!modele) {
      globalThis.__MIASTO_WATKU = miasto;
      modele = Promise.all([import("./roads.js"), import("./zones.js")]);
    }
    const [{ proponujLaczniki }, { proponujParkRide }] = await modele;
    const wynik =
      rodzaj === "laczniki" ? proponujLaczniki(dane.roads, dane.rivers, dane.boundary) : proponujParkRide(dane);
    self.postMessage({ id, wynik });
  } catch (e) {
    self.postMessage({ id, blad: String(e?.message || e) });
  }
};
