// DANE Z OFICJALNYCH ŹRÓDEŁ
// 1) GIOŚ – Państwowy Monitoring Środowiska (API https://api.gios.gov.pl/pjp-api):
//    bieżący indeks jakości powietrza i roczne statystyki stężeń ze stacji w wybranym mieście.
//    API nie zezwala na zapytania z innych domen (CORS), więc idziemy przez pośrednika
//    Vite „/gios” (vite.config.js – działa w `npm run dev` i `npm run preview`).
// 2) Wartości referencyjne z publikacji urzędowych (GUS, urząd miasta, normy).
import { MIASTO, PREFIKS } from "./miasta.js";

const GIOS = "/gios/v1/rest";

export const STACJE_GIOS = MIASTO.stacjeGios;

export const ZRODLA_OFICJALNE = {
  gios: { nazwa: "GIOŚ – Państwowy Monitoring Środowiska, API jakości powietrza", url: "https://api.gios.gov.pl/pjp-api/swagger-ui/" },
  giosMapa: { nazwa: "GIOŚ – portal Jakość Powietrza", url: "https://powietrze.gios.gov.pl/pjp/current" },
  gus: { nazwa: "GUS – Bank Danych Lokalnych", url: "https://bdl.stat.gov.pl/" },
  gusMiasto: { nazwa: `${MIASTO.nazwa} w liczbach (dane GUS)`, url: MIASTO.gusUrl },
  ...(MIASTO.halas ? { halasMiasto: MIASTO.halas.zrodlo } : {}),
  dyrektywa: { nazwa: "Dyrektywa 2008/50/WE w sprawie jakości powietrza (EUR-Lex)", url: "https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32008L0050" },
  who2021: { nazwa: "WHO Global Air Quality Guidelines (2021)", url: "https://www.who.int/publications/i/item/9789240034228" },
  gpr: { nazwa: "GDDKiA – Generalny Pomiar Ruchu 2020/2021", url: "https://www.gov.pl/web/gddkia/generalny-pomiar-ruchu-20202021" },
};

// Wartości z publikacji – każda z datą i źródłem
export const REFERENCYJNE = [
  { id: "ludnosc", etykieta: `Ludność ${MIASTO.dopelniacz}`, wartosc: MIASTO.ludnosc, format: "int", jedn: "os.", stan: MIASTO.stanGus, zrodlo: "gusMiasto" },
  { id: "powierzchnia", etykieta: "Powierzchnia miasta", wartosc: MIASTO.powierzchnia, format: "1", jedn: "km²", stan: "2024", zrodlo: "gus" },
  ...(MIASTO.halas
    ? [
        { id: "halasDrogowy", etykieta: "Mieszkańcy narażeni na ponadnormatywny hałas drogowy (LDWN)", wartosc: MIASTO.halas.drogowy, format: "1", jedn: "%", stan: MIASTO.halas.stan, zrodlo: "halasMiasto" },
        { id: "halasNoc", etykieta: "Mieszkańcy narażeni na ponadnormatywny hałas drogowy nocą (LN)", wartosc: MIASTO.halas.noc, format: "1", jedn: "%", stan: MIASTO.halas.stan, zrodlo: "halasMiasto" },
      ]
    : []),
];

// Normy i zalecenia dla średniej rocznej (µg/m³)
export const NORMY_POWIETRZA = {
  PM10: { norma: 40, who: 15 },
  NO2: { norma: 40, who: 10 },
};

// Pamięć podręczna: API GIOŚ ogranicza liczbę zapytań (HTTP 429)
const KLUCZ = PREFIKS + "gios:";
function zPamieci(k, ms) {
  try {
    const v = JSON.parse(localStorage.getItem(KLUCZ + k));
    return v && Date.now() - v.t < ms ? v.d : null;
  } catch {
    return null;
  }
}
function doPamieci(k, d) {
  try {
    localStorage.setItem(KLUCZ + k, JSON.stringify({ t: Date.now(), d }));
  } catch {
    /* brak miejsca */
  }
}
// to samo zapytanie w toku – jedna obietnica (React StrictMode wywołuje efekty dwa razy)
const wToku = new Map();
const raz = (k, fn) => {
  if (!wToku.has(k)) wToku.set(k, fn().finally(() => wToku.delete(k)));
  return wToku.get(k);
};

async function pobierz(sciezka, sygnal) {
  // API zwraca application/ld+json i odrzuca samo „application/json” (HTTP 406)
  const res = await fetch(GIOS + sciezka, { signal: sygnal, headers: { Accept: "application/ld+json, */*;q=0.8" } });
  if (!res.ok) throw new Error(`GIOŚ: HTTP ${res.status}`);
  return res.json();
}

// Bieżący indeks jakości powietrza dla stacji w mieście
export async function indeksyPowietrza(sygnal, wymus = false) {
  const zap = !wymus && zPamieci("indeksy", 15 * 60e3);
  if (zap) return zap;
  return raz("indeksy", () => indeksyZApi(sygnal));
}
async function indeksyZApi(sygnal) {
  const wyniki = await Promise.all(
    STACJE_GIOS.map(async (s) => {
      try {
        const j = await pobierz(`/aqindex/getIndex/${s.id}`, sygnal);
        const a = j.AqIndex || {};
        return {
          ...s,
          wartosc: a["Wartość indeksu"],
          kategoria: a["Nazwa kategorii indeksu"] || "brak indeksu",
          data: a["Data danych źródłowych, z których policzono wartość indeksu dla wskaźnika st"] || a["Data wykonania obliczeń indeksu"],
          pm10: a["Nazwa kategorii indeksu dla wskażnika PM10"],
          no2: a["Nazwa kategorii indeksu dla wskażnika NO2"],
        };
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return { ...s, blad: true };
      }
    })
  );
  if (wyniki.every((w) => w.blad)) throw new Error("GIOŚ niedostępny");
  if (!wyniki.some((w) => w.blad)) doPamieci("indeksy", wyniki);
  return wyniki;
}

// Średnie roczne stężenia: średnia ze stacji w mieście dla każdego roku (od 2015)
export async function statystykiRoczne(sygnal) {
  const zap = zPamieci("statystyki", 7 * 864e5);
  if (zap) return zap;
  return raz("statystyki", () => statystykiZApi(sygnal));
}
async function statystykiZApi(sygnal) {
  const out = {};
  for (const wsk of ["PM10", "NO2"]) {
    const q = new URLSearchParams({ "filter[wojewodztwo]": MIASTO.wojewodztwo, size: "500", indicator: wsk });
    const j = await pobierz(`/statistics/getStatisticsForPollutants?${q}`, sygnal);
    const lista = (j["Lista statystyk"] || []).filter((x) => String(x["Kod stacji"]).startsWith(MIASTO.prefiksGios) && x["Rok"] >= 2015);
    const lata = {};
    for (const x of lista) {
      // jedna wartość na stację i rok: wolimy pomiar 24-godzinny (referencyjny), inaczej 1-godzinny
      const k = `${x["Rok"]}|${x["Kod stacji"]}`;
      const prio = x["Czas uśredniania"] === "24g" ? 2 : 1;
      const v = +x["Średnia [µg/m3]"];
      if (!Number.isFinite(v)) continue;
      if (!lata[k] || lata[k].prio < prio) lata[k] = { rok: x["Rok"], stacja: x["Kod stacji"], v, prio, dni: x["L>50 (S24)"] };
    }
    const poRoku = {};
    for (const e of Object.values(lata)) (poRoku[e.rok] ??= []).push(e);
    out[wsk] = Object.entries(poRoku)
      .map(([rok, e]) => ({
        rok: +rok,
        srednia: e.reduce((a, b) => a + b.v, 0) / e.length,
        maks: Math.max(...e.map((x) => x.v)),
        dni50: wsk === "PM10" ? Math.max(...e.map((x) => +x.dni || 0)) : null,
        stacje: e.length,
      }))
      .sort((a, b) => a.rok - b.rok);
  }
  doPamieci("statystyki", out);
  return out;
}
