// MIASTA – wszystko, co zależy od wybranego miasta (obszar, centrum, granica w OSM,
// stacje GIOŚ, dane GUS). Aktywne miasto jest pamiętane w przeglądarce; zmiana miasta
// przeładowuje stronę, więc wszystkie dane i modele liczą się od nowa (bez mieszania
// danych dwóch miast w pamięci – ważne na słabszych komputerach).

export const MIASTA = {
  torun: {
    id: "torun",
    nazwa: "Toruń",
    dopelniacz: "Torunia",
    miejscownik: "Toruniu",
    // prostokąt (bbox) z małym zapasem: południe, zachód, północ, wschód
    bbox: [52.95, 18.45, 53.08, 18.78],
    centrum: [53.0103, 18.6045], // Stary Rynek
    osmNazwa: "Toruń",
    rzeka: "Wisłę",
    ludnosc: 194273,
    powierzchnia: 115.7,
    gestosc: 1680,
    stanGus: "31.12.2024",
    gusUrl: "https://www.polskawliczbach.pl/Torun",
    wojewodztwo: "kujawsko-pomorskie",
    prefiksGios: "KpToru",
    stacjeGios: [
      { id: 206, kod: "KpToruDziewu", nazwa: "ul. Dziewulskiego", coords: [18.666103, 53.028647] },
      { id: 208, kod: "KpToruKaszow", nazwa: "ul. Przy Kaszowniku", coords: [18.612808, 53.017628] },
      { id: 145, kod: "KpToruWSikor", nazwa: "ul. Wały gen. Sikorskiego", coords: [18.605681, 53.012475] },
    ],
    // mapa akustyczna miasta (tylko tam, gdzie mamy źródło)
    halas: {
      drogowy: 2.4,
      noc: 1.1,
      stan: "mapa akustyczna, dokument z 2018 r.",
      zrodlo: { nazwa: "UM Toruń – Program ochrony środowiska przed hałasem (konsultacje 2018)", url: "https://www.konsultacje.torun.pl/pl/printpdf/234697" },
    },
  },
  bydgoszcz: {
    id: "bydgoszcz",
    nazwa: "Bydgoszcz",
    dopelniacz: "Bydgoszczy",
    miejscownik: "Bydgoszczy",
    bbox: [53.04, 17.84, 53.22, 18.22],
    centrum: [53.1229, 18.0003], // Stary Rynek
    osmNazwa: "Bydgoszcz",
    rzeka: "Brdę lub Wisłę",
    ludnosc: 325000,
    powierzchnia: 176.0,
    gestosc: 1847,
    stanGus: "2024 (gęstość × powierzchnia, ok.)",
    gusUrl: "https://www.polskawliczbach.pl/Bydgoszcz",
    wojewodztwo: "kujawsko-pomorskie",
    prefiksGios: "KpByd",
    stacjeGios: [
      { id: 156, kod: "KpBydPlPozna", nazwa: "Pl. Poznański", coords: [17.987906, 53.121764] },
      { id: 158, kod: "KpBydWarszaw", nazwa: "ul. Warszawska", coords: [17.995708, 53.134083] },
      { id: 150, kod: "KpBydFieldor", nazwa: "ul. Fieldorfa", coords: [18.132062, 53.151452] },
      { id: 11576, kod: "KpBydJezdzie", nazwa: "ul. Jeździecka", coords: [18.044164, 53.175214] },
    ],
    halas: null,
  },
  elblag: {
    id: "elblag",
    nazwa: "Elbląg",
    dopelniacz: "Elbląga",
    miejscownik: "Elblągu",
    bbox: [54.11, 19.32, 54.28, 19.54],
    centrum: [54.1560, 19.4030], // Stare Miasto
    osmNazwa: "Elbląg",
    rzeka: "rzekę Elbląg",
    ludnosc: 112400,
    powierzchnia: 79.8,
    gestosc: 1409,
    stanGus: "2024 (gęstość × powierzchnia, ok.)",
    gusUrl: "https://www.polskawliczbach.pl/Elblag",
    wojewodztwo: "warmińsko-mazurskie",
    prefiksGios: "WmElb",
    stacjeGios: [{ id: 861, kod: "WmElbBazynsk", nazwa: "ul. Bażyńskiego", coords: [19.410942, 54.167847] }],
    halas: null,
  },
};

const KLUCZ = "invgeo:miasto";

function wybraneMiasto() {
  // ?miasto=elblag w adresie ma pierwszeństwo (łatwo podać link do konkretnego miasta)
  try {
    // w Web Workerze miasto ustawia wątek (src/model/propozycje.worker.js) – nie ma tam localStorage
    if (globalThis.__MIASTO_WATKU && MIASTA[globalThis.__MIASTO_WATKU]) return globalThis.__MIASTO_WATKU;
    const zAdresu = new URLSearchParams(globalThis.location?.search || "").get("miasto");
    if (zAdresu && MIASTA[zAdresu]) return zAdresu;
  } catch {
    /* poza przeglądarką */
  }
  try {
    const z = globalThis.localStorage?.getItem(KLUCZ);
    if (z && MIASTA[z]) return z;
  } catch {
    /* zapis niedostępny */
  }
  return "torun";
}

export const MIASTO = MIASTA[wybraneMiasto()];

// Prefiks kluczy w localStorage: Toruń zostaje przy starych kluczach (zachowane warianty)
export const PREFIKS = MIASTO.id === "torun" ? "torun2036:" : `invgeo:${MIASTO.id}:`;

export function zmienMiasto(id) {
  if (!MIASTA[id] || id === MIASTO.id) return;
  const url = new URL(location.href);
  url.searchParams.delete("miasto");
  try {
    localStorage.setItem(KLUCZ, id);
  } catch {
    url.searchParams.set("miasto", id); // bez zapisu – wybór przez adres
  }
  location.replace(url.toString());
}
