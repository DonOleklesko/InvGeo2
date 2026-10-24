// Kolory linii. OSM nie ma kolorów linii Torunia, więc nadajemy własne:
// tramwaje – stała paleta, autobusy – kolory rozłożone po kole barw, nocne – granatowe.
const TRAM = ["#e03131", "#9c36b5", "#1971c2", "#2f9e44", "#f08c00", "#0c8599", "#c2255c", "#5f3dc4"];

export function lineColor(props) {
  const n = parseInt(String(props.ref).replace(/\D/g, "")) || 0;
  if (props.mode === "tram") return TRAM[(n - 1 + TRAM.length) % TRAM.length];
  if (props.nocna) return "#364fc7";
  const hue = (n * 47) % 360;
  return `hsl(${hue}, 60%, 40%)`;
}

// przystanek tramwajowy: punkt zatrzymania na torowisku albo peron tylko dla tramwajów
export const czyTramwajowy = (p) => p.railway === "tram_stop" || (p.tram === "yes" && p.bus !== "yes");

export const lineLabel = (p) => `${p.mode === "tram" ? "Tramwaj" : p.nocna ? "Autobus nocny" : "Autobus"} ${p.ref}`;
