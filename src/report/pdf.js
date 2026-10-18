// RAPORT PDF WARIANTU
// Mapa: kafelki OpenStreetMap rysowane na canvasie + inwestycje + tylko najważniejsze punkty
// (np. przy P&R – przystanki dostępne w promieniu 400 m). Tekst: jsPDF z czcionką DejaVu Sans
// (polskie znaki). Biblioteki ładowane dopiero przy generowaniu raportu.
import * as turf from "@turf/turf";
import { TYPY, z } from "../model/config.js";
import { fmtInt, fmtHa, fmtZl, fmtCO2 } from "../model/simulate.js";
import { dist } from "../model/network.js";
import { GRUPY, najlepsza, punktacja, pct } from "../model/porownanie.js";
import { REFERENCYJNE, ZRODLA_OFICJALNE } from "../data/official.js";
import { MIASTO } from "../data/miasta.js";
import fontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import fontBoldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";

const KOLOR_PKT = { przystanek: "#1864ab", tram: "#c92a2a", szkola: "#e67700", szpital: "#c92a2a", nowy: "#111111" };
const OPIS_PKT = { przystanek: "przystanek", tram: "przystanek tramwajowy", szkola: "szkoła", szpital: "szpital", nowy: "przystanek linii" };

// ---------- mapa ----------
const TILE = 256;
const px = (lon, lat, zm) => {
  const s = TILE * 2 ** zm;
  const x = ((lon + 180) / 360) * s;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s;
  return [x, y];
};

const kafel = (z, x, y) =>
  new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });

// bbox [w, s, e, n] -> obraz PNG (dataURL) z narysowaną treścią
async function rysujMape(bbox, W, H, rysuj, maxZoom = 17) {
  const pad = 40;
  let zm = maxZoom;
  for (; zm > 10; zm--) {
    const [x1, y1] = px(bbox[0], bbox[3], zm);
    const [x2, y2] = px(bbox[2], bbox[1], zm);
    if (x2 - x1 <= W - 2 * pad && y2 - y1 <= H - 2 * pad) break;
  }
  const [cx, cy] = px((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2, zm);
  const ox = cx - W / 2;
  const oy = cy - H / 2;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#e5e7eb";
  g.fillRect(0, 0, W, H);
  const zadania = [];
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++)
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++)
      zadania.push(kafel(zm, tx, ty).then((img) => img && g.drawImage(img, tx * TILE - ox, ty * TILE - oy)));
  await Promise.all(zadania);
  // lekkie rozjaśnienie podkładu, żeby inwestycje były czytelne
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(0, 0, W, H);
  const p = ([lon, lat]) => {
    const [x, y] = px(lon, lat, zm);
    return [x - ox, y - oy];
  };
  const mPerPx = (156543.03392 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)) / 2 ** zm;
  rysuj(g, p, mPerPx);
  // podziałka i atrybucja
  const metry = [50, 100, 200, 500, 1000, 2000, 5000].find((m) => m / mPerPx > 80) || 5000;
  const dl = metry / mPerPx;
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillRect(10, H - 34, dl + 70, 24);
  g.strokeStyle = "#111";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(16, H - 16);
  g.lineTo(16 + dl, H - 16);
  g.stroke();
  g.fillStyle = "#111";
  g.font = "600 14px sans-serif";
  g.fillText(metry >= 1000 ? `${metry / 1000} km` : `${metry} m`, 22 + dl, H - 12);
  const atr = "© OpenStreetMap contributors";
  g.font = "12px sans-serif";
  const aw = g.measureText(atr).width;
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillRect(W - aw - 12, H - 20, aw + 12, 20);
  g.fillStyle = "#333";
  g.fillText(atr, W - aw - 6, H - 6);
  try {
    return cv.toDataURL("image/jpeg", 0.9);
  } catch {
    return null; // kafelki bez zgody CORS – mapa niedostępna
  }
}

function rysujInwestycje(g, p, inv, { gruba = 1, etykieta } = {}) {
  const t = TYPY[inv.typ];
  const geo = inv.geometry.geometry || inv.geometry;
  g.strokeStyle = t.kolor;
  g.fillStyle = t.kolor;
  g.lineJoin = "round";
  g.lineCap = "round";
  const sciezka = (ring) => {
    ring.forEach((c, i) => {
      const [x, y] = p(c);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
  };
  if (geo.type === "Polygon" || geo.type === "MultiPolygon") {
    const polys = geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates;
    for (const poly of polys) {
      g.beginPath();
      poly.forEach(sciezka);
      g.closePath();
      g.globalAlpha = 0.3;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 3 * gruba;
      g.stroke();
    }
  } else if (geo.type === "LineString") {
    g.beginPath();
    sciezka(geo.coordinates);
    g.lineWidth = 6 * gruba;
    g.setLineDash(inv.typ === "zamkniecie" ? [16, 10] : inv.typ === "autobus" ? [4, 10] : []);
    g.stroke();
    g.setLineDash([]);
  }
  if (etykieta) {
    const c = turf.pointOnFeature(inv.geometry).geometry.coordinates;
    znacznik(g, p(c), etykieta, t.kolor, 13);
  }
}

function znacznik(g, [x, y], tekst, kolor, r = 10, kwadrat = false) {
  g.fillStyle = kolor;
  g.strokeStyle = "#fff";
  g.lineWidth = 2.5;
  g.beginPath();
  if (kwadrat) g.rect(x - r, y - r, 2 * r, 2 * r);
  else g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#fff";
  g.font = `700 ${Math.round(r * 1.05)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(tekst), x, y + 1);
  g.textAlign = "start";
  g.textBaseline = "alphabetic";
}

function okrag(g, p, c, metry, mPerPx, kolor) {
  const [x, y] = p(c);
  g.strokeStyle = kolor;
  g.lineWidth = 2;
  g.setLineDash([8, 6]);
  g.beginPath();
  g.arc(x, y, metry / mPerPx, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
}

// ---------- najważniejsze punkty przy inwestycji ----------
const odlegloscDo = (inv, c) => {
  try {
    const geo = inv.geometry.geometry || inv.geometry;
    const pt = turf.point(c);
    if (geo.type === "LineString") return turf.pointToLineDistance(pt, inv.geometry, { units: "meters" });
    if (turf.booleanPointInPolygon(pt, inv.geometry)) return 0;
    return turf.pointToLineDistance(pt, turf.polygonToLine(inv.geometry), { units: "meters" });
  } catch {
    return dist(turf.centroid(inv.geometry).geometry.coordinates, c);
  }
};

function wBliskosci(inv, fc, promien, max, typ, linesById) {
  const [w, s, e, n] = turf.bbox(turf.buffer(inv.geometry, promien / 1000, { units: "kilometers" }));
  const out = [];
  const widziane = new Set();
  for (const f of fc?.features || []) {
    const c = f.geometry.coordinates;
    if (c[0] < w || c[0] > e || c[1] < s || c[1] > n) continue;
    const d = odlegloscDo(inv, c);
    if (d > promien) continue;
    const nazwa = f.properties.name || OPIS_PKT[typ];
    if (typ !== "szkola" && widziane.has(nazwa)) continue; // perony tego samego przystanku tylko raz
    widziane.add(nazwa);
    const linie = (f.properties.linie || []).map((id) => linesById?.[id]?.ref).filter(Boolean);
    out.push({
      coords: c,
      nazwa,
      typ: typ === "przystanek" && f.properties.railway === "tram_stop" ? "tram" : typ,
      d,
      opis: linie.length ? `linie: ${[...new Set(linie)].slice(0, 10).join(", ")}` : "",
    });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}

export function najwazniejszePunkty(inv, data, linesById) {
  const R = z("promienPrzystanku");
  switch (inv.typ) {
    case "parking":
      return { promien: 400, punkty: wBliskosci(inv, data.stops, 400, 8, "przystanek", linesById) };
    case "osiedle": {
      const szpital = wBliskosci(inv, data.hospitals, 5000, 1, "szpital");
      return {
        promien: R,
        punkty: [
          ...wBliskosci(inv, data.stops, R, 5, "przystanek", linesById),
          ...wBliskosci(inv, data.schools, z("promienSzkoly"), 3, "szkola"),
          ...szpital,
        ],
      };
    }
    case "tramwaj":
    case "autobus":
    case "droga": {
      const wl = (inv.params.przystanki || []).map((s, i) => ({
        coords: s.coords, nazwa: s.nazwa, typ: "nowy", d: null, opis: s.istniejacy ? "istniejący przystanek – przesiadka" : "nowy przystanek",
      }));
      if (wl.length) return { promien: null, punkty: wl };
      return { promien: R, punkty: wBliskosci(inv, data.stops, R, 5, "przystanek", linesById) };
    }
    case "zamkniecie":
      return { promien: 300, punkty: wBliskosci(inv, data.stops, 300, 5, "przystanek", linesById) };
    default:
      return { promien: R, punkty: wBliskosci(inv, data.stops, R, 3, "przystanek", linesById) };
  }
}

// ---------- PDF ----------
async function czcionka(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

const OSTRZEZENIE =
  "DANE TESTOWE – NIE SĄ TO DANE OFICJALNE. Wyniki pochodzą z uproszczonego modelu prototypu, danych OpenStreetMap i szacunkowych założeń. Nie są weryfikowane na żywo i nie wolno ich używać do analiz inwestycji ani podejmowania decyzji.";

export async function generujRaport({ data, wariantId, wariant, wyniki, suma, oficjalne, linesById, warianty = [] }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("DejaVuSans.ttf", await czcionka(fontUrl));
  doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", await czcionka(fontBoldUrl));
  doc.addFont("DejaVuSans-Bold.ttf", "DejaVu", "bold");
  doc.setFont("DejaVu", "normal");

  const W = 210;
  const M = 14;
  const SZ = W - 2 * M;
  let y = M;
  const dzis = new Date();

  const nowaStrona = () => {
    doc.addPage();
    y = M;
  };
  const miejsce = (h) => {
    if (y + h > 297 - 18) nowaStrona();
  };
  const tekst = (t, { size = 9, bold = false, kolor = [22, 25, 29], odstep = 1.5, szer = SZ, x = M } = {}) => {
    doc.setFont("DejaVu", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...kolor);
    const linie = doc.splitTextToSize(String(t), szer);
    const h = linie.length * size * 0.42;
    miejsce(h);
    doc.text(linie, x, y + size * 0.35);
    y += h + odstep;
  };
  const naglowek = (t) => {
    miejsce(14);
    y += 2;
    doc.setDrawColor(31, 95, 180);
    doc.setLineWidth(0.6);
    doc.line(M, y, M + SZ, y);
    y += 2;
    tekst(t, { size: 12, bold: true, odstep: 2 });
  };
  // glowa: pierwszy wiersz to nagłówek – powtarzany po przejściu na nową stronę
  const tabela = (wiersze, { kol = [0.6, 0.4], size = 8.5, glowa = false } = {}) => {
    doc.setFontSize(size);
    const wysokosc = (w) => {
      const linie = w.map((c, i) => doc.splitTextToSize(String(c ?? "–"), SZ * kol[i] - 2));
      return [linie, Math.max(...linie.map((l) => l.length)) * size * 0.42 + 1.6];
    };
    const rysujWiersz = (w, naglowkowy) => {
      const [linie, h] = wysokosc(w);
      if (naglowkowy) {
        doc.setFillColor(236, 241, 249);
        doc.rect(M, y, SZ, h, "F");
      }
      let x = M;
      w.forEach((_, i) => {
        doc.setFont("DejaVu", i === 0 && !naglowkowy ? "normal" : "bold");
        if (naglowkowy) doc.setTextColor(31, 95, 180);
        else doc.setTextColor(i === 0 ? 70 : 22, i === 0 ? 76 : 25, i === 0 ? 84 : 29);
        doc.text(linie[i], i === w.length - 1 && w.length === 2 ? M + SZ : x + 1, y + size * 0.36 + 0.4, { align: i === w.length - 1 && w.length === 2 ? "right" : "left" });
        x += SZ * kol[i];
      });
      y += h;
      doc.setDrawColor(220, 223, 228);
      doc.setLineWidth(0.2);
      doc.line(M, y, M + SZ, y);
    };
    const hGlowy = glowa ? wysokosc(wiersze[0])[1] : 0;
    // nagłówek razem z co najmniej jednym wierszem danych
    if (glowa && wiersze.length > 1) miejsce(hGlowy + wysokosc(wiersze[1])[1]);
    for (const [nr, w] of wiersze.entries()) {
      const h = wysokosc(w)[1];
      if (y + h > 297 - 18) {
        nowaStrona();
        if (glowa && nr > 0) rysujWiersz(wiersze[0], true);
      }
      rysujWiersz(w, glowa && nr === 0);
    }
    y += 2;
  };
  const ramkaOstrzezenia = () => {
    doc.setFont("DejaVu", "bold");
    doc.setFontSize(8.5);
    const linie = doc.splitTextToSize(OSTRZEZENIE, SZ - 8);
    const h = linie.length * 3.6 + 5;
    miejsce(h);
    doc.setFillColor(253, 236, 234);
    doc.setDrawColor(180, 35, 24);
    doc.setLineWidth(0.5);
    doc.rect(M, y, SZ, h, "FD");
    doc.setTextColor(180, 35, 24);
    doc.text(linie, M + 4, y + 5);
    y += h + 4;
  };
  const obraz = (png, h) => {
    if (!png) {
      tekst("(Mapa niedostępna – brak dostępu do kafelków OpenStreetMap.)", { size: 8, kolor: [100, 106, 115] });
      return;
    }
    miejsce(h + 2);
    doc.addImage(png, "JPEG", M, y, SZ, h);
    doc.setDrawColor(195, 200, 207);
    doc.setLineWidth(0.3);
    doc.rect(M, y, SZ, h);
    y += h + 3;
  };

  // ----- strona tytułowa -----
  tekst("InvGeo · prototyp v1.0", { size: 9, kolor: [31, 95, 180], bold: true, odstep: 1 });
  tekst(`Raport wariantu ${wariantId}: ${wariant.nazwa}`, { size: 17, bold: true, odstep: 1 });
  tekst(`Wygenerowano ${dzis.toLocaleString("pl-PL")} · ${wariant.investments.length} inwestycji`, { size: 9, kolor: [100, 106, 115], odstep: 4 });
  ramkaOstrzezenia();

  // mapa przeglądowa
  const wszystkie = turf.featureCollection(wariant.investments.map((i) => (i.geometry.type === "Feature" ? i.geometry : turf.feature(i.geometry))));
  if (wariant.investments.length) {
    const bb = turf.bbox(turf.buffer(wszystkie, 0.25, { units: "kilometers" }));
    const png = await rysujMape(bb, 1600, 1000, (g, p) => {
      wariant.investments.forEach((inv, i) => rysujInwestycje(g, p, inv, { etykieta: i + 1 }));
    }, 16);
    naglowek("Mapa inwestycji");
    obraz(png, SZ * (1000 / 1600));
    tabela(
      wariant.investments.map((inv, i) => [`${i + 1}. ${inv.nazwa}`, TYPY[inv.typ].label]),
      { kol: [0.65, 0.35] }
    );
  }

  // podsumowanie
  if (suma) {
    naglowek("Podsumowanie wariantu (model szacunkowy)");
    const pct = (x) => `${(x * 100).toFixed(2)}%`;
    tabela([
      ["Zakorkowanie w szczycie", suma.zakorkowanie != null ? `${pct(suma.zakorkowanie)} (bez inwestycji: ${pct(suma.zakorkowanieBaza)})` : "–"],
      ["Narażeni na hałas > 53 dB", suma.narazeniHalas != null ? `${fmtInt(suma.narazeniHalas)} os. (bez inwestycji: ${fmtInt(suma.narazeniHalasBaza)})` : "–"],
      ["Nowi mieszkańcy", fmtInt(suma.mieszkancy)],
      ["Pasażerowie nowych linii / dzień", fmtInt(suma.pasazerowieDzien)],
      ["Nowa zieleń", fmtHa(suma.zielenNowa)],
      ["Bilans CO₂", fmtCO2(suma.co2Rok)],
      ["Koszt (szacunek)", fmtZl(suma.koszt)],
      ["NPV 20 lat (szacunek)", fmtZl(suma.npv)],
    ]);
  }

  // ----- porównania -----
  const biezacy = warianty.find((x) => x.id === wariantId);
  if (suma && suma.zakorkowanieBaza != null) {
    naglowek("Porównanie: miasto bez inwestycji a wariant");
    const zm = (v, b, f, kier) => {
      if (v == null || b == null) return "–";
      const d = v - b;
      if (Math.abs(d) < 1e-9) return "bez zmian";
      const lepiej = kier === "min" ? d < 0 : d > 0;
      return `${d > 0 ? "+" : "−"}${f(Math.abs(d))} (${lepiej ? "lepiej" : "gorzej"})`;
    };
    const r2036 = biezacy?.lata?.find((l) => l.rok === 2036);
    const r2030 = biezacy?.lata?.find((l) => l.rok === 2030);
    tabela(
      [
        ["Wskaźnik", "Bez inwestycji", `Wariant ${wariantId}`, "Zmiana"],
        ["Zakorkowanie w szczycie (2025)", pct(suma.zakorkowanieBaza), pct(suma.zakorkowanie), zm(suma.zakorkowanie, suma.zakorkowanieBaza, pct, "min")],
        ...[r2030, r2036].filter(Boolean).map((r) => [`Zakorkowanie – prognoza ${r.rok}`, pct(r.baza), pct(r.wariant), zm(r.wariant, r.baza, pct, "min")]),
        ["Narażeni na hałas > 53 dB", fmtInt(suma.narazeniHalasBaza), fmtInt(suma.narazeniHalas), zm(suma.narazeniHalas, suma.narazeniHalasBaza, fmtInt, "min")],
        ["Nowi mieszkańcy", "0", fmtInt(suma.mieszkancy), suma.mieszkancy ? `+${fmtInt(suma.mieszkancy)}` : "bez zmian"],
        ["Nowa zieleń", "0 m²", fmtHa(suma.zielenNowa), suma.zielenNowa ? `+${fmtHa(suma.zielenNowa)}` : "bez zmian"],
        ["Bilans CO₂", "0", fmtCO2(suma.co2Rok), suma.co2Rok ? (suma.co2Rok > 0 ? "lepiej" : "gorzej") : "bez zmian"],
      ],
      { kol: [0.34, 0.2, 0.2, 0.26], glowa: true }
    );
  }

  const inne = warianty.filter((x) => x.liczbaInwestycji > 0);
  if (inne.length >= 2 && inne.some((x) => x.id === wariantId)) {
    naglowek("Porównanie wariantów");
    const pkt = punktacja(inne);
    const kol = [0.31, ...inne.map(() => 0.69 / inne.length)];
    const wiersze = [["Wskaźnik", ...inne.map((x) => `${x.id}${x.id === wariantId ? " (ten raport)" : ""}: ${x.nazwa}`)]];
    for (const [grupa, lista] of GRUPY) {
      wiersze.push([grupa.toUpperCase(), ...inne.map(() => "")]);
      for (const [label, val, fmt, kier] of lista) {
        const vals = inne.map((x) => val(x.suma));
        const b = najlepsza(vals, kier);
        wiersze.push([label, ...inne.map((x, i) => `${fmt(x.suma)}${b != null && vals[i] === b ? " ★" : ""}`)]);
      }
    }
    wiersze.push(["Najkorzystniejszy w (liczba wskaźników)", ...inne.map((x) => String(pkt[x.id]))]);
    tabela(wiersze, { kol, size: 7.5, glowa: true });
    const max = Math.max(...inne.map((x) => pkt[x.id]));
    const liderzy = inne.filter((x) => pkt[x.id] === max).map((x) => x.id);
    const miejsce = 1 + inne.filter((x) => pkt[x.id] > pkt[wariantId]).length;
    tekst(
      `★ = najkorzystniejsza wartość w wierszu. Najwięcej najkorzystniejszych wskaźników (${max}): ` +
        (liderzy.length > 1 ? `remis – warianty ${liderzy.join(", ")}. ` : `wariant ${liderzy[0]}. `) +
        `Wariant ${wariantId} zajmuje ${miejsce}. miejsce z ${inne.length}${liderzy.length > 1 && liderzy.includes(wariantId) ? " (ex aequo)" : ""}.`,
      { size: 8, kolor: [100, 106, 115] }
    );
  } else if (warianty.length) {
    tekst("Porównanie wariantów: dodaj inwestycje do co najmniej jednego innego wariantu, aby raport zawierał porównanie A/B/C.", { size: 8, kolor: [100, 106, 115] });
  }

  const zWynikiem = wyniki.filter((x) => x.wynik);
  if (zWynikiem.length >= 2) {
    naglowek("Porównanie inwestycji w wariancie");
    const kosztSuma = zWynikiem.reduce((a, x) => a + (x.wynik.metryki.koszt || 0), 0);
    const kolumny = [
      ["Koszt", (m) => m.koszt, (v) => fmtZl(v), "min"],
      ["NPV 20 lat", (m) => m.npv, (v) => fmtZl(v), "max"],
      ["CO₂", (m) => m.co2Rok, (v) => fmtCO2(v), "max"],
      ["Pasażerowie / dzień", (m) => m.pasazerowieDzien, (v) => fmtInt(v), "max"],
    ];
    const best = kolumny.map(([, val, , kier]) => najlepsza(zWynikiem.map((x) => val(x.wynik.metryki) || 0), kier));
    tabela(
      [
        ["Inwestycja", ...kolumny.map(([l]) => l), "Udział w koszcie"],
        ...zWynikiem.map((x) => {
          const i = wariant.investments.findIndex((v) => v.id === x.inv.id);
          const m = x.wynik.metryki;
          return [
            `${i + 1}. ${x.inv.nazwa}`,
            ...kolumny.map(([, val, fmt], k) => {
              const v = val(m) || 0;
              return `${fmt(v)}${best[k] != null && v === best[k] ? " ★" : ""}`;
            }),
            kosztSuma ? `${Math.round(((m.koszt || 0) / kosztSuma) * 100)}%` : "–",
          ];
        }),
      ],
      { kol: [0.27, 0.15, 0.15, 0.17, 0.13, 0.13], size: 7.5, glowa: true }
    );
    tekst("★ = najkorzystniejsza wartość w kolumnie.", { size: 8, kolor: [100, 106, 115] });
  }

  // ----- inwestycje -----
  for (const [i, inv] of wariant.investments.entries()) {
    nowaStrona();
    const t = TYPY[inv.typ];
    tekst(`${i + 1}. ${inv.nazwa}`, { size: 14, bold: true, odstep: 0.5 });
    tekst(t.label, { size: 9, kolor: [100, 106, 115], odstep: 3 });
    const { promien, punkty } = najwazniejszePunkty(inv, data, linesById);
    const geoFc = turf.featureCollection([inv.geometry.type === "Feature" ? inv.geometry : turf.feature(inv.geometry), ...punkty.map((pt) => turf.point(pt.coords))]);
    const bb = turf.bbox(turf.buffer(geoFc, promien ? Math.min(promien, 600) / 1000 : 0.15, { units: "kilometers" }));
    const png = await rysujMape(bb, 1600, 900, (g, p, mPerPx) => {
      if (promien && inv.typ === "parking") okrag(g, p, turf.centroid(inv.geometry).geometry.coordinates, promien, mPerPx, "#0c8599");
      rysujInwestycje(g, p, inv, { gruba: 1.2 });
      punkty.forEach((pt, k) => znacznik(g, p(pt.coords), k + 1, KOLOR_PKT[pt.typ], 11, pt.typ === "nowy" || pt.typ === "szpital"));
    });
    obraz(png, SZ * (900 / 1600));

    if (punkty.length) {
      tekst(
        inv.typ === "parking"
          ? `Najbliższe przystanki dostępne w promieniu 400 m (${punkty.length})`
          : inv.typ === "tramwaj" || inv.typ === "autobus" || (inv.typ === "droga" && inv.params.przystanki?.length)
            ? `Przystanki na trasie (${punkty.length})`
            : "Najważniejsze punkty w pobliżu",
        { size: 10, bold: true, odstep: 1.5 }
      );
      tabela(
        punkty.map((pt, k) => [`${k + 1}. ${pt.nazwa}`, OPIS_PKT[pt.typ] + (pt.opis ? ` · ${pt.opis}` : ""), pt.d == null ? "–" : pt.d < 1 ? "w obrębie" : `${Math.round(pt.d)} m`]),
        { kol: [0.42, 0.43, 0.15] }
      );
    } else if (inv.typ === "parking") {
      tekst("Brak przystanków w promieniu 400 m – Park & Ride nie ma połączenia z komunikacją.", { size: 9, bold: true, kolor: [180, 35, 24] });
    }

    const w = wyniki.find((x) => x.inv.id === inv.id)?.wynik;
    if (w) {
      tekst("Wskaźniki (model szacunkowy)", { size: 10, bold: true, odstep: 1.5 });
      tabela([...w.szczegoly.slice(0, 12), ["Koszt (szacunek)", fmtZl(w.metryki.koszt)], ...(w.finanse ? [["NPV 20 lat", fmtZl(w.finanse.npv)]] : [])]);
      const wazne = w.kompromisy.filter((k) => k.typ !== "uwaga").slice(0, 5);
      if (wazne.length) {
        tekst("Najważniejsze skutki", { size: 10, bold: true, odstep: 1.5 });
        for (const k of wazne) tekst(`${k.typ === "plus" ? "[+]" : "[–]"} ${k.tekst}`, { size: 8.5, kolor: k.typ === "plus" ? [30, 123, 58] : [180, 35, 24], odstep: 1 });
      }
    }
  }

  // ----- dane oficjalne -----
  nowaStrona();
  tekst("Dane z oficjalnych źródeł", { size: 14, bold: true, odstep: 3 });
  if (oficjalne?.indeksy) {
    tekst(`Indeks jakości powietrza GIOŚ (pobrano ${oficjalne.czas?.toLocaleString("pl-PL") || ""})`, { size: 10, bold: true });
    tabela(oficjalne.indeksy.map((s) => [`${MIASTO.nazwa}, ${s.nazwa}`, s.blad ? "brak danych" : `${s.kategoria} (${s.data?.slice(0, 16) || ""})`]));
  }
  if (oficjalne?.statystyki) {
    tekst(`Średnie roczne stężenia – średnia ze stacji w ${MIASTO.miejscownik} (µg/m³)`, { size: 10, bold: true });
    const lata = [...new Set(oficjalne.statystyki.PM10.map((x) => x.rok))].sort((a, b) => b - a).slice(0, 6);
    tabela(
      [["Rok", "PM10 / dni > 50", "NO₂"], ...lata.map((r) => {
        const pm = oficjalne.statystyki.PM10.find((x) => x.rok === r);
        const no = oficjalne.statystyki.NO2.find((x) => x.rok === r);
        return [String(r), pm ? `${pm.srednia.toFixed(1)} / ${pm.dni50 ?? "–"}` : "–", no ? no.srednia.toFixed(1) : "–"];
      })],
      { kol: [0.3, 0.4, 0.3] }
    );
    tekst("Norma średniej rocznej (dyrektywa 2008/50/WE): PM10 i NO₂ – 40 µg/m³; zalecenia WHO 2021: PM10 – 15, NO₂ – 10 µg/m³.", { size: 8, kolor: [100, 106, 115] });
  }
  if (!oficjalne?.indeksy && !oficjalne?.statystyki) tekst("Pomiary GIOŚ były niedostępne w chwili generowania raportu.", { size: 9, kolor: [100, 106, 115] });
  tekst("Wartości referencyjne", { size: 10, bold: true });
  tabela(REFERENCYJNE.map((r) => [`${r.etykieta} (stan: ${r.stan})`, `${r.format === "int" ? fmtInt(r.wartosc) : r.wartosc.toLocaleString("pl-PL")} ${r.jedn}`]));
  tekst("Źródła", { size: 10, bold: true });
  for (const zr of Object.values(ZRODLA_OFICJALNE)) tekst(`${zr.nazwa}: ${zr.url}`, { size: 7.5, kolor: [31, 95, 180], odstep: 0.8 });
  y += 3;
  ramkaOstrzezenia();

  // stopki
  const n = doc.getNumberOfPages();
  for (let s = 1; s <= n; s++) {
    doc.setPage(s);
    doc.setFont("DejaVu", "normal");
    doc.setFontSize(7);
    doc.setTextColor(180, 35, 24);
    doc.text("DANE TESTOWE – nie do analiz inwestycji ani decyzji. Model szacunkowy, dane OSM, założenia prototypu.", M, 289);
    doc.setTextColor(100, 106, 115);
    doc.text(`InvGeo · v1.0 · strona ${s}/${n}`, W - M, 289, { align: "right" });
  }

  const nazwa = `invgeo-wariant-${wariantId}-${dzis.toISOString().slice(0, 10)}.pdf`;
  doc.save(nazwa);
  return nazwa;
}
