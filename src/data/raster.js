// SIATKA BUDYNKÓW (ok. 5 × 5 m): czy w danym miejscu stoi budynek.
// Tworzona raz w scripts/fetch-data.mjs z obrysów budynków OSM, zapisywana w public/data/<miasto>/buildings.bin
// jako odcinki zajętych komórek w każdym rzędzie (mały plik, szybki odczyt).
// Format: "BUD1", Uint32 szerokość, Uint32 wysokość, 4 B wolne, Float64 × 4 (zachód, południe, krok lon, krok lat),
// potem dla każdego rzędu: Uint16 liczba odcinków, pary Uint16 (początek, długość).

export const KOMORKA_M = 5;

export function nowaSiatka([s, w, n, e]) {
  const lat0 = (s + n) / 2;
  const dLat = KOMORKA_M / 110540;
  const dLon = KOMORKA_M / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const szer = Math.ceil((e - w) / dLon);
  const wys = Math.ceil((n - s) / dLat);
  return { w, s, dLon, dLat, szer, wys, bity: new Uint8Array(Math.ceil((szer * wys) / 8)) };
}

const ustaw = (g, x, y) => {
  if (x < 0 || y < 0 || x >= g.szer || y >= g.wys) return;
  const i = y * g.szer + x;
  g.bity[i >> 3] |= 1 << (i & 7);
};

// Zaznacza wielokąt (pierścień zewnętrzny [[lon, lat], ...]): wnętrze (środki komórek) i obrys
export function zaznaczWielokat(g, ring) {
  if (!ring || ring.length < 3) return;
  const pts = ring.map(([lon, lat]) => [(lon - g.w) / g.dLon, (lat - g.s) / g.dLat]);
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of pts) (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(g.wys - 1, Math.ceil(y1)); y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) ustaw(g, x, y);
  }
  // obrys (wąskie i małe budynki, mniejsze niż komórka)
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let k = 0; k <= n; k++) ustaw(g, Math.floor(ax + ((bx - ax) * k) / n), Math.floor(ay + ((by - ay) * k) / n));
  }
}

export function zakoduj(g) {
  const rzedy = [];
  let bajty = 48;
  for (let y = 0; y < g.wys; y++) {
    const odc = [];
    let x = 0;
    while (x < g.szer) {
      const i = y * g.szer + x;
      if (g.bity[i >> 3] & (1 << (i & 7))) {
        const start = x;
        while (x < g.szer) {
          const j = y * g.szer + x;
          if (!(g.bity[j >> 3] & (1 << (j & 7)))) break;
          x++;
        }
        odc.push(start, x - start);
      } else x++;
    }
    rzedy.push(odc);
    bajty += 2 + odc.length * 2;
  }
  const buf = new ArrayBuffer(bajty);
  const dv = new DataView(buf);
  "BUD1".split("").forEach((ch, i) => dv.setUint8(i, ch.charCodeAt(0)));
  dv.setUint32(4, g.szer, true);
  dv.setUint32(8, g.wys, true);
  dv.setFloat64(16, g.w, true);
  dv.setFloat64(24, g.s, true);
  dv.setFloat64(32, g.dLon, true);
  dv.setFloat64(40, g.dLat, true);
  let o = 48;
  for (const odc of rzedy) {
    dv.setUint16(o, odc.length / 2, true);
    o += 2;
    for (const v of odc) dv.setUint16(o, v, true), (o += 2);
  }
  return new Uint8Array(buf);
}

// Odczyt pliku → { zajete([lon, lat]) } (bity w Uint8Array, ok. 2 MB dla dużego miasta)
export function odkoduj(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const magia = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magia !== "BUD1") throw new Error("Zły plik siatki budynków");
  const g = {
    szer: dv.getUint32(4, true),
    wys: dv.getUint32(8, true),
    w: dv.getFloat64(16, true),
    s: dv.getFloat64(24, true),
    dLon: dv.getFloat64(32, true),
    dLat: dv.getFloat64(40, true),
  };
  g.bity = new Uint8Array(Math.ceil((g.szer * g.wys) / 8));
  let o = 48;
  for (let y = 0; y < g.wys; y++) {
    const n = dv.getUint16(o, true);
    o += 2;
    for (let k = 0; k < n; k++) {
      const start = dv.getUint16(o, true);
      const dl = dv.getUint16(o + 2, true);
      o += 4;
      for (let x = start; x < start + dl; x++) ustaw(g, x, y);
    }
  }
  return siatkaZBitow(g);
}

function siatkaZBitow(g) {
  const zajetaKomorka = (x, y) => {
    if (x < 0 || y < 0 || x >= g.szer || y >= g.wys) return false;
    const i = y * g.szer + x;
    return (g.bity[i >> 3] & (1 << (i & 7))) !== 0;
  };
  return {
    ...g,
    zajetaKomorka,
    komorka: ([lon, lat]) => [Math.floor((lon - g.w) / g.dLon), Math.floor((lat - g.s) / g.dLat)],
    srodek: (x, y) => [g.w + (x + 0.5) * g.dLon, g.s + (y + 0.5) * g.dLat],
    // budynek w promieniu „zapas” metrów od punktu
    zajete([lon, lat], zapas = 0) {
      const x = Math.floor((lon - g.w) / g.dLon);
      const y = Math.floor((lat - g.s) / g.dLat);
      const r = Math.ceil(zapas / KOMORKA_M);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (zajetaKomorka(x + i, y + j)) return true;
      return false;
    },
  };
}
