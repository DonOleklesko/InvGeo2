// ZAŁOŻENIA MODELU
// Wszystkie liczby są uproszczonymi przybliżeniami do prototypu.
// Każdą można (i trzeba) później zweryfikować na prawdziwych danych.
import { MIASTO } from "../data/miasta.js";

export const ZALOZENIA = {
  osobNaMieszkanie: { v: 2.0, jedn: "os.", opis: "Średnia liczba osób w mieszkaniu (Toruń: 1,92 w 2024 r., nowe osiedla nieco więcej)" },
  podrozyNaOsobe: { v: 2.5, jedn: "podróży/dzień", opis: "Średnia liczba podróży mieszkańca dziennie" },
  udzialAuta: { v: 0.55, jedn: "", opis: "Udział podróży samochodem, gdy przystanek jest w zasięgu" },
  udzialAutaBezPrzystanku: { v: 0.68, jedn: "", opis: "Udział podróży samochodem, gdy brak przystanku w 400 m" },
  udzialKomunikacji: { v: 0.25, jedn: "", opis: "Udział podróży komunikacją miejską (przy przystanku w zasięgu)" },
  udzialKomunikacjiBezPrzystanku: { v: 0.12, jedn: "", opis: "Udział komunikacji miejskiej, gdy brak przystanku w 400 m" },
  udzialSzczytu: { v: 0.1, jedn: "", opis: "Część dziennych podróży w godzinie szczytu" },
  pojemnoscAutobusu: { v: 60, jedn: "os.", opis: "Praktyczna pojemność jednego autobusu" },
  udzialDzieciSzkolnych: { v: 0.09, jedn: "", opis: "Udział dzieci w wieku szkoły podstawowej" },
  promienPrzystanku: { v: 400, jedn: "m", opis: "Akceptowalne dojście do przystanku" },
  promienSzkoly: { v: 1000, jedn: "m", opis: "Akceptowalne dojście do szkoły podstawowej" },
  promienZieleni: { v: 500, jedn: "m", opis: "Akceptowalne dojście do parku" },
  normaZieleni: { v: 9, jedn: "m²/os.", opis: "Często przywoływany minimalny wskaźnik zieleni na mieszkańca" },
  gestoscMiasta: { v: MIASTO.gestosc, jedn: "os./km²", opis: `Średnia gęstość zaludnienia ${MIASTO.dopelniacz} (ok. ${MIASTO.ludnosc.toLocaleString("pl-PL")} os. / ${MIASTO.powierzchnia.toLocaleString("pl-PL")} km², 2024 r.)` },
  mieszkanNaHa: { v: 60, jedn: "mieszk./ha", opis: "Typowa intensywność zabudowy wielorodzinnej (do porównań)" },
  kosztInfraNaMieszkanie: { v: 30000, jedn: "zł", opis: "Koszt miasta: drogi, sieci, oświetlenie na 1 mieszkanie" },
  kosztParkuNaM2: { v: 200, jedn: "zł/m²", opis: "Koszt urządzenia parku (zieleń, alejki, mała architektura)" },
  kosztZamknieciaNaM: { v: 400, jedn: "zł/m", opis: "Przebudowa ulicy na deptak / strefę pieszą" },
  udzialObjazdow: { v: 0.7, jedn: "", opis: "Część ruchu z zamkniętej ulicy, która przenosi się na objazdy" },
  kosztDrogiNaM: { v: 12000, jedn: "zł/m", opis: "Budowa nowej ulicy (jezdnia, chodniki, oświetlenie, odwodnienie)" },
  kosztMostu: { v: 400e6, jedn: "zł", opis: `Dodatkowy koszt mostu, gdy nowa droga przecina ${MIASTO.rzeka}` },
  kosztMostuMalego: { v: 70e6, jedn: "zł", opis: "Most przez mniejszą rzekę lub kanał (zamiast mostu na dużej rzece)" },
  kosztWiaduktu: { v: 60e6, jedn: "zł", opis: "Dodatkowy koszt wiaduktu, gdy nowa droga przecina tory kolejowe" },
  udzialPrzejetegoRuchu: { v: 0.4, jedn: "", opis: "Część ruchu z okolicznych ulic, którą przejmie nowa droga" },

  // --- parkingi, P&R, ładowarki, fotowoltaika ---
  m2NaMiejsce: { v: 25, jedn: "m²", opis: "Powierzchnia parkingu na jedno miejsce (z dojazdami)" },
  kosztMiejscaParkingowego: { v: 15000, jedn: "zł", opis: "Budowa jednego miejsca na parkingu naziemnym" },
  rotacjaPR: { v: 1.1, jedn: "auta/miejsce/dzień", opis: "Ile aut dziennie obsługuje jedno miejsce Park & Ride" },
  dystansPRdoCentrum: { v: 6, jedn: "km", opis: "Średnia długość podróży autem do centrum oszczędzona dzięki P&R (w jedną stronę)" },
  kosztLadowarki: { v: 45000, jedn: "zł", opis: "Ładowarka AC 22 kW (2 punkty) z przyłączem" },
  energiaLadowarki: { v: 60, jedn: "kWh/dzień", opis: "Średnia energia wydana przez jedną ładowarkę dziennie" },
  marzaLadowania: { v: 0.6, jedn: "zł/kWh", opis: "Przychód netto miasta z 1 kWh ładowania" },
  kWpNaM2: { v: 0.2, jedn: "kWp/m²", opis: "Moc paneli na wiacie fotowoltaicznej" },
  uzyskPV: { v: 1000, jedn: "kWh/kWp/rok", opis: "Roczna produkcja energii z 1 kWp w Polsce" },
  kosztPV: { v: 6000, jedn: "zł/kWp", opis: "Koszt dużej wiaty fotowoltaicznej (konstrukcja + panele); małe wiaty 9–12 tys. zł/kWp" },
  cenaEnergii: { v: 0.9, jedn: "zł/kWh", opis: "Cena energii zaoszczędzonej przez miasto" },
  co2Sieci: { v: 0.717, jedn: "kg CO₂/kWh", opis: "Emisyjność energii elektrycznej w Polsce (KOBiZE, dane za 2024 r.)" },
  co2Auta: { v: 0.17, jedn: "kg CO₂/km", opis: "Emisja przeciętnego auta w ruchu miejskim (nowe auta w UE: 0,106 wg testu WLTP; flota w Polsce jest starsza)" },

  // --- komunikacja miejska ---
  kosztTramwajuNaKm: { v: 70e6, jedn: "zł/km", opis: "Budowa trasy tramwajowej (torowisko, sieć, przystanki)" },
  kosztWozokmTram: { v: 18, jedn: "zł/wozokm", opis: "Koszt eksploatacji tramwaju" },
  kosztWozokmBus: { v: 9, jedn: "zł/wozokm", opis: "Koszt eksploatacji autobusu" },
  kosztAutobusu: { v: 3.15e6, jedn: "zł", opis: "Zakup jednego autobusu elektrycznego (Toruń 2025: ok. 3,15 mln zł brutto)" },
  promienTramwaju: { v: 500, jedn: "m", opis: "Zasięg dojścia do przystanku tramwajowego" },
  odstepPrzystankow: { v: 500, jedn: "m", opis: "Średnia odległość między przystankami nowej linii" },
  przejecieAut: { v: 0.08, jedn: "", opis: "Część podróży autem w zasięgu nowej linii, które przejdą na komunikację" },
  predkoscKomunikacji: { v: 18, jedn: "km/h", opis: "Średnia prędkość komunikacyjna (do liczenia liczby pojazdów)" },
  godzinKursowania: { v: 18, jedn: "h/dzień", opis: "Ile godzin dziennie kursuje linia" },

  // --- ruch i hałas ---
  wzrostRuchu: { v: 0.015, jedn: "/rok", opis: "Średni roczny wzrost ruchu bez nowych inwestycji (trend)" },
  wartoscCzasu: { v: 30, jedn: "zł/h", opis: "Wartość godziny czasu podróżnego (do analizy korzyści)" },
  progHalasu: { v: 68, jedn: "dB", opis: "Dopuszczalny hałas drogowy LDWN dla zabudowy wielorodzinnej (jednorodzinna: 64 dB)" },
  progWHO: { v: 53, jedn: "dB", opis: "Zalecenie WHO dla hałasu drogowego (Lden)" },
  stopaDyskonta: { v: 0.04, jedn: "", opis: "Stopa dyskontowa do analizy NPV" },
  horyzontAnalizy: { v: 20, jedn: "lat", opis: "Okres analizy inwestycji" },
};

// ŹRÓDŁA DANYCH
// Linki, z których pochodzą liczby (albo gdzie je sprawdzić). „szacunek” = wartość przyjęta
// przez autorów prototypu – do weryfikacji na danych miasta.
export const ZRODLA = {
  gusTorun: { nazwa: "GUS – Toruń w liczbach (2024)", url: "https://www.polskawliczbach.pl/Torun" },
  gusMiasto: { nazwa: `GUS – ${MIASTO.nazwa} w liczbach (2024)`, url: MIASTO.gusUrl },
  bdl: { nazwa: "GUS – Bank Danych Lokalnych", url: "https://bdl.stat.gov.pl/" },
  kobize: {
    nazwa: "KOBiZE – wskaźniki emisyjności energii elektrycznej (2025)",
    url: "https://www.kobize.pl/uploads/materialy/materialy_do_pobrania/aktualnosci/2025/142_Wskazniki_emisyjnosci_2025.pdf",
  },
  eea: { nazwa: "EEA – emisje CO₂ nowych samochodów", url: "https://www.eea.europa.eu/en/newsroom/news/new-data-co2-emissions-of-new-cars-and-vans" },
  halasPL: {
    nazwa: "Rozporządzenie ws. dopuszczalnych poziomów hałasu (Dz.U. 2014 poz. 112)",
    url: "https://eli.gov.pl/eli/DU/2014/112/ogl/pol/pdf",
  },
  who: { nazwa: "WHO – Environmental Noise Guidelines for the European Region", url: "https://www.who.int/europe/publications/i/item/9789289053563" },
  halasTorun: { nazwa: "Toruń – program ochrony przed hałasem (konsultacje)", url: "https://www.konsultacje.torun.pl/pl/printpdf/234697" },
  gpr: { nazwa: "GDDKiA – Generalny Pomiar Ruchu 2020/2021", url: "https://www.gov.pl/web/gddkia/generalny-pomiar-ruchu-20202021" },
  akk: {
    nazwa: "GDDKiA – analiza kosztów i korzyści (koszty jednostkowe, Niebieska Księga 2023)",
    url: "https://www.gov.pl/web/gddkia/analiza-kosztow-i-korzysci",
  },
  nkTransport: {
    nazwa: "CUPT – Niebieska Księga: transport publiczny (2023)",
    url: "https://www.cupt.gov.pl/wp-content/uploads/2023/04/upload_nk-transport-publiczny-2023-pl_3154_241.pdf",
  },
  autobusyTorun: { nazwa: "Toruń kupił elektryczne autobusy (Gram w Zielone, 2025)", url: "https://www.gramwzielone.pl/auto-ekologiczne/20306743/torun-kupil-elektryczne-autobusy" },
  tramKrakow: {
    nazwa: "Kraków: linia tramwajowa Łagiewnicka – 1,7 km za 162,6 mln zł",
    url: "https://www.radiokrakow.pl/aktualnosci/krakow/blisko-98-mln-zl-dofinansowania-na-linie-tramwajowa-w-ramach-trasy-lagiewnickiej",
  },
  tramWarszawa: { nazwa: "Rzeczpospolita: koszty budowy linii tramwajowych w Polsce", url: "https://www.rp.pl/biznes/art975011-czy-w-polsce-tramwaje-maja-pod-gorke" },
  pvgis: { nazwa: "PVGIS (Komisja Europejska, JRC) – kalkulator produkcji PV", url: "https://re.jrc.ec.europa.eu/pvg_tools/en/" },
  pvPolska: { nazwa: "Energies 2025 – produkcja PV w Polsce 831–1169 kWh/kWp", url: "https://www.mdpi.com/1996-1073/18/19/5279" },
  wiataPV: {
    nazwa: "Murator – ile kosztuje wiata fotowoltaiczna",
    url: "https://muratordom.pl/instalacje/fotowoltaika/wiata-fotowoltaiczna-daje-cien-i-energie-czy-cie-na-nia-stac-aa-X264-cLin-tUBF.html",
  },
  ladowarki: { nazwa: "Enerad – ile kosztuje stacja ładowania", url: "https://enerad.pl/ile-kosztuje-stacja-ladowania-samochodow-elektrycznych/" },
  bpr: { nazwa: "Funkcja BPR (Bureau of Public Roads, 1964) – opis", url: "https://arxiv.org/pdf/2005.01610" },
  osm: { nazwa: "OpenStreetMap (Overpass API)", url: "https://www.openstreetmap.org/copyright" },
};

// Skąd pochodzi każde założenie: lista źródeł albo „szacunek” (z linkiem, gdzie to sprawdzić)
export const ZRODLA_ZALOZEN = {
  osobNaMieszkanie: { z: ["gusTorun"] },
  podrozyNaOsobe: { z: ["nkTransport"], szacunek: true },
  udzialAuta: { z: ["nkTransport"], szacunek: true },
  udzialAutaBezPrzystanku: { z: ["nkTransport"], szacunek: true },
  udzialKomunikacji: { z: ["nkTransport"], szacunek: true },
  udzialKomunikacjiBezPrzystanku: { z: ["nkTransport"], szacunek: true },
  udzialSzczytu: { z: ["gpr"], szacunek: true },
  pojemnoscAutobusu: { z: [], szacunek: true },
  udzialDzieciSzkolnych: { z: ["bdl"], szacunek: true },
  promienPrzystanku: { z: [], szacunek: true },
  promienSzkoly: { z: [], szacunek: true },
  promienZieleni: { z: [], szacunek: true },
  normaZieleni: { z: [], szacunek: true },
  gestoscMiasta: { z: ["gusMiasto"] },
  mieszkanNaHa: { z: [], szacunek: true },
  kosztInfraNaMieszkanie: { z: [], szacunek: true },
  kosztParkuNaM2: { z: [], szacunek: true },
  kosztZamknieciaNaM: { z: [], szacunek: true },
  udzialObjazdow: { z: [], szacunek: true },
  kosztDrogiNaM: { z: ["akk"], szacunek: true },
  kosztMostu: { z: [], szacunek: true },
  kosztMostuMalego: { z: [], szacunek: true },
  kosztWiaduktu: { z: [], szacunek: true },
  udzialPrzejetegoRuchu: { z: [], szacunek: true },
  m2NaMiejsce: { z: [], szacunek: true },
  kosztMiejscaParkingowego: { z: [], szacunek: true },
  rotacjaPR: { z: [], szacunek: true },
  dystansPRdoCentrum: { z: ["osm"], szacunek: true },
  kosztLadowarki: { z: ["ladowarki"], szacunek: true },
  energiaLadowarki: { z: [], szacunek: true },
  marzaLadowania: { z: [], szacunek: true },
  kWpNaM2: { z: ["wiataPV"], szacunek: true },
  uzyskPV: { z: ["pvgis", "pvPolska"] },
  kosztPV: { z: ["wiataPV"], szacunek: true },
  cenaEnergii: { z: [], szacunek: true },
  co2Sieci: { z: ["kobize"] },
  co2Auta: { z: ["eea"], szacunek: true },
  kosztTramwajuNaKm: { z: ["tramKrakow", "tramWarszawa"] },
  kosztWozokmTram: { z: ["nkTransport"], szacunek: true },
  kosztWozokmBus: { z: ["nkTransport"], szacunek: true },
  kosztAutobusu: { z: ["autobusyTorun"] },
  promienTramwaju: { z: [], szacunek: true },
  odstepPrzystankow: { z: [], szacunek: true },
  przejecieAut: { z: ["nkTransport"], szacunek: true },
  predkoscKomunikacji: { z: [], szacunek: true },
  godzinKursowania: { z: [], szacunek: true },
  wzrostRuchu: { z: ["gpr"] },
  wartoscCzasu: { z: ["akk"], szacunek: true },
  progHalasu: { z: ["halasPL"] },
  progWHO: { z: ["who"] },
  stopaDyskonta: { z: ["akk"] },
  horyzontAnalizy: { z: ["akk"], szacunek: true },
};

// Źródła modelu ruchu i hałasu (poza tabelą założeń)
export const ZRODLA_MODELU = [
  { temat: "Sieć dróg, linie, przystanki, parkingi, strefy, szpitale", z: ["osm"] },
  { temat: "Natężenie ruchu wg klasy drogi (do kalibracji)", z: ["gpr"], szacunek: true },
  { temat: "Czas przejazdu i zakorkowanie (krzywa BPR)", z: ["bpr"] },
  { temat: "Hałas: normy i zalecenia", z: ["halasPL", "who", ...(MIASTO.id === "torun" ? ["halasTorun"] : [])] },
  { temat: "Koszty i korzyści (wartość czasu, dyskonto)", z: ["akk", "nkTransport"] },
  { temat: "Redukcja CO₂ (energia, auta)", z: ["kobize", "eea"] },
];

// Wartości założeń mogą być nadpisane przez użytkownika (panel „Założenia modelu”)
let nadpisane = {};
export function ustawZalozenia(o) {
  nadpisane = o || {};
}

// Natężenie ruchu wg klasy ulicy (pojazdy na dobę) – orientacyjne
export const KLASY_ULIC = {
  lokalna: { label: "Lokalna", natezenie: 2000 },
  zbiorcza: { label: "Zbiorcza", natezenie: 8000 },
  glowna: { label: "Główna", natezenie: 20000 },
};

// Typy inwestycji dostępne w prototypie (ikona = nazwa symbolu Material Symbols Sharp)
export const TYPY = {
  osiedle: {
    label: "Nowe osiedle",
    krotko: "Osiedle",
    ikona: "apartment",
    rysuj: "Polygon",
    kolor: "#d9480f",
    domyslne: { mieszkania: 400, zielenProc: 20 },
  },
  park: {
    label: "Nowy park",
    krotko: "Park",
    ikona: "park",
    rysuj: "Polygon",
    kolor: "#2b8a3e",
    domyslne: {},
  },
  zamkniecie: {
    label: "Zamknięcie ulicy",
    krotko: "Zamknięcie ulicy",
    ikona: "remove_road",
    rysuj: "Line",
    kolor: "#c92a2a",
    poUlicach: true, // zamknięcie dotyczy istniejącej ulicy – trasa przykleja się do sieci
    domyslne: { klasa: "zbiorcza" },
  },
  droga: {
    label: "Nowa droga",
    krotko: "Droga",
    ikona: "add_road",
    rysuj: "Line",
    kolor: "#6741d9",
    domyslne: { klasa: "zbiorcza" },
  },
  parking: {
    label: "Parking / Park & Ride",
    krotko: "Parking / P&R",
    ikona: "local_parking",
    rysuj: "Polygon",
    kolor: "#0c8599",
    domyslne: { parkRide: false, ladowarki: 0, pvProc: 0, miejsca: null },
  },
  tramwaj: {
    label: "Nowa linia tramwajowa",
    krotko: "Linia tramwajowa",
    ikona: "tram",
    rysuj: "Line",
    kolor: "#e03131",
    domyslne: { czestotliwosc: 10, przystankiTryb: "auto" },
  },
  autobus: {
    label: "Nowa linia autobusowa",
    krotko: "Linia autobusowa",
    ikona: "directions_bus",
    rysuj: "Line",
    kolor: "#f08c00",
    poUlicach: true, // autobus jeździ po istniejących ulicach; tramwaj i nowa droga mają własny przebieg
    domyslne: { czestotliwosc: 15, elektryczny: true, przystankiTryb: "auto" },
  },
};


export const z = (klucz) => nadpisane[klucz] ?? ZALOZENIA[klucz].v;
