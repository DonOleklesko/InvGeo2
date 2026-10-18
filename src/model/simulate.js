// SILNIK SYMULACJI
// Dla każdej inwestycji liczy skutki prostymi, jawnymi wzorami.
import { MIASTO } from "../data/miasta.js";
import * as turf from "@turf/turf";
import { z, KLASY_ULIC } from "./config.js";
import {
  zbudujSiec, analizaRuchu, halasPrzy, miejscaParkingu, statystykiLinii,
} from "./traffic.js";

const km = (m) => m / 1000;

function buffer(feature, metry) {
  try {
    return turf.buffer(feature, km(metry), { units: "kilometers" });
  } catch {
    return null;
  }
}

function pointsWithin(points, area) {
  if (!points?.features?.length || !area) return [];
  return points.features.filter((p) => {
    try {
      return turf.booleanPointInPolygon(p, area);
    } catch {
      return false;
    }
  });
}

// Powierzchnia parków (m²) wewnątrz danego obszaru
function parkAreaWithin(parks, area) {
  if (!parks?.features?.length || !area) return 0;
  const [aw, as, ae, an] = turf.bbox(area);
  let sum = 0;
  for (const park of parks.features) {
    try {
      // szybkie odrzucenie parków, które nawet prostokątem nie dotykają obszaru
      const [pw, ps, pe, pn] = park.bbox || (park.bbox = turf.bbox(park));
      if (pe < aw || pw > ae || pn < as || ps > an) continue;
      const part = turf.intersect(turf.featureCollection([park, area]));
      if (part) sum += turf.area(part);
    } catch {
      /* uszkodzona geometria – pomijamy */
    }
  }
  return sum;
}

// ---------- OSIEDLE ----------
function simOsiedle(inv, data, ctx) {
  const { mieszkania, zielenProc } = inv.params;
  const pow = turf.area(inv.geometry);
  const mieszkancy = mieszkania * z("osobNaMieszkanie");

  const strefaPrzyst = buffer(inv.geometry, z("promienPrzystanku"));
  const strefaSzkol = buffer(inv.geometry, z("promienSzkoly"));
  const strefaZiel = buffer(inv.geometry, z("promienZieleni"));

  const przystanki = pointsWithin(data.stops, strefaPrzyst);
  const szkoly = pointsWithin(data.schools, strefaSzkol);
  const parkiObok = parkAreaWithin(data.parks, strefaZiel);
  const maPrzystanek = przystanki.length > 0;
  // linie zatrzymujące się na przystankach w zasięgu
  const linie = [...new Set(przystanki.flatMap((p) => p.properties.linie || []))];
  const linieTram = linie.filter((id) => id.startsWith("tram:")).length;
  // strefy pracy w okolicy i sąsiedztwo przemysłu
  const strefaPracy = buffer(inv.geometry, 2000);
  const strefaKonfliktu = buffer(inv.geometry, 150);
  let haPracy = 0;
  let przemyslObok = 0;
  for (const f of data.zones?.features || []) {
    try {
      const c = turf.centroid(f);
      if (turf.booleanPointInPolygon(c, strefaPracy)) haPracy += turf.area(f) / 1e4;
      if (f.properties.rodzaj === "przemyslowa" && turf.booleanIntersects(f, strefaKonfliktu)) przemyslObok++;
    } catch {
      /* pomijamy */
    }
  }
  const halas = ctx?.bazowa ? halasPrzy(ctx.bazowa, inv.geometry) : null;
  // najbliższy szpital (w linii prostej od środka osiedla)
  let szpital = null;
  try {
    const srodek = turf.centroid(inv.geometry);
    for (const h of data.hospitals?.features || []) {
      const d = turf.distance(srodek, h, { units: "kilometers" });
      if (!szpital || d < szpital.d) szpital = { d, nazwa: h.properties.name || "szpital" };
    }
  } catch {
    /* pomijamy */
  }

  const podroze = mieszkancy * z("podrozyNaOsobe");
  const udzAuto = maPrzystanek ? z("udzialAuta") : z("udzialAutaBezPrzystanku");
  const udzKom = maPrzystanek ? z("udzialKomunikacji") : z("udzialKomunikacjiBezPrzystanku");
  const autaSzczyt = podroze * udzAuto * z("udzialSzczytu");
  const pasazerowieSzczyt = podroze * udzKom * z("udzialSzczytu");
  const autobusy = pasazerowieSzczyt / z("pojemnoscAutobusu");
  const dzieci = mieszkancy * z("udzialDzieciSzkolnych");
  const zielenWlasna = pow * (zielenProc / 100);
  const zielenNaOs = mieszkancy > 0 ? zielenWlasna / mieszkancy : 0;
  const gestosc = pow > 0 ? mieszkania / (pow / 10000) : 0;

  const kompromisy = [];
  if (!maPrzystanek)
    kompromisy.push({ typ: "minus", tekst: `Brak przystanku w ${z("promienPrzystanku")} m – więcej podróży autem (${Math.round(udzAuto * 100)}% zamiast ${Math.round(z("udzialAuta") * 100)}%).` });
  else
    kompromisy.push({
      typ: "plus",
      tekst: `${przystanki.length} przystanków w zasięgu ${z("promienPrzystanku")} m` +
        (linie.length ? `, ${linie.length} linii (w tym ${linieTram} tramwajowych).` : "."),
    });
  if (maPrzystanek && linie.length === 1)
    kompromisy.push({ typ: "uwaga", tekst: "Tylko jedna linia w zasięgu – mała odporność na zmiany rozkładu." });
  if (halas && halas.max > z("progHalasu"))
    kompromisy.push({ typ: "minus", tekst: `Hałas drogowy do ${Math.round(halas.max)} dB (${halas.zrodlo || "droga główna"}) – powyżej normy ${z("progHalasu")} dB; potrzebne ekrany lub odsunięcie zabudowy.` });
  else if (halas && halas.max > z("progWHO"))
    kompromisy.push({ typ: "uwaga", tekst: `Hałas drogowy ok. ${Math.round(halas.max)} dB – w normie, ale powyżej zalecenia WHO (${z("progWHO")} dB).` });
  if (przemyslObok)
    kompromisy.push({ typ: "minus", tekst: `Osiedle graniczy ze strefą przemysłową (${przemyslObok}) – ryzyko hałasu, zapachów i ruchu ciężarówek.` });
  if (szpital && szpital.d > 5)
    kompromisy.push({ typ: "uwaga", tekst: `Daleko do szpitala: ${szpital.d.toFixed(1)} km w linii prostej (${szpital.nazwa}).` });
  if (haPracy > 20)
    kompromisy.push({ typ: "plus", tekst: `Ok. ${Math.round(haPracy)} ha stref pracy (biura, przemysł, handel) w promieniu 2 km – krótsze dojazdy.` });
  if (szkoly.length === 0)
    kompromisy.push({ typ: "minus", tekst: `Brak szkoły w ${z("promienSzkoly")} m dla ok. ${Math.round(dzieci)} dzieci – dowozy lub nowa placówka.` });
  else kompromisy.push({ typ: "uwaga", tekst: `${szkoly.length} szkół w ${z("promienSzkoly")} m – nie znamy ich wolnych miejsc (brak danych o pojemności).` });
  if (zielenNaOs < z("normaZieleni") && parkiObok < 5000)
    kompromisy.push({ typ: "minus", tekst: `Mało zieleni: ${zielenNaOs.toFixed(1)} m²/os. na osiedlu i brak dużego parku w ${z("promienZieleni")} m.` });
  else if (parkiObok >= 5000)
    kompromisy.push({ typ: "plus", tekst: `Park w zasięgu ${z("promienZieleni")} m (ok. ${fmtHa(parkiObok)}).` });
  if (autobusy > 1)
    kompromisy.push({ typ: "uwaga", tekst: `W szczycie potrzeba ok. ${autobusy.toFixed(1)} dodatkowych kursów autobusu.` });
  if (gestosc > 120)
    kompromisy.push({ typ: "uwaga", tekst: `Bardzo gęsta zabudowa: ${Math.round(gestosc)} mieszk./ha.` });

  return {
    metryki: {
      mieszkancy,
      autaSzczyt,
      objazdySzczyt: 0,
      pasazerowieSzczyt,
      zielenNowa: zielenWlasna,
      beneficjenciZieleni: 0,
      mieszkancyZPrzystankiem: maPrzystanek ? mieszkancy : 0,
      dzieci,
      koszt: mieszkania * z("kosztInfraNaMieszkanie"),
    },
    finanse: { capex: mieszkania * z("kosztInfraNaMieszkanie"), opexRok: mieszkania * 300, korzysciRok: mieszkancy * 1200 },
    szczegoly: [
      ["Powierzchnia", fmtHa(pow)],
      ["Gęstość", `${Math.round(gestosc)} mieszk./ha`],
      ["Mieszkańcy", fmtInt(mieszkancy)],
      ["Auta w szczycie", `+${fmtInt(autaSzczyt)} / h`],
      ["Pasażerowie w szczycie", `+${fmtInt(pasazerowieSzczyt)} / h`],
      ["Przystanki ≤400 m", przystanki.length],
      ["Linie ≤400 m", linie.length ? `${linie.length} (tram: ${linieTram})` : "0"],
      ["Szkoły ≤1 km", szkoly.length],
      ["Hałas drogowy (maks.)", !halas ? "–" : halas.max < 45 ? "< 45 dB (daleko od dróg głównych)" : `${Math.round(halas.max)} dB`],
      ["Strefy pracy ≤2 km", `${Math.round(haPracy)} ha`],
      ["Najbliższy szpital", szpital ? `${szpital.d.toFixed(1)} km (${szpital.nazwa})` : "–"],
      ["Dzieci szkolne", fmtInt(dzieci)],
      ["Zieleń na osiedlu", `${zielenNaOs.toFixed(1)} m²/os.`],
    ],
    wyjasnienia: [
      `Mieszkańcy = ${mieszkania} mieszkań × ${z("osobNaMieszkanie")} os.`,
      `Auta w szczycie = mieszkańcy × ${z("podrozyNaOsobe")} podróży × ${udzAuto} (udział auta) × ${z("udzialSzczytu")} (szczyt)`,
      `Koszt = ${mieszkania} × ${fmtInt(z("kosztInfraNaMieszkanie"))} zł infrastruktury`,
    ],
    kompromisy,
    wplyw: {
      strefy: [
        { geo: strefaSzkol, kolor: "#f08c00", opis: "Zasięg szkół 1 km" },
        { geo: strefaPrzyst, kolor: "#1971c2", opis: "Zasięg przystanków 400 m" },
      ],
      punkty: [
        ...przystanki.map((p) => ({ p, kolor: "#1971c2" })),
        ...szkoly.map((p) => ({ p, kolor: "#f08c00" })),
      ],
    },
  };
}

// ---------- PARK ----------
function simPark(inv, data) {
  const pow = turf.area(inv.geometry);
  const strefa = buffer(inv.geometry, z("promienZieleni"));
  const powStrefy = strefa ? turf.area(strefa) - pow : 0;
  const beneficjenci = km(km(powStrefy)) * z("gestoscMiasta");
  const istniejace = parkAreaWithin(data.parks, inv.geometry);
  const utraconeMieszkania = (pow / 10000) * z("mieszkanNaHa");

  const kompromisy = [
    { typ: "plus", tekst: `Ok. ${fmtInt(beneficjenci)} osób zyska park w odległości ${z("promienZieleni")} m (szacunek ze średniej gęstości).` },
    { typ: "minus", tekst: `Teren wyłączony z zabudowy – utracony potencjał ok. ${fmtInt(utraconeMieszkania)} mieszkań.` },
  ];
  if (istniejace > pow * 0.3)
    kompromisy.push({ typ: "uwaga", tekst: `Obszar w dużej części pokrywa się z istniejącą zielenią (${fmtHa(istniejace)}).` });

  return {
    metryki: {
      mieszkancy: 0,
      autaSzczyt: 0,
      objazdySzczyt: 0,
      pasazerowieSzczyt: 0,
      zielenNowa: Math.max(0, pow - istniejace),
      beneficjenciZieleni: beneficjenci,
      mieszkancyZPrzystankiem: 0,
      dzieci: 0,
      koszt: pow * z("kosztParkuNaM2"),
    },
    finanse: { capex: pow * z("kosztParkuNaM2"), opexRok: pow * 8, korzysciRok: beneficjenci * 50 },
    szczegoly: [
      ["Powierzchnia", fmtHa(pow)],
      ["Nowa zieleń", fmtHa(Math.max(0, pow - istniejace))],
      ["Osoby w zasięgu 500 m", fmtInt(beneficjenci)],
    ],
    wyjasnienia: [
      `Osoby w zasięgu = pow. pierścienia 500 m × ${z("gestoscMiasta")} os./km²`,
      `Koszt = ${fmtInt(pow)} m² × ${z("kosztParkuNaM2")} zł/m²`,
    ],
    kompromisy,
    wplyw: { strefy: [{ geo: strefa, kolor: "#2b8a3e", opis: "Zasięg parku 500 m" }], punkty: [] },
  };
}

// ---------- ZAMKNIĘCIE ULICY ----------
function simZamkniecie(inv, data) {
  const dl = turf.length(inv.geometry, { units: "kilometers" }) * 1000;
  const klasa = KLASY_ULIC[inv.params.klasa] || KLASY_ULIC.zbiorcza;
  const objazdy = klasa.natezenie * z("udzialSzczytu") * z("udzialObjazdow");
  const strefa = buffer(inv.geometry, 300);
  const przystanki = pointsWithin(data.stops, strefa);
  const strefaCicha = buffer(inv.geometry, 100);
  const ciszej = strefaCicha ? km(km(turf.area(strefaCicha))) * z("gestoscMiasta") : 0;

  const kompromisy = [
    { typ: "minus", tekst: `Ok. ${fmtInt(objazdy)} pojazdów/h w szczycie przeniesie się na sąsiednie ulice.` },
    { typ: "plus", tekst: `Mniej hałasu i spalin dla ok. ${fmtInt(ciszej)} osób przy ulicy; miejsce dla pieszych i rowerów.` },
  ];
  if (przystanki.length)
    kompromisy.push({ typ: "uwaga", tekst: `${przystanki.length} przystanków w 300 m – możliwa zmiana tras autobusów.` });
  if (inv.params.klasa === "glowna")
    kompromisy.push({ typ: "minus", tekst: "Zamknięcie ulicy głównej – wysokie ryzyko korków na objazdach." });

  return {
    metryki: {
      mieszkancy: 0,
      autaSzczyt: 0,
      objazdySzczyt: objazdy,
      pasazerowieSzczyt: 0,
      zielenNowa: 0,
      beneficjenciZieleni: 0,
      mieszkancyZPrzystankiem: 0,
      dzieci: 0,
      koszt: dl * z("kosztZamknieciaNaM"),
    },
    finanse: { capex: dl * z("kosztZamknieciaNaM"), opexRok: dl * 20, korzysciRok: ciszej * 40 },
    szczegoly: [
      ["Długość", `${fmtInt(dl)} m`],
      ["Klasa ulicy", `${klasa.label} (~${fmtInt(klasa.natezenie)} poj./dobę)`],
      ["Ruch na objazdach", `${fmtInt(objazdy)} poj./h`],
      ["Przystanki ≤300 m", przystanki.length],
    ],
    wyjasnienia: [
      `Objazdy = ${fmtInt(klasa.natezenie)} poj./dobę × ${z("udzialSzczytu")} (szczyt) × ${z("udzialObjazdow")} (część przenosząca się)`,
      `Koszt = ${fmtInt(dl)} m × ${z("kosztZamknieciaNaM")} zł/m`,
    ],
    kompromisy,
    wplyw: {
      strefy: [{ geo: strefa, kolor: "#c92a2a", opis: "Strefa objazdów 300 m" }],
      punkty: przystanki.map((p) => ({ p, kolor: "#c92a2a" })),
    },
  };
}

// ---------- NOWA DROGA ----------
function simDroga(inv, data) {
  const dl = turf.length(inv.geometry, { units: "kilometers" }) * 1000;
  const klasa = KLASY_ULIC[inv.params.klasa] || KLASY_ULIC.zbiorcza;
  const most = !!inv.params.most;
  const skrot = inv.params.skrot; // m, z automatycznej propozycji (może nie być)
  const przejety = klasa.natezenie * z("udzialSzczytu") * z("udzialPrzejetegoRuchu");
  const strefa = buffer(inv.geometry, z("promienPrzystanku"));
  const przystanki = pointsWithin(data.stops, strefa);
  const pasHalasu = buffer(inv.geometry, 100);
  const naHalas = pasHalasu ? km(km(turf.area(pasHalasu))) * z("gestoscMiasta") : 0;
  const kmDziennie = skrot ? (klasa.natezenie * z("udzialPrzejetegoRuchu") * skrot) / 1000 : 0;
  const koszt = dl * z("kosztDrogiNaM") + (most ? z("kosztMostu") : 0);

  const kompromisy = [
    { typ: "plus", tekst: `Ok. ${fmtInt(przejety)} pojazdów/h w szczycie przejdzie z zatłoczonych ulic na nową drogę.` },
    { typ: "minus", tekst: `Więcej hałasu i spalin dla ok. ${fmtInt(naHalas)} osób w pasie 100 m.` },
  ];
  if (skrot) kompromisy.push({ typ: "plus", tekst: `Krótsze trasy: ok. ${fmtInt(kmDziennie)} km mniej przejechanych dziennie.` });
  if (most) kompromisy.push({ typ: "minus", tekst: `Droga przecina ${MIASTO.rzeka} – potrzebny most (+${fmtZl(z("kosztMostu"))}).` });
  if (!przystanki.length)
    kompromisy.push({ typ: "uwaga", tekst: `Brak przystanku w ${z("promienPrzystanku")} m – warto dodać linię autobusową.` });
  if (inv.params.klasa === "glowna")
    kompromisy.push({ typ: "uwaga", tekst: "Droga główna może ściągnąć dodatkowy ruch (ruch wzbudzony)." });

  return {
    metryki: {
      mieszkancy: 0,
      autaSzczyt: 0,
      objazdySzczyt: -przejety,
      pasazerowieSzczyt: 0,
      zielenNowa: 0,
      beneficjenciZieleni: 0,
      mieszkancyZPrzystankiem: 0,
      dzieci: 0,
      koszt,
      co2Rok: (kmDziennie * 365 * z("co2Auta")) / 1000,
    },
    finanse: {
      capex: koszt,
      opexRok: dl * 30,
      // krótsze trasy: zaoszczędzony czas (śr. 30 km/h) i koszt jazdy (0,8 zł/km)
      korzysciRok: kmDziennie * 365 * ((1 / 30) * z("wartoscCzasu") + 0.8),
    },
    szczegoly: [
      ["Długość", `${fmtInt(dl)} m`],
      ["Klasa drogi", `${klasa.label} (~${fmtInt(klasa.natezenie)} poj./dobę)`],
      ["Odciążenie ulic", `−${fmtInt(przejety)} poj./h`],
      ...(skrot ? [["Skrócenie trasy", `${(skrot / 1000).toFixed(1)} km`]] : []),
      ["Most", most ? "tak" : "nie"],
      ["Przystanki ≤400 m", przystanki.length],
    ],
    wyjasnienia: [
      `Odciążenie = ${fmtInt(klasa.natezenie)} poj./dobę × ${z("udzialSzczytu")} (szczyt) × ${z("udzialPrzejetegoRuchu")} (ruch przejęty)`,
      `Koszt = ${fmtInt(dl)} m × ${fmtInt(z("kosztDrogiNaM"))} zł/m${most ? ` + most ${fmtZl(z("kosztMostu"))}` : ""}`,
      ...(skrot ? [`Mniej km dziennie = ${fmtInt(klasa.natezenie)} poj. × ${z("udzialPrzejetegoRuchu")} × ${(skrot / 1000).toFixed(1)} km skrótu`] : []),
    ],
    kompromisy,
    wplyw: {
      strefy: [{ geo: strefa, kolor: "#6741d9", opis: "Zasięg 400 m" }],
      punkty: przystanki.map((p) => ({ p, kolor: "#1971c2" })),
    },
  };
}

// ---------- PARKING / PARK & RIDE / ŁADOWARKI / FOTOWOLTAIKA ----------
function simParking(inv, data) {
  const p = inv.params;
  const pow = turf.area(inv.geometry);
  const miejsca = miejscaParkingu(inv);
  const istniejacy = !!p.istniejacy;
  const strefaPrzyst = buffer(inv.geometry, 300);
  const przystanki = pointsWithin(data.stops, strefaPrzyst);
  const linie = [...new Set(przystanki.flatMap((s) => s.properties.linie || []))];
  const ladowarki = p.ladowarki || 0;
  const kWp = pow * (p.pvProc / 100) * z("kWpNaM2");
  const energiaPV = kWp * z("uzyskPV"); // kWh/rok
  const energiaEV = ladowarki * z("energiaLadowarki") * 365; // kWh/rok
  const autaPR = p.parkRide ? miejsca * z("rotacjaPR") : 0;
  const kmPR = autaPR * z("dystansPRdoCentrum") * 2; // km/dzień nie przejechane do centrum
  const kmEV = energiaEV / 0.18; // km przejechane na prądzie zamiast benzyny (0,18 kWh/km)

  const co2Rok =
    (energiaPV * z("co2Sieci")) / 1000 +
    (kmPR * 300 * z("co2Auta")) / 1000 +
    (kmEV * (z("co2Auta") - 0.18 * z("co2Sieci"))) / 1000;
  const capex =
    (istniejacy ? 0 : miejsca * z("kosztMiejscaParkingowego")) +
    ladowarki * z("kosztLadowarki") +
    kWp * z("kosztPV") +
    (p.parkRide && istniejacy ? miejsca * 2000 : 0); // oznakowanie, kasy, monitoring
  const korzysciRok =
    energiaPV * z("cenaEnergii") +
    energiaEV * z("marzaLadowania") +
    kmPR * 300 * ((1 / 30) * z("wartoscCzasu") * 0.3 + 0.8);

  const kompromisy = [];
  if (p.parkRide) {
    if (!linie.length)
      kompromisy.push({ typ: "minus", tekst: "Park & Ride bez linii komunikacji w 300 m – kierowcy nie mają czym jechać dalej. Dodaj linię lub przenieś parking." });
    else
      kompromisy.push({ typ: "plus", tekst: `P&R: ok. ${fmtInt(autaPR)} aut dziennie zostaje przed centrum (${linie.length} linii w 300 m).` });
  } else if (!istniejacy) {
    kompromisy.push({ typ: "minus", tekst: `Nowy parking przyciągnie ok. ${fmtInt(miejsca * 2.5)} przejazdów autem dziennie w okolicy.` });
  }
  if (ladowarki)
    kompromisy.push({ typ: "plus", tekst: `${ladowarki} ładowarek EV: ok. ${fmtInt(energiaEV / 1000)} MWh/rok, ${fmtInt(kmEV / 1000)} tys. km na prądzie.` });
  if (kWp > 0)
    kompromisy.push({ typ: "plus", tekst: `Wiata PV ${fmtInt(kWp)} kWp: ok. ${fmtInt(energiaPV / 1000)} MWh/rok, ${energiaEV ? Math.min(100, Math.round((energiaPV / energiaEV) * 100)) + "% potrzeb ładowarek" : "energia dla miasta"}.` });
  if (!istniejacy)
    kompromisy.push({ typ: "uwaga", tekst: `Zajmuje ${fmtHa(pow)} terenu – sprawdź, czy nie lepiej przeznaczyć go na zieleń lub zabudowę.` });

  return {
    metryki: {
      mieszkancy: 0, autaSzczyt: 0, objazdySzczyt: 0, pasazerowieSzczyt: (autaPR * 1.3) * 0.15,
      zielenNowa: 0, beneficjenciZieleni: 0, mieszkancyZPrzystankiem: 0, dzieci: 0,
      koszt: capex, co2Rok, energiaPV: energiaPV / 1000,
    },
    finanse: { capex, opexRok: miejsca * 150 + ladowarki * 3000 + kWp * 40, korzysciRok },
    szczegoly: [
      ["Miejsca", `${fmtInt(miejsca)}${istniejacy ? " (istniejący)" : ""}`],
      ["Park & Ride", p.parkRide ? `tak, ${fmtInt(autaPR)} aut/dzień` : "nie"],
      ["Linie ≤300 m", linie.length],
      ["Ładowarki EV", ladowarki],
      ["Fotowoltaika", kWp ? `${fmtInt(kWp)} kWp · ${fmtInt(energiaPV / 1000)} MWh/rok` : "brak"],
      ["Bilans CO₂", fmtCO2(co2Rok)],
    ],
    wyjasnienia: [
      `Miejsca = ${fmtInt(pow)} m² / ${z("m2NaMiejsce")} m² na miejsce (lub dane OSM)`,
      `PV = ${fmtInt(pow)} m² × ${p.pvProc}% zadaszenia × ${z("kWpNaM2")} kWp/m² × ${z("uzyskPV")} kWh/kWp`,
      `P&R = ${fmtInt(miejsca)} miejsc × ${z("rotacjaPR")} auta/dzień × ${z("dystansPRdoCentrum")} km × 2`,
    ],
    kompromisy,
    wplyw: {
      strefy: [{ geo: strefaPrzyst, kolor: "#0c8599", opis: "Przystanki w 300 m" }],
      punkty: przystanki.map((s) => ({ p: s, kolor: "#1971c2" })),
    },
  };
}

// ---------- NOWA LINIA TRAMWAJOWA / AUTOBUSOWA ----------
function simLinia(inv, data) {
  const tram = inv.typ === "tramwaj";
  const s = statystykiLinii(inv, data);
  const p = inv.params;
  const capex = tram ? s.dlKm * z("kosztTramwajuNaKm") : s.pojazdy * z("kosztAutobusu");
  const opexBrutto = s.wozokmRok * (tram ? z("kosztWozokmTram") : z("kosztWozokmBus"));
  const bilety = s.pasazerowieDzien * 300 * 1.6; // ok. 1,6 zł średnio z biletu
  const kmAut = s.przejeteAuta * 5; // śr. 5 km podróży autem
  const co2Rok =
    (kmAut * 300 * z("co2Auta")) / 1000 -
    (tram || p.elektryczny ? (s.wozokmRok * (tram ? 4 : 1.3) * z("co2Sieci")) / 1000 : (s.wozokmRok * 1.1) / 1000);
  const istniejace = pointsWithin(data.stops, s.zasieg);

  const kompromisy = [
    { typ: "plus", tekst: `Ok. ${fmtInt(s.mieszkancy)} mieszkańców w zasięgu ${tram ? z("promienTramwaju") : z("promienPrzystanku")} m, ${fmtInt(s.pasazerowieDzien)} pasażerów dziennie.` },
    { typ: "plus", tekst: `Ok. ${fmtInt(s.przejeteAuta)} podróży autem dziennie mniej (przesiadka na ${tram ? "tramwaj" : "autobus"}).` },
    { typ: "minus", tekst: `Koszt eksploatacji ${fmtZl(opexBrutto)}/rok, bilety pokryją ok. ${Math.round((bilety / opexBrutto) * 100)}%.` },
  ];
  if (s.haPracy > 10) kompromisy.push({ typ: "plus", tekst: `Linia obsługuje ok. ${Math.round(s.haPracy)} ha stref pracy (biura, przemysł, handel).` });
  else kompromisy.push({ typ: "uwaga", tekst: "Linia omija strefy pracy – w szczycie może jeździć pusta w jedną stronę." });
  if (istniejace.length > s.przystanki.length * 2)
    kompromisy.push({ typ: "uwaga", tekst: `W korytarzu jest już ${istniejace.length} przystanków – linia może dublować istniejące.` });
  if (tram) kompromisy.push({ typ: "minus", tekst: "Budowa torowiska: kilkanaście miesięcy utrudnień w ruchu." });

  return {
    metryki: {
      mieszkancy: 0, autaSzczyt: 0, objazdySzczyt: 0,
      pasazerowieSzczyt: s.pasazerowieDzien * z("udzialSzczytu"),
      zielenNowa: 0, beneficjenciZieleni: 0, mieszkancyZPrzystankiem: 0, dzieci: 0,
      koszt: capex, co2Rok, pasazerowieDzien: s.pasazerowieDzien,
    },
    finanse: {
      capex,
      opexRok: opexBrutto - bilety,
      korzysciRok: kmAut * 300 * 0.8 + s.pasazerowieDzien * 300 * 0.15 * z("wartoscCzasu") * 0.2,
    },
    szczegoly: [
      ["Długość", `${s.dlKm.toFixed(1)} km`],
      ["Przystanki", `${s.przystanki.length} (${p.przystankiTryb === "reczne" ? "ręcznie" : "automatycznie"})`],
      ["Kursy", `co ${p.czestotliwosc} min · ${fmtInt(s.kursyDzien)} kursów/dzień`],
      ["Potrzebne pojazdy", s.pojazdy],
      ["Mieszkańcy w zasięgu", fmtInt(s.mieszkancy)],
      ["Pasażerowie / dzień", fmtInt(s.pasazerowieDzien)],
      ["Mniej podróży autem", `${fmtInt(s.przejeteAuta)} / dzień`],
      ["Bilans CO₂", fmtCO2(co2Rok)],
    ],
    wyjasnienia: [
      `Mieszkańcy = pow. zasięgu × ${z("gestoscMiasta")} os./km²`,
      `Przejęte auta = mieszkańcy × ${z("podrozyNaOsobe")} podróży × ${z("udzialAuta")} × ${z("przejecieAut")} × atrakcyjność linii`,
      tram
        ? `Koszt = ${s.dlKm.toFixed(1)} km × ${fmtZl(z("kosztTramwajuNaKm"))}/km`
        : `Koszt = ${s.pojazdy} autobusów × ${fmtZl(z("kosztAutobusu"))}`,
      `Eksploatacja = ${fmtInt(s.wozokmRok)} wozokm/rok × ${tram ? z("kosztWozokmTram") : z("kosztWozokmBus")} zł`,
    ],
    kompromisy,
    wplyw: {
      strefy: [{ geo: s.zasieg, kolor: tram ? "#e03131" : "#f08c00", opis: `Zasięg linii ${tram ? z("promienTramwaju") : z("promienPrzystanku")} m` }],
      punkty: s.przystanki.map((p, i) => ({
        p: { ...p, properties: { id: `${inv.id}-p${i}`, name: `${i + 1}. ${p.properties?.name || "Nowy przystanek"}${p.properties?.istniejacy ? " (istniejący)" : ""}` } },
        kolor: tram ? "#e03131" : "#f08c00",
      })),
    },
    przystanki: s.przystanki,
  };
}

const SYM = {
  osiedle: simOsiedle, park: simPark, zamkniecie: simZamkniecie, droga: simDroga,
  parking: simParking, tramwaj: simLinia, autobus: simLinia,
};

// ---------- ANALIZA FINANSOWA ----------
export function npv({ capex, opexRok, korzysciRok }) {
  const r = z("stopaDyskonta");
  const H = z("horyzontAnalizy");
  let v = -capex;
  for (let t = 1; t <= H; t++) v += (korzysciRok - opexRok) / (1 + r) ** t;
  return v;
}
const zwrot = (f) => (f.korzysciRok - f.opexRok > 0 ? f.capex / (f.korzysciRok - f.opexRok) : null);

// ---------- KONTEKST RUCHU (sieć + stan bazowy) ----------
let ctxCache = { data: null, zal: null, ctx: null };
export function kontekstRuchu(data, zalKlucz = "") {
  if (ctxCache.data === data && ctxCache.zal === zalKlucz) return ctxCache.ctx;
  const siec = zbudujSiec(data);
  const ctx = siec ? { siec, bazowa: analizaRuchu(siec, [], data) } : null;
  ctxCache = { data, zal: zalKlucz, ctx };
  return ctx;
}

// Pamięć wyników: inwestycja (obiekt) -> wynik. Nieruszone inwestycje nie są
// liczone ponownie, więc suwaki działają płynnie.
let cache = new WeakMap();
let cacheKlucz = null;

export function simulateInvestment(inv, data, zalKlucz = "") {
  if (cacheKlucz !== zalKlucz) {
    cache = new WeakMap();
    cacheKlucz = zalKlucz;
  }
  const c = cache.get(inv);
  if (c && c.data === data) return c.wynik;
  let wynik = null;
  try {
    const ctx = kontekstRuchu(data, zalKlucz);
    wynik = SYM[inv.typ](inv, data, ctx);
    wynik.metryki.co2Rok ??= 0;
    wynik.metryki.energiaPV ??= 0;
    wynik.metryki.pasazerowieDzien ??= 0;
    // skutki dla ruchu i hałasu w całym mieście (porównanie z sytuacją bez inwestycji)
    if (ctx) {
      const a = analizaRuchu(ctx.siec, [inv], data);
      const b = ctx.bazowa;
      const dZak = (a.zakorkowanieSzczyt - b.zakorkowanieSzczyt) * 100;
      const dGodz = a.pojGodzDzien - b.pojGodzDzien;
      const dHalas = a.halas.narazeni - b.halas.narazeni;
      wynik.ruch = { dZak, dGodz, dHalas };
      wynik.szczegoly.push(
        ["Zakorkowanie w szczycie", `${dZak > 0 ? "+" : ""}${dZak.toFixed(2)} p.p.`],
        ["Czas w korkach (miasto)", `${dGodz > 0 ? "+" : ""}${fmtInt(dGodz)} poj.-h/dzień`],
        ["Narażeni na hałas >" + z("progWHO") + " dB", `${dHalas > 0 ? "+" : ""}${fmtInt(dHalas)} os.`]
      );
      if (wynik.finanse) wynik.finanse.korzysciRok += -dGodz * 250 * z("wartoscCzasu");
      if (Math.abs(dZak) >= 0.05)
        wynik.kompromisy.push({
          typ: dZak > 0 ? "minus" : "plus",
          tekst: `Model ruchu: zakorkowanie miasta w szczycie ${dZak > 0 ? "rośnie" : "spada"} o ${Math.abs(dZak).toFixed(2)} p.p. (${fmtInt(Math.abs(dGodz))} pojazdogodzin dziennie ${dGodz > 0 ? "więcej" : "mniej"}).`,
        });
    }
    if (wynik.finanse) {
      wynik.finanse.npv = npv(wynik.finanse);
      wynik.finanse.zwrot = zwrot(wynik.finanse);
      wynik.metryki.npv = wynik.finanse.npv;
    }
  } catch (e) {
    console.error("Błąd symulacji", e);
    wynik = null;
  }
  cache.set(inv, { data, wynik });
  return wynik;
}

// Suma metryk dla całego wariantu + wspólna analiza ruchu (inwestycje działają razem)
let cacheWariantow = new WeakMap();
let cacheWariantowKlucz = null;

export function simulateVariant(variant, data, zalKlucz = "") {
  if (cacheWariantowKlucz !== zalKlucz) {
    cacheWariantow = new WeakMap();
    cacheWariantowKlucz = zalKlucz;
  }
  const c = cacheWariantow.get(variant.investments);
  if (c && c.data === data) return c.wynik;

  const wyniki = variant.investments.map((inv) => ({ inv, wynik: simulateInvestment(inv, data, zalKlucz) }));
  const suma = {
    mieszkancy: 0, autaSzczyt: 0, objazdySzczyt: 0, pasazerowieSzczyt: 0,
    zielenNowa: 0, beneficjenciZieleni: 0, mieszkancyZPrzystankiem: 0, dzieci: 0, koszt: 0,
    co2Rok: 0, energiaPV: 0, pasazerowieDzien: 0, npv: 0,
  };
  for (const { wynik } of wyniki) {
    if (!wynik) continue;
    for (const k in suma) suma[k] += wynik.metryki[k] || 0;
  }
  suma.udzialZPrzystankiem = suma.mieszkancy > 0 ? suma.mieszkancyZPrzystankiem / suma.mieszkancy : null;

  let ruch = null;
  const ctx = kontekstRuchu(data, zalKlucz);
  if (ctx) {
    ruch = variant.investments.length ? analizaRuchu(ctx.siec, variant.investments, data) : ctx.bazowa;
    suma.zakorkowanie = ruch.zakorkowanieSzczyt;
    suma.zakorkowanieBaza = ctx.bazowa.zakorkowanieSzczyt;
    suma.narazeniHalas = ruch.halas.narazeni;
    suma.narazeniHalasBaza = ctx.bazowa.halas.narazeni;
  }
  const wynik = { wyniki, suma, ruch };
  cacheWariantow.set(variant.investments, { data, wynik });
  return wynik;
}

// ---------- formatowanie ----------
export const fmtCO2 = (t) => (t >= 0 ? `${fmtInt(t)} t/rok mniej` : `${fmtInt(-t)} t/rok więcej`);
export const fmtInt = (n) => Math.round(n).toLocaleString("pl-PL");
export const fmtHa = (m2) => (m2 >= 10000 ? `${(m2 / 10000).toFixed(1)} ha` : `${fmtInt(m2)} m²`);
export const fmtZl = (n) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",").replace("-", "−")} mln zł` : `${fmtInt(n).replace("-", "−")} zł`;
