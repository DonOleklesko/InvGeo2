// AUTOMATYCZNE PROPOZYCJE NOWYCH DRÓG
// 1) Łączniki w sieci dróg: szukamy miejsc, gdzie dwie drogi są blisko siebie
//    w linii prostej, ale po istniejącej sieci trzeba jechać dużo dalej (objazd).
//    Start zawsze w „ślepym” końcu drogi (węzeł, z którego nie ma dalszej drogi).
// 2) Dojazdy do nowych osiedli: gdy osiedle leży daleko od drogi, proponujemy
//    najkrótszy dojazd do najbliższej drogi.
import * as turf from "@turf/turf";

const MIN_PROSTA = 250; // m – krótsze łączniki to raczej skrzyżowania niż nowe drogi
const MAX_PROSTA = 1200; // m – dłuższe to już osobne inwestycje
const LIMIT_SIECI = 5000; // m – dalej nie szukamy po sieci (uznajemy brak połączenia)
const MIN_OBJAZD = 3; // ile razy dłużej po sieci niż w linii prostej
const KARA_MOSTU = 5000; // m – „kara” w ocenie za przekroczenie rzeki
const ODSTEP = 600; // m – minimalny odstęp między propozycjami
const MAX_PROPOZYCJI = 12;
const DOJAZD_OD = 250; // m – osiedle dalej od drogi dostaje propozycję dojazdu

// Szybka odległość w metrach (dokładna dla skali miasta)
function dist([lon1, lat1], [lon2, lat2]) {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx;
  const dy = (lat2 - lat1) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

const klucz = ([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

// Graf sieci drogowej z linii GeoJSON
function zbudujGraf(roads) {
  const idx = new Map(); // klucz -> numer węzła
  const wsp = []; // numer -> [lon, lat]
  const nazwa = []; // numer -> nazwa ulicy
  const sasiedzi = []; // numer -> [[numer, metry], ...]
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
  for (const f of roads.features) {
    const g = f.geometry;
    const linie = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
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
  return { wsp, nazwa, sasiedzi };
}

// Siatka do szybkiego szukania sąsiednich węzłów
function zbudujSiatke(wsp, rozmiar = 0.01) {
  const s = new Map();
  wsp.forEach(([lon, lat], i) => {
    const k = `${Math.floor(lon / rozmiar)}:${Math.floor(lat / rozmiar)}`;
    if (!s.has(k)) s.set(k, []);
    s.get(k).push(i);
  });
  return {
    obok([lon, lat]) {
      const cx = Math.floor(lon / rozmiar);
      const cy = Math.floor(lat / rozmiar);
      const out = [];
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const c = s.get(`${cx + dx}:${cy + dy}`);
          if (c) out.push(...c);
        }
      return out;
    },
  };
}

// Dijkstra na tablicach typowanych (setki uruchomień na tysiącach węzłów – Map i tablice par
// były tu najwolniejsze). Tablice odległości nie są czyszczone między uruchomieniami:
// „znacznik” przebiegu mówi, czy wartość pochodzi z bieżącego uruchomienia.
function przygotujDijkstre(graf) {
  const n = graf.wsp.length;
  const poczatek = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) poczatek[i + 1] = poczatek[i] + graf.sasiedzi[i].length;
  const do_ = new Int32Array(poczatek[n]);
  const waga = new Float64Array(poczatek[n]);
  for (let i = 0, k = 0; i < n; i++) for (const [m, w] of graf.sasiedzi[i]) (do_[k] = m), (waga[k++] = w);

  const odl = new Float64Array(n);
  const znak = new Int32Array(n); // przebieg, w którym węzeł dostał odległość
  const gotowy = new Int32Array(n); // przebieg, w którym odległość węzła jest ostateczna
  const cel = new Int32Array(n); // przebieg, w którym węzeł jest szukanym celem
  let przebieg = 0;
  let hd = new Float64Array(1024);
  let hn = new Int32Array(1024);

  // cele: węzły, których odległości potrzebujemy – gdy wszystkie są ostateczne, kończymy wcześniej
  // (wynik taki sam jak przy pełnym przeszukaniu do limitu)
  return function dijkstra(start, limit, cele) {
    przebieg++;
    let zostalo = 0;
    for (const c of cele) if (cel[c] !== przebieg) (cel[c] = przebieg), zostalo++;
    let rozmiar = 0;
    const wstaw = (d, v) => {
      if (rozmiar === hd.length) {
        const nd = new Float64Array(rozmiar * 2);
        nd.set(hd);
        hd = nd;
        const nn = new Int32Array(rozmiar * 2);
        nn.set(hn);
        hn = nn;
      }
      let i = rozmiar++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p] <= d) break;
        hd[i] = hd[p];
        hn[i] = hn[p];
        i = p;
      }
      hd[i] = d;
      hn[i] = v;
    };
    odl[start] = 0;
    znak[start] = przebieg;
    wstaw(0, start);
    while (rozmiar && zostalo > 0) {
      const d = hd[0];
      const v = hn[0];
      // zdjęcie wierzchołka kopca
      const ld = hd[--rozmiar];
      const ln = hn[rozmiar];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= rozmiar) break;
        const m = l + 1 < rozmiar && hd[l + 1] < hd[l] ? l + 1 : l;
        if (hd[m] >= ld) break;
        hd[i] = hd[m];
        hn[i] = hn[m];
        i = m;
      }
      hd[i] = ld;
      hn[i] = ln;

      if (d > odl[v]) continue;
      if (d > limit) break;
      if (gotowy[v] === przebieg) continue;
      gotowy[v] = przebieg;
      if (cel[v] === przebieg) zostalo--;
      for (let k = poczatek[v]; k < poczatek[v + 1]; k++) {
        const m = do_[k];
        const nd = d + waga[k];
        if (znak[m] !== przebieg || nd < odl[m]) {
          odl[m] = nd;
          znak[m] = przebieg;
          wstaw(nd, m);
        }
      }
    }
    return (v) => (znak[v] === przebieg ? odl[v] : undefined);
  };
}

export function przecinaRzeke(linia, rivers) {
  if (!rivers?.features?.length) return false;
  for (const r of rivers.features) {
    try {
      if (turf.lineIntersect(linia, r).features.length) return true;
    } catch {
      /* pomijamy */
    }
  }
  return false;
}

// Łączniki w istniejącej sieci (liczone raz dla danych OSM)
export function proponujLaczniki(roads, rivers, boundary) {
  if (!roads?.features?.length) return [];
  const t0 = performance.now();
  const graf = zbudujGraf(roads);
  const siatka = zbudujSiatke(graf.wsp);
  const miasto = boundary?.features?.[0];
  // odcinki granicy (do szybkiego liczenia odległości – turf.pointToLineDistance był tu najwolniejszy)
  const odcinki = [];
  if (miasto) {
    const g = miasto.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) odcinki.push([ring[i - 1], ring[i]]);
  }
  const blizejGranicyNiz = (c, zapas) => {
    const kx = 111320 * Math.cos((c[1] * Math.PI) / 180);
    const ky = 110540;
    for (const [a, b] of odcinki) {
      const ax = (a[0] - c[0]) * kx, ay = (a[1] - c[1]) * ky;
      const bx = (b[0] - c[0]) * kx, by = (b[1] - c[1]) * ky;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      if (px * px + py * py <= zapas * zapas) return true;
    }
    return false;
  };

  const wMiescie = (c, zapas) => {
    if (!miasto) return true;
    try {
      if (!turf.booleanPointInPolygon(c, miasto)) return false;
      return !zapas || !blizejGranicyNiz(c, zapas);
    } catch {
      return false;
    }
  };

  // Punkty startowe (z dala od granicy, gdzie dane są ucięte):
  //  - ślepe końce dróg,
  //  - po jednym węźle z każdego kwadratu ok. 400 × 400 m, żeby objąć całą sieć.
  const konce = [];
  const komorki = new Set();
  graf.sasiedzi.forEach((s, i) => {
    const c = graf.wsp[i];
    if (s.length === 1) {
      if (wMiescie(c, 400)) konce.push(i);
      return;
    }
    const k = `${Math.floor(c[0] / 0.006)}:${Math.floor(c[1] / 0.0036)}`;
    if (komorki.has(k)) return;
    komorki.add(k);
    if (wMiescie(c, 400)) konce.push(i);
  });

  const dijkstra = przygotujDijkstre(graf);
  const kandydaci = [];
  for (const a of konce) {
    const ca = graf.wsp[a];
    // węzły w zasięgu łącznika (bez tej samej ulicy) – tylko ich odległości po sieci są potrzebne
    const cele = [];
    for (const b of siatka.obok(ca)) {
      if (b === a) continue;
      if (graf.nazwa[a] && graf.nazwa[a] === graf.nazwa[b]) continue;
      const prosta = dist(ca, graf.wsp[b]);
      if (prosta >= MIN_PROSTA && prosta <= MAX_PROSTA) cele.push(b);
    }
    if (!cele.length) continue;
    const odl = dijkstra(a, LIMIT_SIECI, cele);
    let best = null;
    for (const b of cele) {
      const prosta = dist(ca, graf.wsp[b]);
      // brak połączenia w promieniu = zwykle osobny fragment sieci, który łączą
      // ulice osiedlowe (nie ma ich w danych) – pomijamy, żeby nie proponować bzdur
      const siec = odl(b);
      // (ta sama ulica po obu stronach = to już jest jedna droga – odrzucona wyżej przy celach)
      if (siec === undefined || siec < prosta * MIN_OBJAZD) continue;
      const ocena = siec - 3 * prosta;
      if (!best || ocena > best.ocena) best = { a, b, prosta, siec, ocena };
    }
    if (best) kandydaci.push(best);
  }

  kandydaci.sort((x, y) => y.ocena - x.ocena);
  const wybrane = [];
  for (const k of kandydaci) {
    if (wybrane.length >= MAX_PROPOZYCJI) break;
    const ca = graf.wsp[k.a];
    const cb = graf.wsp[k.b];
    if (!wMiescie(cb)) continue;
    const zaBlisko = wybrane.some(
      (w) =>
        Math.min(dist(ca, w.ca), dist(ca, w.cb)) < ODSTEP || Math.min(dist(cb, w.ca), dist(cb, w.cb)) < ODSTEP
    );
    if (zaBlisko) continue;
    // środek łącznika leży przy istniejącej drodze → połączenie już jest
    const srodek = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2];
    if (siatka.obok(srodek).some((n) => dist(srodek, graf.wsp[n]) < 120)) continue;
    if (/^most/i.test(graf.nazwa[k.a]) || /^most/i.test(graf.nazwa[k.b])) continue;
    const linia = turf.lineString([ca, cb]);
    const most = przecinaRzeke(linia, rivers);
    if (most && k.ocena - KARA_MOSTU < 0) continue;
    wybrane.push({ ...k, ca, cb, linia, most });
  }

  const wynik = wybrane.map((w, i) => {
    const na = graf.nazwa[w.a] || "droga bez nazwy";
    const nb = graf.nazwa[w.b] || "droga bez nazwy";
    const dalekiObjazd = w.siec > LIMIT_SIECI;
    return {
      id: `lacznik-${klucz(w.ca)}-${klucz(w.cb)}`,
      rodzaj: "lacznik",
      nazwa: na === nb ? `Łącznik: ${na}` : `Łącznik: ${na} – ${nb}`,
      geometry: { ...w.linia, properties: {} },
      dlugosc: w.prosta,
      skrot: w.siec - w.prosta,
      most: w.most,
      powod: `Dziś objazd ${dalekiObjazd ? "ponad " : ""}${(w.siec / 1000).toFixed(1)} km, nowa droga ${Math.round(w.prosta)} m (krócej o ${((w.siec - w.prosta) / 1000).toFixed(1)} km).`,
      ranga: i + 1,
    };
  });
  console.info(`Propozycje dróg: ${wynik.length} z ${konce.length} punktów startowych, ${Math.round(performance.now() - t0)} ms`);
  return wynik;
}

// Dojazdy do osiedli z aktywnego wariantu
export function proponujDojazdy(roads, investments) {
  if (!roads?.features?.length) return [];
  const osiedla = investments.filter((i) => i.typ === "osiedle");
  if (!osiedla.length) return [];
  const linie = roads.features.filter((f) => f.geometry?.type === "LineString");
  const out = [];
  for (const inv of osiedla) {
    try {
      const wierzch = turf.coordAll(inv.geometry);
      let best = null;
      for (const c of wierzch) {
        const p = turf.point(c);
        for (const l of linie) {
          // szybkie odrzucenie po bbox (ok. 2 km)
          const [w, s, e, n] = l.bbox || (l.bbox = turf.bbox(l));
          if (c[0] < w - 0.03 || c[0] > e + 0.03 || c[1] < s - 0.02 || c[1] > n + 0.02) continue;
          const np = turf.nearestPointOnLine(l, p, { units: "meters" });
          if (!best || np.properties.dist < best.d) best = { d: np.properties.dist, od: c, do: np.geometry.coordinates, nazwa: l.properties?.name };
        }
      }
      if (!best || best.d < DOJAZD_OD) continue;
      out.push({
        id: `dojazd-${inv.id}`,
        rodzaj: "dojazd",
        nazwa: `Dojazd do: ${inv.nazwa}`,
        geometry: turf.lineString([best.od, best.do]),
        dlugosc: best.d,
        skrot: null,
        most: false,
        powod: `Osiedle jest ${Math.round(best.d)} m od najbliższej drogi głównej${best.nazwa ? ` (${best.nazwa})` : ""}.`,
      });
    } catch {
      /* uszkodzona geometria */
    }
  }
  return out;
}
