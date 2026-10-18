// SIEĆ DROGOWA DO PROWADZENIA TRAS
// Graf z dróg głównych i ulic lokalnych (OSM). Nowe trasy (linie, drogi, zamknięcia)
// biegną po istniejących ulicach – dzięki temu nie przecinają zabudowy. Węzły, w których
// spotykają się co najmniej 3 odcinki, to skrzyżowania (nie stawiamy na nich przystanków).

// Szybka odległość w metrach (dokładna dla skali miasta)
export function dist([lon1, lat1], [lon2, lat2]) {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx;
  const dy = (lat2 - lat1) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

const klucz = ([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

// Kopiec binarny (A*)
class Kopiec {
  constructor() {
    this.a = [];
  }
  push(d, n) {
    const a = this.a;
    a.push([d, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

// Siatka do szybkiego wyszukiwania punktów w pobliżu (komórka ok. 110 × 70 m)
export function zbudujSiatke(wsp, rozmiar = 0.001) {
  const s = new Map();
  wsp.forEach(([lon, lat], i) => {
    const k = `${Math.floor(lon / rozmiar)}:${Math.floor(lat / rozmiar)}`;
    if (!s.has(k)) s.set(k, []);
    s.get(k).push(i);
  });
  return {
    // indeksy punktów w promieniu ok. r komórek
    obok([lon, lat], r = 1) {
      const cx = Math.floor(lon / rozmiar);
      const cy = Math.floor(lat / rozmiar);
      const out = [];
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          const c = s.get(`${cx + dx}:${cy + dy}`);
          if (c) out.push(...c);
        }
      return out;
    },
  };
}

let cache = { roads: null, streets: null, siec: null };

// Graf drogowy (liczony raz dla danych OSM)
export function siecDrogowa(data) {
  if (!data?.roads) return null;
  if (cache.roads === data.roads && cache.streets === data.streets) return cache.siec;
  const idx = new Map();
  const wsp = [];
  const nazwa = [];
  const sasiedzi = [];
  const wezel = (c, n) => {
    const k = klucz(c);
    let i = idx.get(k);
    if (i === undefined) {
      i = wsp.length;
      idx.set(k, i);
      wsp.push(c);
      nazwa.push(n);
      sasiedzi.push([]);
    } else if (!nazwa[i] && n) nazwa[i] = n;
    return i;
  };
  const features = [...data.roads.features, ...(data.streets?.features || [])];
  for (const f of features) {
    const g = f.geometry;
    const linie = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    for (const l of linie) {
      let prev = null;
      for (const c of l) {
        const i = wezel(c, f.properties?.name || "");
        if (prev !== null && prev !== i) {
          const d = dist(wsp[prev], c);
          sasiedzi[prev].push([i, d]);
          sasiedzi[i].push([prev, d]);
        }
        prev = i;
      }
    }
  }
  // skrzyżowanie = co najmniej 3 różnych sąsiadów
  const skrzyzowania = [];
  sasiedzi.forEach((s, i) => {
    if (new Set(s.map(([m]) => m)).size >= 3) skrzyzowania.push(i);
  });
  const siatka = zbudujSiatke(wsp);
  const siatkaSkrz = zbudujSiatke(skrzyzowania.map((i) => wsp[i]));
  const siec = { wsp, nazwa, sasiedzi, siatka, skrzyzowania, siatkaSkrz };
  cache = { roads: data.roads, streets: data.streets, siec };
  return siec;
}

// Najbliższy węzeł sieci (do ok. 400 m)
export function najblizszyWezel(siec, c) {
  let best = null;
  for (const r of [1, 3]) {
    for (const i of siec.siatka.obok(c, r)) {
      const d = dist(c, siec.wsp[i]);
      if (!best || d < best.d) best = { i, d };
    }
    if (best) break;
  }
  return best && best.d < 400 ? best : null;
}

// Odległość punktu do najbliższego skrzyżowania (m)
export function doSkrzyzowania(siec, c) {
  let min = Infinity;
  for (const j of siec.siatkaSkrz.obok(c, 1)) min = Math.min(min, dist(c, siec.wsp[siec.skrzyzowania[j]]));
  return min;
}

// A* między dwoma węzłami; zwraca listę węzłów albo null
function trasa(siec, a, b) {
  if (a === b) return [a];
  const cel = siec.wsp[b];
  const g = new Map([[a, 0]]);
  const skad = new Map();
  const h = new Kopiec();
  h.push(dist(siec.wsp[a], cel), a);
  let kroki = 0;
  while (h.size && kroki++ < 400000) {
    const [, n] = h.pop();
    if (n === b) {
      const out = [b];
      let k = b;
      while (skad.has(k)) out.push((k = skad.get(k)));
      return out.reverse();
    }
    const gn = g.get(n);
    for (const [m, w] of siec.sasiedzi[n]) {
      const nd = gn + w;
      if (nd < (g.get(m) ?? Infinity)) {
        g.set(m, nd);
        skad.set(m, n);
        h.push(nd + dist(siec.wsp[m], cel), m);
      }
    }
  }
  return null;
}

// Prowadzi trasę po sieci przez kolejne kliknięte punkty.
// Zwraca { coords, ok, pominiete } – pominiete: odcinki bez połączenia w sieci (narysowane prosto)
export function trasaPoSieci(siec, punkty) {
  if (!siec || punkty.length < 2) return { coords: punkty, ok: false, pominiete: 0 };
  const wezly = punkty.map((p) => najblizszyWezel(siec, p));
  const coords = [];
  let pominiete = 0;
  for (let k = 0; k < punkty.length - 1; k++) {
    const a = wezly[k];
    const b = wezly[k + 1];
    const odc = a && b ? trasa(siec, a.i, b.i) : null;
    const seg = odc ? odc.map((i) => siec.wsp[i]) : [punkty[k], punkty[k + 1]];
    if (!odc) pominiete++;
    for (const c of seg) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
    }
  }
  return { coords: coords.length >= 2 ? coords : punkty, ok: pominiete === 0, pominiete };
}
