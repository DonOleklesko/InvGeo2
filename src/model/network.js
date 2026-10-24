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

// ---------- ZABUDOWA ----------
// Siatka komórek ok. 100 m: czy w komórce jest zabudowa mieszkaniowa albo strefa pracy (OSM).
// Służy do odróżnienia ulic w mieście od dróg przez pola i lasy.
const OKO_ZAB = 0.0012; // ° (ok. 80 × 130 m)
const kluczZab = (lon, lat) => `${Math.floor(lon / OKO_ZAB)}:${Math.floor(lat / (OKO_ZAB * 0.6))}`;

function wPierscieniu(x, y, r) {
  let w = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) w = !w;
  }
  return w;
}

const cacheZabudowy = new WeakMap();
export function siatkaZabudowy(residential, zones) {
  const klucz = residential || zones;
  if (!klucz) return null;
  const c = cacheZabudowy.get(klucz);
  if (c && c.zones === zones) return c.s;
  const s = new Set();
  for (const f of [...(residential?.features || []), ...(zones?.features || [])]) {
    const g = f.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) {
      const ring = p[0];
      if (!ring?.length) continue;
      let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of ring) {
        s.add(kluczZab(x, y)); // wierzchołki (także wąskie tereny)
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < so) so = y;
        if (y > n) n = y;
      }
      // środki komórek wewnątrz wielokąta
      const dy = OKO_ZAB * 0.6;
      for (let x = Math.floor(w / OKO_ZAB) * OKO_ZAB + OKO_ZAB / 2; x < e; x += OKO_ZAB)
        for (let y = Math.floor(so / dy) * dy + dy / 2; y < n; y += dy) if (wPierscieniu(x, y, ring)) s.add(kluczZab(x, y));
    }
  }
  cacheZabudowy.set(klucz, { zones, s });
  return s;
}

// Czy punkt leży w zabudowie lub tuż przy niej (sąsiednie komórki, ok. 100–150 m)
export function przyZabudowie(zab, [lon, lat], r = 1) {
  if (!zab) return true;
  const cx = Math.floor(lon / OKO_ZAB);
  const cy = Math.floor(lat / (OKO_ZAB * 0.6));
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (zab.has(`${cx + i}:${cy + j}`)) return true;
  return false;
}

// ---------- SIEĆ ----------
// Mnożnik „kosztu” odcinka dla autobusu: linie trzymają się dróg głównych i zbiorczych,
// ulice osiedlowe tylko na krótkich odcinkach, drogi przez pola i lasy – w ostateczności.
const KOSZT_AUTOBUSU = {
  motorway: 1.2, trunk: 1, primary: 1, secondary: 1, tertiary: 1.05,
  unclassified: 1.5, residential: 1.7, road: 1.7, living_street: 6,
  service: 5, // drogi dojazdowe i wewnętrzne (np. przez parkingi) – autobus tylko w ostateczności
};
const POZA_ZABUDOWA = { glowna: 1.25, lokalna: 3 }; // dodatkowy mnożnik poza zabudową

let cache = { roads: null, streets: null, residential: null, siec: null };

// Graf drogowy (liczony raz dla danych OSM). Każda krawędź: [węzeł, metry, koszt dla autobusu].
export function siecDrogowa(data) {
  if (!data?.roads) return null;
  if (cache.roads === data.roads && cache.streets === data.streets && cache.residential === data.residential) return cache.siec;
  const zab = siatkaZabudowy(data.residential, data.zones);
  const idx = new Map();
  const wsp = [];
  const nazwa = [];
  const sasiedzi = [];
  const glowna = []; // węzeł leży na drodze głównej (klasy roads)
  const wezel = (c, n) => {
    const k = klucz(c);
    let i = idx.get(k);
    if (i === undefined) {
      i = wsp.length;
      idx.set(k, i);
      wsp.push(c);
      nazwa.push(n);
      sasiedzi.push([]);
      glowna.push(false);
    } else if (!nazwa[i] && n) nazwa[i] = n;
    return i;
  };
  const dodaj = (features, czyGlowna) => {
    for (const f of features) {
      const g = f.geometry;
      const linie = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
      const hw = (f.properties?.highway || "").replace("_link", "");
      const mn = KOSZT_AUTOBUSU[hw] ?? (czyGlowna ? 1 : 1.7);
      for (const l of linie) {
        let prev = null;
        for (const c of l) {
          const i = wezel(c, f.properties?.name || "");
          if (czyGlowna) glowna[i] = true;
          if (prev !== null && prev !== i) {
            const p = wsp[prev];
            const d = dist(p, c);
            const srodek = [(p[0] + c[0]) / 2, (p[1] + c[1]) / 2];
            const poza = przyZabudowie(zab, srodek) ? 1 : czyGlowna ? POZA_ZABUDOWA.glowna : POZA_ZABUDOWA.lokalna;
            const k = d * mn * poza;
            sasiedzi[prev].push([i, d, k]);
            sasiedzi[i].push([prev, d, k]);
          }
          prev = i;
        }
      }
    }
  };
  dodaj(data.roads.features, true);
  dodaj(data.streets?.features || [], false);

  // spójne części sieci: trasy prowadzimy tylko po największej (bez „wysp” – np. dróg
  // wewnętrznych, które w danych nie łączą się z resztą miasta)
  const czesc = new Int32Array(wsp.length).fill(-1);
  const rozmiary = [];
  for (let s = 0; s < wsp.length; s++) {
    if (czesc[s] !== -1) continue;
    const nr = rozmiary.length;
    let n = 0;
    const stos = [s];
    czesc[s] = nr;
    while (stos.length) {
      const v = stos.pop();
      n++;
      for (const [m] of sasiedzi[v]) if (czesc[m] === -1) (czesc[m] = nr), stos.push(m);
    }
    rozmiary.push(n);
  }
  const glownaCzesc = rozmiary.indexOf(Math.max(...rozmiary));

  // skrzyżowanie = co najmniej 3 różnych sąsiadów
  const skrzyzowania = [];
  sasiedzi.forEach((s, i) => {
    if (new Set(s.map(([m]) => m)).size >= 3) skrzyzowania.push(i);
  });
  const siatka = zbudujSiatke(wsp);
  const siatkaSkrz = zbudujSiatke(skrzyzowania.map((i) => wsp[i]));
  const siec = { wsp, nazwa, sasiedzi, glowna, czesc, glownaCzesc, zab, idx, siatka, skrzyzowania, siatkaSkrz };
  cache = { roads: data.roads, streets: data.streets, residential: data.residential, siec };
  return siec;
}

// Najbliższy węzeł sieci (do ok. 400 m). Domyślnie tylko w głównej, spójnej części sieci –
// wtedy trasa zawsze da się poprowadzić (zamiast prostej kreski przez pola).
export function najblizszyWezel(siec, c, { maks = 400, wszystkie = false } = {}) {
  let best = null;
  for (const r of [1, 3, 6]) {
    for (const i of siec.siatka.obok(c, r)) {
      if (!wszystkie && siec.czesc && siec.czesc[i] !== siec.glownaCzesc) continue;
      const d = dist(c, siec.wsp[i]);
      if (!best || d < best.d) best = { i, d };
    }
    if (best && best.d <= r * 70) break;
  }
  return best && best.d < maks ? best : null;
}

// Odległość punktu do najbliższego skrzyżowania (m)
export function doSkrzyzowania(siec, c) {
  let min = Infinity;
  for (const j of siec.siatkaSkrz.obok(c, 1)) min = Math.min(min, dist(c, siec.wsp[siec.skrzyzowania[j]]));
  return min;
}

// A* między dwoma węzłami; zwraca listę węzłów albo null.
// autobus: koszt odcinka zależy od klasy drogi i zabudowy (mnożniki ≥ 1, więc heurystyka
// odległości w linii prostej nadal jest dopuszczalna); inaczej – sama długość.
export function trasa(siec, a, b, { autobus = false } = {}) {
  if (a === b) return [a];
  const cel = siec.wsp[b];
  const g = new Map([[a, 0]]);
  const skad = new Map();
  const h = new Kopiec();
  h.push(dist(siec.wsp[a], cel), a);
  let kroki = 0;
  while (h.size && kroki++ < 400000) {
    const [f, n] = h.pop();
    if (n === b) {
      const out = [b];
      let k = b;
      while (skad.has(k)) out.push((k = skad.get(k)));
      return out.reverse();
    }
    const gn = g.get(n);
    if (f > gn + dist(siec.wsp[n], cel) + 1e-6) continue; // nieaktualny wpis w kopcu
    for (const [m, d, k] of siec.sasiedzi[n]) {
      const nd = gn + (autobus ? k : d);
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
// autobus: trasa jak dla linii autobusowej (drogi główne, bez dróg przez pola, jeśli się da)
export function trasaPoSieci(siec, punkty, { autobus = false } = {}) {
  if (!siec || punkty.length < 2) return { coords: punkty, ok: false, pominiete: 0 };
  const wezly = punkty.map((p) => najblizszyWezel(siec, p));
  const coords = [];
  let pominiete = 0;
  for (let k = 0; k < punkty.length - 1; k++) {
    const a = wezly[k];
    const b = wezly[k + 1];
    const odc = a && b ? trasa(siec, a.i, b.i, { autobus }) : null;
    const seg = odc ? odc.map((i) => siec.wsp[i]) : [punkty[k], punkty[k + 1]];
    if (!odc) pominiete++;
    for (const c of seg) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
    }
  }
  return { coords: coords.length >= 2 ? coords : punkty, ok: pominiete === 0, pominiete };
}
