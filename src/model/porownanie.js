// WSKAŹNIKI DO PORÓWNAŃ WARIANTÓW (okno „Porównaj warianty” i raport PDF)
import { fmtInt, fmtHa, fmtZl, fmtCO2 } from "./simulate.js";

export const pct = (x) => `${(x * 100).toFixed(2)}%`;
export const zmiana = (v, baza, f) => (v == null ? "–" : `${f(v)} (${v - baza > 0 ? "+" : v - baza < 0 ? "−" : "±"}${f(Math.abs(v - baza))})`);

// [etykieta, wartość do porównania, formatowanie, kierunek: "min" | "max" | null]
export const GRUPY = [
  ["Ruch i hałas", [
    ["Zakorkowanie w szczycie", (s) => s.zakorkowanie, (s) => zmiana(s.zakorkowanie, s.zakorkowanieBaza, pct), "min"],
    ["Narażeni na hałas", (s) => s.narazeniHalas, (s) => zmiana(s.narazeniHalas, s.narazeniHalasBaza, fmtInt), "min"],
    ["Auta w szczycie (nowe)", (s) => s.autaSzczyt, (s) => `+${fmtInt(s.autaSzczyt)}/h`, "min"],
    ["Zmiana ruchu na ulicach", (s) => s.objazdySzczyt, (s) => `${s.objazdySzczyt > 0 ? "+" : s.objazdySzczyt < 0 ? "−" : ""}${fmtInt(Math.abs(s.objazdySzczyt))}/h`, "min"],
  ]],
  ["Mieszkańcy i komunikacja", [
    ["Nowi mieszkańcy", (s) => s.mieszkancy, (s) => fmtInt(s.mieszkancy), null],
    ["Pasażerowie w szczycie", (s) => s.pasazerowieSzczyt, (s) => `+${fmtInt(s.pasazerowieSzczyt)}/h`, "max"],
    ["Nowi mieszk. z przystankiem", (s) => s.udzialZPrzystankiem, (s) => (s.udzialZPrzystankiem == null ? "–" : `${Math.round(s.udzialZPrzystankiem * 100)}%`), "max"],
    ["Pasażerowie nowych linii / dzień", (s) => s.pasazerowieDzien, (s) => fmtInt(s.pasazerowieDzien), "max"],
    ["Dzieci szkolne", (s) => s.dzieci, (s) => fmtInt(s.dzieci), null],
  ]],
  ["Środowisko", [
    ["Nowa zieleń", (s) => s.zielenNowa, (s) => fmtHa(s.zielenNowa), "max"],
    ["Zyskają park (500 m)", (s) => s.beneficjenciZieleni, (s) => fmtInt(s.beneficjenciZieleni), "max"],
    ["Bilans CO₂", (s) => s.co2Rok, (s) => fmtCO2(s.co2Rok), "max"],
    ["Energia z PV", (s) => s.energiaPV, (s) => `${fmtInt(s.energiaPV)} MWh/rok`, "max"],
  ]],
  ["Finanse (szacunek)", [
    ["Koszt", (s) => s.koszt, (s) => fmtZl(s.koszt), "min"],
    ["NPV (20 lat)", (s) => s.npv, (s) => fmtZl(s.npv), "max"],
  ]],
];

// Najkorzystniejsza wartość w wierszu (null, gdy wszystkie równe lub brak kierunku)
export function najlepsza(vals, kier) {
  const liczby = vals.filter((v) => v != null && Number.isFinite(v));
  if (!kier || liczby.length < 2 || Math.min(...liczby) === Math.max(...liczby)) return null;
  return kier === "min" ? Math.min(...liczby) : Math.max(...liczby);
}

// Ile wskaźników każdy wariant wygrywa
export function punktacja(lista) {
  const pkt = Object.fromEntries(lista.map((w) => [w.id, 0]));
  for (const [, wiersze] of GRUPY)
    for (const [, val, , kier] of wiersze) {
      const vals = lista.map((w) => val(w.suma));
      const b = najlepsza(vals, kier);
      if (b != null) lista.forEach((w, i) => vals[i] === b && pkt[w.id]++);
    }
  return pkt;
}
