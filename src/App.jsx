import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ResultsPanel from "./components/ResultsPanel.jsx";
import InvestMenu from "./components/InvestMenu.jsx";
import CompareModal from "./components/CompareModal.jsx";
import Ikona from "./components/Ikona.jsx";
import { useDaneOficjalne } from "./components/OfficialPanel.jsx";
import { LAYERS } from "./data/queries.js";
import TrafficPanel from "./components/TrafficPanel.jsx";
import Uchwyt from "./components/Uchwyt.jsx";
import { loadLayer, prefetchStatic, clipToBoundary, pickCityBoundary, attachLinesToStops } from "./data/loadData.js";
import { TORUN_BOUNDARY_FALLBACK } from "./data/torunBoundary.js";
import { MIASTA, MIASTO, PREFIKS, zmienMiasto } from "./data/miasta.js";
import { budynkiNaTrasach } from "./data/buildings.js";
import { TYPY, ustawZalozenia } from "./model/config.js";
import { simulateInvestment, simulateVariant, kontekstRuchu } from "./model/simulate.js";
import { proponujLaczniki, proponujDojazdy, przecinaRzeke } from "./model/roads.js";
import { proponujParkRide, analizaStref } from "./model/zones.js";
import { stanGodziny, zakorkowanieWLatach } from "./model/traffic.js";
import { siecDrogowa, trasaPoSieci } from "./model/network.js";
import { wyznaczPrzystanki, przystanekNaTrasie } from "./model/stops.js";
import { liczWWatku } from "./model/watek.js";
import * as turf from "@turf/turf";

// warianty i założenia są osobne dla każdego miasta
const STORAGE_KEY = PREFIKS + "warianty";
const ZAL_KEY = PREFIKS + "zalozenia";
const MOTYW_KEY = "torun2036:motyw";
const BANER_KEY = "torun2036:baner-ukryty";

const PUSTE_WARIANTY = {
  A: { nazwa: "Wariant A", investments: [] },
  B: { nazwa: "Wariant B", investments: [] },
  C: { nazwa: "Wariant C", investments: [] },
};

function wczytajWarianty() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : PUSTE_WARIANTY;
  } catch {
    return PUSTE_WARIANTY;
  }
}

// Zapasowa granica dla miast bez wbudowanego obrysu: prostokąt obszaru danych
function granicaZBbox() {
  const [s, w, n, e] = MIASTO.bbox;
  return turf.featureCollection([turf.bboxPolygon([w, s, e, n], { properties: { name: MIASTO.nazwa, zrodlo: "prostokąt (zapas)" } })]);
}

function wczytajZalozenia() {
  try {
    return JSON.parse(localStorage.getItem(ZAL_KEY)) || {};
  } catch {
    return {};
  }
}

// Zwinięte boczne panele (żeby powiększyć mapę) – pamiętane w przeglądarce
const PANELE_KEY = "torun2036:panele";
const DOMYSLNE_PANELE = { lewy: false, prawy: false, szerLewy: 300, szerPrawy: 370 };
const zakres = (v, min, max) => Math.max(min, Math.min(max, v));
function wczytajPanele() {
  try {
    return { ...DOMYSLNE_PANELE, ...JSON.parse(localStorage.getItem(PANELE_KEY)) };
  } catch {
    return DOMYSLNE_PANELE;
  }
}
const zapisz = (k, v) => {
  try {
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  } catch {
    /* zapis niedostępny – działamy bez niego */
  }
};

let licznik = Date.now();
const noweId = () => "inv" + (licznik++).toString(36);

const jakoFeature = (g) => (g.type === "Feature" ? g : turf.feature(g));
const coordsLinii = (g) => (g.geometry || g).coordinates;

// Strefa 500 m wokół inwestycji – liczona raz dla danej geometrii (zmiana parametrów jej nie przelicza)
const bufory = new WeakMap();
function buforInwestycji(g) {
  if (!bufory.has(g)) {
    const b = turf.buffer(jakoFeature(g), 0.5, { units: "kilometers" });
    bufory.set(g, b ? { b, bbox: turf.bbox(b) } : null);
  }
  return bufory.get(g);
}

// Czy wielokąt nachodzi na któreś z osiedli (powierzchnia wspólna > 1 m²)
function kolizjaOsiedli(geometria, osiedla) {
  for (const o of osiedla) {
    try {
      const [a, b, c, d] = turf.bbox(o.geometry);
      const [e, f, g, h] = turf.bbox(geometria);
      if (g < a || e > c || h < b || f > d) continue;
      const czesc = turf.intersect(turf.featureCollection([jakoFeature(geometria), jakoFeature(o.geometry)]));
      if (czesc && turf.area(czesc) > 1) return o;
    } catch {
      /* uszkodzona geometria */
    }
  }
  return null;
}

export default function App() {
  // ---------- motyw ----------
  const [motyw, setMotyw] = useState(() => document.documentElement.dataset.theme || "light");
  useEffect(() => {
    document.documentElement.dataset.theme = motyw;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", motyw === "dark" ? "#171b21" : "#ffffff");
    zapisz(MOTYW_KEY, motyw);
  }, [motyw]);

  // ---------- ostrzeżenie o danych testowych (można zamknąć; pamiętane w przeglądarce) ----------
  const [ukryjBaner, setUkryjBaner] = useState(() => {
    try {
      return localStorage.getItem(BANER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const zamknijBaner = () => {
    setUkryjBaner(true);
    zapisz(BANER_KEY, "1");
  };

  // ---------- komunikaty ----------
  const [komunikat, setKomunikat] = useState(null);
  const timer = useRef(null);
  const pokaz = useCallback((tekst, typ = "info") => {
    clearTimeout(timer.current);
    setKomunikat({ tekst, typ });
    timer.current = setTimeout(() => setKomunikat(null), 6000);
  }, []);

  // ---------- dane OSM ----------
  const [raw, setData] = useState({});
  const [status, setStatus] = useState({});

  const loadAll = useCallback(async (force = false) => {
    const onRetry = (name) => (n) => setStatus((s) => ({ ...s, [name]: `ponawiam (${n})` }));
    const warstwy = ["stops", "lines", "schools", "parks", "roads", "streets", "residential", "rivers", "zones", "parkings", "chargers", "hospitals"];
    if (!force) prefetchStatic(["boundary", ...warstwy]);
    setStatus((s) => ({ ...s, boundary: "ładowanie" }));
    let boundary = null;
    try {
      const r = await loadLayer("boundary", { force, onRetry: onRetry("boundary") });
      boundary = pickCityBoundary(r.data);
      setStatus((s) => ({ ...s, boundary: r.source }));
    } catch {
      boundary = MIASTO.id === "torun" ? TORUN_BOUNDARY_FALLBACK : granicaZBbox();
      setStatus((s) => ({ ...s, boundary: "wbudowana" }));
    }
    // Warstwy z plików wczytują się w ułamku sekundy, więc oddajemy je do Reacta RAZEM
    // (każde osobne setData przeliczało cały model ruchu i propozycje – kilkanaście razy
    // przy starcie). Osobno tylko warstwy z wolnego Overpass, żeby widać było postęp.
    let bufor = { boundary };
    const oddaj = () => {
      const b = bufor;
      bufor = {};
      if (Object.keys(b).length) setData((d) => ({ ...d, ...b }));
    };
    const bezPrzyciecia = ["roads", "streets", "rivers", "lines", "residential"];
    setStatus((s) => ({ ...s, ...Object.fromEntries(warstwy.map((n) => [n, "ładowanie"])) }));
    for (const name of warstwy) {
      try {
        const r = await loadLayer(name, { force, onRetry: onRetry(name) });
        let clipped = bezPrzyciecia.includes(name) ? r.data : clipToBoundary(r.data, boundary);
        if (name === "zones") clipped = { ...clipped, features: clipped.features.filter((f) => turf.area(f) >= 3000) };
        bufor[name] = clipped;
        if (r.source === "Overpass") oddaj();
        setStatus((s) => ({ ...s, [name]: r.source }));
      } catch {
        setStatus((s) => ({ ...s, [name]: "błąd" }));
      }
    }
    oddaj();
  }, []);

  // przystanki z liniami liczone tylko, gdy zmienią się przystanki lub linie (nie przy każdej warstwie)
  const stopsZLiniami = useMemo(() => attachLinesToStops(raw.stops, raw.lines), [raw.stops, raw.lines]);
  const data = useMemo(() => ({ ...raw, stops: stopsZLiniami }), [raw, stopsZLiniami]);
  // modele (sieć ulic, ruch, warianty) liczą się na odroczonych danych: najpierw rysuje się mapa,
  // potem w osobnym przebiegu model – zamiast jednego długiego zamrożenia przy starcie
  const dataModelu = useDeferredValue(data);
  const linesById = useMemo(
    () => Object.fromEntries((raw.lines?.features || []).map((f) => [f.properties.id, f.properties])),
    [raw.lines]
  );

  // ---------- linie: widoczność i podświetlenie ----------
  const [visibleLines, setVisibleLines] = useState(new Set());
  useEffect(() => {
    if (raw.lines) setVisibleLines(new Set(raw.lines.features.filter((f) => !f.properties.nocna).map((f) => f.properties.id)));
  }, [raw.lines]);
  const [hoverLine, setHoverLine] = useState(null);
  const [hoverStopLines, setHoverStopLines] = useState(null);
  const onHoverStop = useCallback((linie) => setHoverStopLines(linie), []);
  const highlightedLines = useMemo(() => new Set(hoverLine ? [hoverLine] : hoverStopLines || []), [hoverLine, hoverStopLines]);

  // ---------- zwijanie i szerokość bocznych paneli ----------
  const [panele, setPanele] = useState(wczytajPanele);
  const zmienPanele = (zmiana) =>
    setPanele((p) => {
      const n = { ...p, ...zmiana };
      zapisz(PANELE_KEY, n);
      return n;
    });
  const przelaczPanel = (strona) => zmienPanele({ [strona]: !panele[strona] });
  const [ciagniecie, setCiagniecie] = useState(false);
  const startSzer = useRef(null);
  const ciagnij = (strona) => ({
    onStart: () => {
      startSzer.current = { lewy: panele.lewy ? 0 : panele.szerLewy, prawy: panele.prawy ? 0 : panele.szerPrawy };
      setCiagniecie(true);
    },
    onRuch: (dx) => {
      const s = startSzer.current;
      if (!s) return;
      zmienPanele(strona === "lewy" ? { lewy: false, szerLewy: zakres(s.lewy + dx, 220, 600) } : { prawy: false, szerPrawy: zakres(s.prawy - dx, 280, 700) });
    },
    onKoniec: () => {
      startSzer.current = null;
      setCiagniecie(false);
    },
  });

  // ---------- ruch ----------
  const [warstwaRuchu, setWarstwaRuchu] = useState("ruch");
  const [godzina, setGodzina] = useState(8);
  const [weekend, setWeekend] = useState(false);
  const [rok, setRok] = useState(2025);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React StrictMode uruchamia efekt 2× w trybie dev
    started.current = true;
    loadAll();
  }, [loadAll]);

  // ---------- opcje mapy ----------
  const [swobodnie, setSwobodnie] = useState(false);
  const [przystankiWidok, setPrzystankiWidok] = useState("wokol");
  const [granica, setGranica] = useState(true);
  const [porownanie, setPorownanie] = useState(false);

  // ---------- warianty i inwestycje ----------
  const [variants, setVariants] = useState(wczytajWarianty);
  const [activeId, setActiveId] = useState("A");
  const [selectedId, setSelectedId] = useState(null);
  const [drawType, setDrawType] = useState(null);
  const [edytowanyId, setEdytowanyId] = useState(null);
  const [ustawianie, setUstawianie] = useState(null); // id linii, do której dodajemy przystanki

  useEffect(() => zapisz(STORAGE_KEY, variants), [variants]);

  const active = variants[activeId];
  const osiedla = active.investments.filter((i) => i.typ === "osiedle");

  const updateActive = (fn) =>
    setVariants((v) => ({ ...v, [activeId]: { ...v[activeId], investments: fn(v[activeId].investments) } }));

  // sieć ulic przygotowujemy, gdy przeglądarka nic nie robi (po starcie), żeby pierwsza trasa była od razu
  useEffect(() => {
    if (!dataModelu.roads || !dataModelu.streets) return;
    const bezczynnie = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const anuluj = window.cancelIdleCallback || clearTimeout;
    const id = bezczynnie(() => siecDrogowa(dataModelu), { timeout: 8000 });
    return () => anuluj(id);
  }, [dataModelu.roads, dataModelu.streets]); // eslint-disable-line react-hooks/exhaustive-deps

  // trasa po istniejących ulicach (albo swobodnie, gdy zasada jest nadpisana).
  // Sieć ulic budowana dopiero przy pierwszej trasie (potem z pamięci) – nie spowalnia startu.
  const poprowadz = useCallback(
    (geometry, wolno) => {
      const siec = wolno ? null : siecDrogowa(data);
      if (wolno || !siec) return { geometry, info: wolno ? null : "Sieć ulic jeszcze się wczytuje – trasa narysowana swobodnie." };
      const { coords, pominiete } = trasaPoSieci(siec, coordsLinii(geometry));
      return {
        geometry: turf.lineString(coords),
        info: pominiete ? `${pominiete} odcinek(ki) trasy nie mają połączenia w sieci ulic – narysowano je prosto.` : null,
      };
    },
    [data]
  );

  const przystankiDla = useCallback(
    (geometry) => wyznaczPrzystanki(geometry, data, { osiedla }).map(({ coords, nazwa, istniejacy }) => ({ coords, nazwa, istniejacy })),
    [data, osiedla]
  );

  const handleCreated = useCallback(
    (geometry) => {
      const typ = drawType;
      if (!typ) return;
      const t = TYPY[typ];
      if (typ === "osiedle") {
        const k = kolizjaOsiedli(geometry, osiedla);
        if (k) {
          pokaz(`Nie można utworzyć osiedla na istniejącym osiedlu („${k.nazwa}”). Na osiedlu możesz dodać drogę lub park.`, "err");
          return;
        }
      }
      let geo = geometry;
      const params = { ...t.domyslne };
      if (t.rysuj === "Line") {
        // po ulicach tylko autobus i zamknięcie; tramwaj i nowa droga biegną tak, jak narysowano
        const r = poprowadz(geometry, swobodnie || !t.poUlicach);
        geo = r.geometry;
        params.swobodnie = swobodnie && !!t.poUlicach;
        if (r.info) pokaz(r.info);
        if (typ === "tramwaj" || typ === "autobus") params.przystanki = przystankiDla(geo);
      }
      const id = noweId();
      setVariants((v) => {
        const n = v[activeId].investments.filter((i) => i.typ === typ).length + 1;
        const inv = { id, typ, nazwa: `${t.label} ${n}`, params, geometry: geo };
        if (typ === "droga") inv.params.most = przecinaRzeke(geo, data.rivers);
        return { ...v, [activeId]: { ...v[activeId], investments: [...v[activeId].investments, inv] } };
      });
      setSelectedId(id);
      setDrawType(null);
    },
    [drawType, activeId, data.rivers, osiedla, swobodnie, poprowadz, przystankiDla, pokaz]
  );

  const cancelDraw = useCallback(() => setDrawType(null), []);
  const startDraw = (typ) => {
    setEdytowanyId(null);
    setUstawianie(null);
    setDrawType(typ);
  };

  const handleUpdate = (id, zmiana) =>
    updateActive((list) => list.map((i) => (i.id === id ? { ...i, ...zmiana, params: { ...i.params, ...(zmiana.params || {}) } } : i)));

  const handleDelete = (id) => {
    updateActive((list) => list.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (edytowanyId === id) setEdytowanyId(null);
    if (ustawianie === id) setUstawianie(null);
  };

  // edycja kształtu: osiedle nie może wejść na inne osiedle
  const handleEdytuj = (id, geometry) => {
    const inv = active.investments.find((i) => i.id === id);
    if (!inv) return false;
    if (inv.typ === "osiedle") {
      const k = kolizjaOsiedli(geometry, osiedla.filter((o) => o.id !== id));
      if (k) {
        pokaz(`Osiedle nie może nachodzić na inne osiedle („${k.nazwa}”). Zmiana cofnięta.`, "err");
        return false;
      }
    }
    handleUpdate(id, { geometry });
    return true;
  };

  const autoPrzystanki = (id) => {
    const inv = active.investments.find((i) => i.id === id);
    if (!inv) return;
    const przystanki = przystankiDla(inv.geometry);
    handleUpdate(id, { params: { przystanki, przystankiTryb: inv.typ === "droga" ? undefined : "auto" } });
    pokaz(`Wyznaczono ${przystanki.length} przystanków.`, "ok");
  };

  const klikMapy = (c) => {
    const inv = active.investments.find((i) => i.id === ustawianie);
    if (!inv) return;
    const s = przystanekNaTrasie(jakoFeature(inv.geometry), c, data);
    const lista = [...(inv.params.przystanki || []).map((p) => ({ ...p, d: p.d ?? turf.nearestPointOnLine(jakoFeature(inv.geometry), turf.point(p.coords), { units: "meters" }).properties.location })), s]
      .sort((a, b) => a.d - b.d);
    handleUpdate(inv.id, { params: { przystanki: lista, przystankiTryb: "reczne" } });
    if (s.uwaga) pokaz(`Przystanek „${s.nazwa}”: ${s.uwaga}.`, "err");
  };

  const usunPrzystanek = (id, idx) => {
    const inv = active.investments.find((i) => i.id === id);
    if (!inv) return;
    handleUpdate(id, { params: { przystanki: inv.params.przystanki.filter((_, i) => i !== idx), przystankiTryb: inv.typ === "droga" ? undefined : "reczne" } });
  };

  const poprowadzPoUlicach = (id) => {
    const inv = active.investments.find((i) => i.id === id);
    if (!inv) return;
    const r = poprowadz(inv.geometry, false);
    const params = { swobodnie: false };
    if ((inv.typ === "tramwaj" || inv.typ === "autobus") && inv.params.przystankiTryb !== "reczne") params.przystanki = przystankiDla(r.geometry);
    handleUpdate(id, { geometry: r.geometry, params });
    pokaz(r.info || "Trasa poprowadzona po istniejących ulicach.", r.info ? "info" : "ok");
  };

  const autobusZDrogi = (id) => {
    const droga = active.investments.find((i) => i.id === id);
    if (!droga) return;
    const nid = noweId();
    updateActive((list) => [
      ...list,
      {
        id: nid,
        typ: "autobus",
        nazwa: `Linia: ${droga.nazwa}`,
        params: { ...TYPY.autobus.domyslne, swobodnie: !!droga.params.swobodnie, przystanki: droga.params.przystanki },
        geometry: droga.geometry,
      },
    ]);
    setSelectedId(nid);
  };

  const copyVariant = (from, to) => {
    if (variants[to].investments.length && !window.confirm(`Zastąpić zawartość wariantu ${to}?`)) return;
    setVariants((v) => ({ ...v, [to]: { ...v[to], investments: v[from].investments.map((i) => ({ ...i, id: noweId() })) } }));
  };

  // ---------- proponowane nowe drogi ----------
  // liczone raz, gdy są już drogi i rzeki (wcześniej przeliczało się przy każdej doczytanej warstwie)
  const rzekiGotowe = !!data.rivers || status.rivers === "błąd";
  // łączniki i P&R liczą się w osobnym wątku – mapa nie zamarza przy starcie
  const [laczniki, setLaczniki] = useState([]);
  useEffect(() => {
    if (!rzekiGotowe || !data.roads) return;
    let aktualne = true;
    const { roads, rivers, boundary } = data;
    liczWWatku("laczniki", { roads, rivers, boundary }, () => proponujLaczniki(roads, rivers, boundary)).then((w) => aktualne && setLaczniki(w));
    return () => {
      aktualne = false;
    };
  }, [rzekiGotowe, data.roads, data.rivers, data.boundary]); // eslint-disable-line react-hooks/exhaustive-deps
  const osiedlaKlucz = JSON.stringify(osiedla.map((i) => [i.id, i.nazwa, i.geometry]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dojazdy = useMemo(() => proponujDojazdy(data.roads, osiedla), [data.roads, osiedlaKlucz]);
  const [parkRide, setParkRide] = useState([]);
  useEffect(() => {
    if (!data.parkings || !data.stops || !data.boundary) return;
    let aktualne = true;
    const dane = { parkings: data.parkings, stops: data.stops, boundary: data.boundary };
    liczWWatku("parkride", dane, () => proponujParkRide(dane)).then((w) => aktualne && setParkRide(w));
    return () => {
      aktualne = false;
    };
  }, [data.parkings, data.stops, data.boundary]); // eslint-disable-line react-hooks/exhaustive-deps
  const propozycje = useMemo(() => [...dojazdy, ...laczniki, ...parkRide], [dojazdy, laczniki, parkRide]);
  const dodanePropozycje = new Set(active.investments.map((i) => i.params?.propozycja).filter(Boolean));

  // kolizje propozycji z budynkami (OSM, na żądanie)
  const [zabudowa, setZabudowa] = useState({ status: "brak" });
  // klucz: tylko propozycje dróg (P&R nie mają przebiegu), zapytanie po ustaniu zmian (warstwy doczytują się kolejno)
  const drogiPropKlucz = propozycje.filter((p) => p.rodzaj !== "parkride").map((p) => p.id).join("|");
  useEffect(() => {
    const drogi = propozycje.filter((p) => p.rodzaj !== "parkride");
    if (!drogi.length) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      setZabudowa((z) => ({ ...z, status: "ladowanie" }));
      budynkiNaTrasach(drogi, ac.signal)
        .then((wynik) => setZabudowa((z) => ({ status: "ok", wynik: { ...z.wynik, ...wynik } })))
        .catch((e) => e.name !== "AbortError" && setZabudowa((z) => ({ ...z, status: "blad" })));
    }, 2500);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [drogiPropKlucz]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProposal = (p) => {
    if (dodanePropozycje.has(p.id)) return;
    if (p.rodzaj === "parkride") return addFromParking(p.parking, { parkRide: true, propozycja: p.id });
    const budynki = zabudowa.wynik?.[p.id];
    if (budynki > 0 && !swobodnie) {
      pokaz(`Propozycja przecina ${budynki} bud. Zaznacz „Nadpisz zasadę: swobodny przebieg” nad mapą, aby ją mimo to dodać.`, "err");
      return;
    }
    const id = noweId();
    const inv = {
      id,
      typ: "droga",
      nazwa: p.nazwa,
      params: { ...TYPY.droga.domyslne, most: p.most, skrot: p.skrot, propozycja: p.id, swobodnie: budynki > 0 },
      geometry: { type: "Feature", properties: {}, geometry: p.geometry.geometry },
    };
    updateActive((list) => [...list, inv]);
    setSelectedId(id);
  };

  // linia autobusowa dowożąca do strefy pracy z najbliższego węzła przesiadkowego (po ulicach)
  const addZoneLine = (s) => {
    const id = noweId();
    const r = poprowadz(turf.lineString([s.wezel.geometry.coordinates, s.srodek]), false);
    const inv = {
      id,
      typ: "autobus",
      nazwa: `Dowóz: ${s.nazwa}`,
      params: { ...TYPY.autobus.domyslne, swobodnie: false, przystanki: przystankiDla(r.geometry) },
      geometry: r.geometry,
    };
    updateActive((list) => [...list, inv]);
    setSelectedId(id);
  };

  // istniejący parking z OSM -> inwestycja (P&R, ładowarki, fotowoltaika)
  const addFromParking = (f, extra = {}) => {
    const id = noweId();
    const miejsca = +f.properties.capacity || 40;
    const bok = Math.sqrt(miejsca * 25) / 1000;
    const geometry = turf.bboxPolygon(turf.bbox(turf.buffer(f, bok / 2, { units: "kilometers" })));
    const inv = {
      id,
      typ: "parking",
      nazwa: `${extra.parkRide ? "P&R" : "Parking"}: ${f.properties.name || "istniejący"}`,
      params: { ...TYPY.parking.domyslne, istniejacy: true, miejsca, ladowarki: extra.parkRide ? 4 : 6, pvProc: 50, ...extra },
      geometry,
    };
    updateActive((list) => [...list, inv]);
    setSelectedId(id);
  };

  // ---------- przystanki widoczne na mapie ----------
  // domyślnie tylko w promieniu 500 m od inwestycji aktywnego wariantu
  const strefaInwestycji = useMemo(() => {
    if (!active.investments.length) return null;
    try {
      return active.investments.map((i) => buforInwestycji(i.geometry)).filter(Boolean);
    } catch {
      return null;
    }
  }, [active.investments]);
  // ten sam zestaw przystanków = ten sam obiekt (warstwa przystanków na mapie się nie przerysowuje)
  const poprzednieStopy = useRef(null);
  const stopsWidoczne = useMemo(() => {
    if (!data.stops) return null;
    let wynik;
    if (przystankiWidok === "wszystkie") wynik = data.stops;
    else if (!strefaInwestycji) wynik = { ...data.stops, features: [] };
    else {
      const bboxy = strefaInwestycji.map((s) => [s.bbox, s.b]);
      wynik = {
        ...data.stops,
        features: data.stops.features.filter((f) => {
          const [x, y] = f.geometry.coordinates;
          return bboxy.some(([[w, s, e, n], strefa]) => x >= w && x <= e && y >= s && y <= n && turf.booleanPointInPolygon(f, strefa));
        }),
      };
    }
    const p = poprzednieStopy.current;
    if (p && p !== wynik && p.features.length === wynik.features.length && p.features.every((f, i) => f === wynik.features[i])) return p;
    poprzednieStopy.current = wynik;
    return wynik;
  }, [data.stops, przystankiWidok, strefaInwestycji]);

  // ---------- przeliczanie ----------
  const [zalozenia, setZalozenia] = useState(wczytajZalozenia);
  const [auto, setAuto] = useState(true);
  useEffect(() => zapisz(ZAL_KEY, zalozenia), [zalozenia]);

  const live = useMemo(() => ({ variants, zalozenia }), [variants, zalozenia]);
  const odroczone = useDeferredValue(live);
  const [zamrozone, setZamrozone] = useState(live);
  const doLiczenia = auto ? odroczone : zamrozone;
  const nieaktualne = !auto && zamrozone !== live;
  const liczy = auto && odroczone !== live;
  const aktualizuj = () => setZamrozone(live);
  const przelaczAuto = (v) => {
    setAuto(v);
    setZamrozone(live);
  };

  const zalKlucz = JSON.stringify(doLiczenia.zalozenia);
  const selected = active.investments.find((i) => i.id === selectedId) || null;
  const selectedCalc = doLiczenia.variants[activeId]?.investments.find((i) => i.id === selectedId) || null;
  const wynikSel = useMemo(() => {
    if (!selectedCalc) return null;
    ustawZalozenia(doLiczenia.zalozenia);
    return simulateInvestment(selectedCalc, dataModelu, zalKlucz);
  }, [selectedCalc, dataModelu, doLiczenia.zalozenia, zalKlucz]);

  const warianty = useMemo(() => {
    ustawZalozenia(doLiczenia.zalozenia);
    const ctx = kontekstRuchu(dataModelu, zalKlucz);
    return Object.entries(doLiczenia.variants).map(([id, v]) => {
      const { wyniki, suma, ruch } = simulateVariant(v, dataModelu, zalKlucz);
      return {
        id,
        nazwa: v.nazwa,
        suma,
        ruch,
        wyniki,
        bazowa: ctx?.bazowa,
        lata: ctx && ruch ? zakorkowanieWLatach(ctx.siec, ctx.bazowa, v.investments.length ? ruch : null) : null,
        liczbaInwestycji: v.investments.length,
      };
    });
  }, [doLiczenia.variants, doLiczenia.zalozenia, dataModelu, zalKlucz]);
  const wariantyZInw = warianty.filter((w) => w.liczbaInwestycji > 0).length;

  const ruchAktywny = warianty.find((w) => w.id === activeId)?.ruch;
  const stanSieci = useMemo(() => {
    if (!ruchAktywny) return null;
    ustawZalozenia(doLiczenia.zalozenia);
    return { ...stanGodziny(ruchAktywny, godzina, { weekend, rok }), lista: ruchAktywny.lista, lden: ruchAktywny.halas.lden };
  }, [ruchAktywny, godzina, weekend, rok, doLiczenia.zalozenia]);
  const strefyAnaliza = useMemo(() => analizaStref(dataModelu, ruchAktywny), [dataModelu, ruchAktywny]);

  // ---------- dane oficjalne i raport ----------
  const [oficjalne, odswiezOficjalne] = useDaneOficjalne();
  const [raport, setRaport] = useState(false);
  const generujPdf = async () => {
    if (!active.investments.length) {
      pokaz("Dodaj co najmniej jedną inwestycję do wariantu, aby wygenerować raport.", "err");
      return;
    }
    setRaport(true);
    try {
      const { generujRaport } = await import("./report/pdf.js");
      const w = warianty.find((x) => x.id === activeId);
      const nazwa = await generujRaport({ data, wariantId: activeId, wariant: active, wyniki: w?.wyniki || [], suma: w?.suma, oficjalne, linesById, warianty });
      pokaz(`Pobrano raport ${nazwa}.`, "ok");
    } catch (e) {
      console.error(e);
      pokaz("Nie udało się wygenerować raportu PDF.", "err");
    } finally {
      setRaport(false);
    }
  };

  const trwa = (s) => s === "ładowanie" || s.startsWith("ponawiam");
  const loading = Object.values(status).some(trwa);
  const bledy = Object.entries(status).filter(([, s]) => s === "błąd");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>
            Inv<span>Geo</span>
          </h1>
          <span className="ver">Prototyp v1.0</span>
          {ukryjBaner && (
            <button className="ver test" onClick={() => { setUkryjBaner(false); zapisz(BANER_KEY, "0"); }} title="Pokaż ostrzeżenie o danych testowych">
              dane testowe
            </button>
          )}
          <span className="sub">Symulator skutków decyzji miejskich</span>
          <label className="miasto-wybor" title="Zmień miasto – mapa, dane OSM (przystanki, linie, drogi, parkingi) i propozycje dróg, linii i P&R przeliczą się od nowa. Warianty są zapisywane osobno dla każdego miasta.">
            <Ikona n="location_city" className="s16" />
            <select value={MIASTO.id} onChange={(e) => zmienMiasto(e.target.value)} aria-label="Miasto">
              {Object.values(MIASTA).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nazwa}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="data-status">
          {loading && (
            <span className="pill">
              <Ikona n="progress_activity" className="s14" />
              Wczytywanie:{" "}
              {Object.entries(status)
                .filter(([, s]) => trwa(s))
                .map(([k, s]) => (s === "ładowanie" ? LAYERS[k].label : `${LAYERS[k].label} (${s})`))
                .join(", ")}
            </span>
          )}
          {bledy.length > 0 && (
            <span className="pill err">
              Nie wczytano: {bledy.map(([k]) => LAYERS[k].label).join(", ")}
              <button className="link" onClick={() => loadAll(true)}>
                ponów
              </button>
            </span>
          )}
          {!loading && bledy.length === 0 && Object.keys(status).length > 0 && (
            <span className="pill ok" title={Object.entries(status).map(([k, s]) => `${LAYERS[k].label}: ${s}`).join("\n")}>
              <Ikona n="database" className="s14" />
              OSM: {data.stops?.features.length ?? 0} przystanków · {data.lines?.features.length ?? 0} linii ·{" "}
              {data.zones?.features.length ?? 0} stref pracy
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={generujPdf} disabled={raport} title="Pobierz raport aktywnego wariantu w PDF">
            <Ikona n={raport ? "progress_activity" : "picture_as_pdf"} /> {raport ? "Generowanie…" : `Raport PDF (${activeId})`}
          </button>
          <button
            className="icon-btn"
            onClick={() => setMotyw(motyw === "dark" ? "light" : "dark")}
            title={motyw === "dark" ? "Tryb jasny" : "Tryb ciemny"}
            aria-label="Przełącz tryb ciemny"
          >
            <Ikona n={motyw === "dark" ? "light_mode" : "dark_mode"} />
          </button>
        </div>
      </header>

      {!ukryjBaner && (
        <div className="banner" role="note">
          <Ikona n="warning" fill className="s16" />
          <span className="grow" title="Wyniki pochodzą z uproszczonego modelu prototypu, danych OpenStreetMap i szacunkowych założeń – nie należy ich używać do analiz inwestycji ani podejmowania decyzji. Wyjątkiem są oznaczone pomiary GIOŚ w panelu „Dane z oficjalnych źródeł”.">
            <b>Dane testowe</b> – wyniki modelu prototypu (OSM i szacunki), nie dane oficjalne. Nie używać do decyzji; wyjątek: pomiary GIOŚ.
          </span>
          <button className="banner-close" onClick={zamknijBaner} aria-label="Zamknij ostrzeżenie" title="Zamknij">
            <Ikona n="close" className="s16" />
          </button>
        </div>
      )}

      <main
        className={`${panele.lewy ? "bez-lewego" : ""} ${panele.prawy ? "bez-prawego" : ""} ${ciagniecie ? "ciagniecie" : ""}`}
        style={{ "--szer-lewy": `${panele.szerLewy}px`, "--szer-prawy": `${panele.szerPrawy}px` }}
      >
        <Sidebar
          variants={variants}
          activeId={activeId}
          onActivate={(id) => {
            setActiveId(id);
            setSelectedId(null);
            setDrawType(null);
            setEdytowanyId(null);
            setUstawianie(null);
          }}
          onRenameVariant={(id, nazwa) => setVariants((v) => ({ ...v, [id]: { ...v[id], nazwa } }))}
          onCopyVariant={copyVariant}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id !== edytowanyId) setEdytowanyId(null);
          }}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          edytowanyId={edytowanyId}
          onEdit={(id) => {
            setDrawType(null);
            setUstawianie(null);
            setEdytowanyId(id);
          }}
          ustawianie={ustawianie}
          onPlaceStops={(id) => {
            setDrawType(null);
            setEdytowanyId(null);
            setUstawianie(id);
          }}
          onAutoStops={autoPrzystanki}
          onRemoveStop={usunPrzystanek}
          onRouteOnRoads={poprowadzPoUlicach}
          onBusFromRoad={autobusZDrogi}
          propozycje={propozycje}
          dodanePropozycje={dodanePropozycje}
          onAddProposal={addProposal}
          drogiWczytane={!!data.roads}
          zabudowa={zabudowa}
          lines={data.lines}
          visibleLines={visibleLines}
          setVisibleLines={setVisibleLines}
          onHoverLine={setHoverLine}
          strefy={strefyAnaliza}
          onZoneLine={addZoneLine}
        />
        <div className="center">
          <InvestMenu
            drawType={drawType}
            onStartDraw={startDraw}
            onCancelDraw={cancelDraw}
            swobodnie={swobodnie}
            onSwobodnie={setSwobodnie}
            przystankiWidok={przystankiWidok}
            onPrzystankiWidok={setPrzystankiWidok}
            granica={granica}
            onGranica={setGranica}
            ustawianie={active.investments.find((i) => i.id === ustawianie)?.nazwa}
            onKoniecUstawiania={() => setUstawianie(null)}
          />
          <div className={drawType ? "map-wrap drawing" : ustawianie ? "map-wrap placing" : "map-wrap"}>
            <Uchwyt className="krawedz-lewa" title="Przeciągnij, aby zmienić szerokość lewego panelu" {...ciagnij("lewy")} />
            <Uchwyt className="krawedz-prawa" title="Przeciągnij, aby zmienić szerokość prawego panelu" {...ciagnij("prawy")} />
            <button className="panel-toggle lewy" onClick={() => przelaczPanel("lewy")} aria-expanded={!panele.lewy} title={panele.lewy ? "Pokaż lewy panel" : "Zwiń lewy panel"}>
              <Ikona n={panele.lewy ? "chevron_right" : "chevron_left"} />
            </button>
            <button className="panel-toggle prawy" onClick={() => przelaczPanel("prawy")} aria-expanded={!panele.prawy} title={panele.prawy ? "Pokaż prawy panel" : "Zwiń prawy panel"}>
              <Ikona n={panele.prawy ? "chevron_left" : "chevron_right"} />
            </button>
            {komunikat && (
              <div className={`toast ${komunikat.typ}`} role="status">
                <Ikona n={komunikat.typ === "err" ? "error" : komunikat.typ === "ok" ? "check_circle" : "info"} />
                <span className="grow">{komunikat.tekst}</span>
                <button onClick={() => setKomunikat(null)} aria-label="Zamknij">
                  <Ikona n="close" className="s16" />
                </button>
              </div>
            )}
            <MapView
              data={data}
              investments={active.investments}
              selectedId={selectedId}
              onSelect={setSelectedId}
              wynik={wynikSel}
              drawType={drawType}
              onCreated={handleCreated}
              onCancelDraw={cancelDraw}
              propozycje={propozycje}
              dodanePropozycje={dodanePropozycje}
              onAddProposal={addProposal}
              onAddFromParking={addFromParking}
              visibleLines={visibleLines}
              highlightedLines={highlightedLines}
              linesById={linesById}
              onHoverLine={setHoverLine}
              onHoverStop={onHoverStop}
              warstwaRuchu={warstwaRuchu}
              stanSieci={stanSieci}
              granica={granica}
              stops={stopsWidoczne}
              swobodnie={swobodnie}
              zabudowa={zabudowa.wynik}
              edytowanyId={edytowanyId}
              onEdytuj={handleEdytuj}
              ustawianie={ustawianie}
              onKlikMapy={klikMapy}
              onUsunPrzystanek={usunPrzystanek}
            />
            {wariantyZInw >= 2 && (
              <button className="fab-compare" onClick={() => setPorownanie(true)}>
                <Ikona n="compare_arrows" /> Porównaj warianty <span className="count">{wariantyZInw}</span>
              </button>
            )}
          </div>
          <TrafficPanel
            warianty={warianty}
            activeId={activeId}
            warstwa={warstwaRuchu}
            onWarstwa={setWarstwaRuchu}
            godzina={godzina}
            onGodzina={setGodzina}
            weekend={weekend}
            onWeekend={setWeekend}
            rok={rok}
            onRok={setRok}
            stanSieci={stanSieci}
          />
        </div>
        <ResultsPanel
          selected={selected}
          wynikSel={wynikSel}
          zalozenia={zalozenia}
          onZalozenia={setZalozenia}
          auto={auto}
          onAuto={przelaczAuto}
          onAktualizuj={aktualizuj}
          nieaktualne={nieaktualne}
          liczy={liczy}
          oficjalne={oficjalne}
          onOdswiezOficjalne={odswiezOficjalne}
          modelNarazeni={warianty.find((w) => w.id === activeId)?.bazowa?.halas?.narazeni}
        />
      </main>

      {porownanie && wariantyZInw >= 2 && <CompareModal warianty={warianty} activeId={activeId} onClose={() => setPorownanie(false)} />}
    </div>
  );
}
