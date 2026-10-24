// Obliczenia w osobnym wątku (Web Worker), żeby nie blokować mapy – na słabszym laptopie to
// kilka sekund pracy: propozycje dróg (łączniki), linii autobusowych i Park & Ride oraz model
// rozkładu ruchu (stan obecny i scenariusze wariantów).
// Wątek nie ma localStorage ani adresu strony, więc miasto przychodzi w wiadomości,
// a modele ładujemy dopiero po jego ustawieniu (patrz src/data/miasta.js).
// Duże dane (drogi, ulice, zabudowa) przychodzą raz („dane”) i zostają w pamięci wątku.
let modele = null;
const pamiec = new Map();

self.onmessage = async ({ data: { id, rodzaj, dane, miasto, nazwa } }) => {
  try {
    if (!modele) {
      globalThis.__MIASTO_WATKU = miasto;
      modele = Promise.all([import("./roads.js"), import("./zones.js"), import("./linie.js"), import("./przeplywy.js")]);
    }
    if (rodzaj === "dane") {
      pamiec.set(nazwa, dane);
      self.postMessage({ id, wynik: true });
      return;
    }
    const [{ proponujLaczniki }, { proponujParkRide }, { proponujLinie }, { przypiszRuch }] = await modele;
    let wynik;
    if (rodzaj === "ruch") {
      const d = pamiec.get(dane.nazwa);
      if (!d) throw new Error("brak danych w wątku: " + dane.nazwa);
      wynik = przypiszRuch(d, dane.scenariusz || {});
    } else if (rodzaj === "laczniki") {
      // propozycje dróg: z siatką budynków (przebieg omija domy) i oceną modelem rozkładu ruchu
      const { wczytajBudynki } = await import("../data/budynki.js");
      wynik = proponujLaczniki({ ...dane, budynki: await wczytajBudynki(), ocenaRuchu: true });
    }
    else if (rodzaj === "linie") wynik = proponujLinie(dane);
    else wynik = proponujParkRide(dane);
    self.postMessage({ id, wynik });
  } catch (e) {
    self.postMessage({ id, blad: String(e?.message || e) });
  }
};
