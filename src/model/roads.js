// AUTOMATYCZNE PROPOZYCJE NOWYCH DRÓG
// 1) Łączniki w sieci dróg: szukamy miejsc, gdzie dwie drogi główne są blisko siebie
//    w linii prostej, ale po istniejącej sieci (także ulicami lokalnymi i drogami dojazdowymi)
//    trzeba jechać dużo dalej. Tylko w zabudowie – bez dróg przez parki, pola i lasy.
//    Przebieg omija budynki (siatka budynków OSM, odstęp 4 m); gdy prosto się nie da –
//    obejście po siatce 5 m, najwyżej 30% dłuższe. Najlepszych kandydatów liczy pełny MODEL
//    ROZKŁADU RUCHU (przeplywy.js): zostają drogi, którymi naprawdę pojedzie dużo aut.
// 2) Dojazdy do nowych osiedli: gdy osiedle leży daleko od drogi, proponujemy
//    najkrótszy dojazd do najbliższej drogi.
import * as turf from "@turf/turf";
import { siatkaZabudowy, przyZabudowie } from "./network.js";
import { punktyMieszkancow, miejscaPracy } from "./popyt.js";
import { z } from "./config.js";
import { przypiszRuch } from "./przeplywy.js";

const MIN_PROSTA = 250; // m – krótsze łączniki to raczej skrzyżowania niż nowe drogi
const MAX_PROSTA = 1200; // m – dłuższe to już osobne inwestycje
const LIMIT_SIECI = 5000; // m – dalej nie szukamy po sieci (uznajemy brak połączenia)
const MIN_OBJAZD = 3; // ile razy dłużej po sieci niż w linii prostej
const MIN_ZYSK = 1000; // m – nowa droga musi skracać objazd co najmniej o tyle
const MAKS_PARK = 0.15; // najwyżej taka część przebiegu przez park
const MAKS_POZA_ZABUDOWA = 0.5; // najwyżej taka część przebiegu przez tereny otwarte (pola, lasy)
const MIN_LUDZIE = 8; // ok. ha zabudowy w promieniu 600 m od końców (średnia geometryczna)
const DO_OCENY = 150; // tylu kandydatów (najlepszych wstępnie) oceniamy modelem podróży
const ZASIEG_PODROZY = 4500; // m – rejony po obu stronach łącznika, których podróże może skrócić
const KRETOSC = 1.35; // typowa trasa po sieci jest o tyle dłuższa niż w linii prostej
const MIN_POJKM = 1500; // poj.-km dziennie, które łącznik musi oszczędzać
const ROZPAD = 4000; // m – im dalej, tym mniej podróży (model grawitacyjny)
const ODSTEP = 600; // m – minimalny odstęp między propozycjami
const MAX_PROPOZYCJI = 8;
const KORYTARZ = 1000; // m – dwa łączniki ze środkami bliżej siebie to warianty tego samego połączenia
const DOJAZD_OD = 250; // m – osiedle dalej od drogi dostaje propozycję dojazdu
const ODSTEP_OD_BUDYNKOW = 4; // m – nowa jezdnia nie może przechodzić bliżej budynku
const MAKS_WYDLUZENIE = 1.3; // obejście budynków najwyżej o tyle dłuższe niż prosta
const DO_MODELU = 8; // tylu najlepszych kandydatów liczy pełny model rozkładu ruchu
const MIN_RUCH_NOWEJ = 2500; // poj./dobę – mniej oznacza, że droga nie jest potrzebna

// Przebieg nowej drogi omijający budynki: prosto, a gdy na prostej stoi budynek – najkrótsza
// ścieżka po siatce budynków (A*, 8 kierunków) z odstępem od budynków, potem wygładzona.
// Zwraca { coords, dl, obejscie } albo null (nie da się sensownie ominąć).
function przebiegBezBudynkow(ca, cb, bud) {
  const prosta = dist(ca, cb);
  if (!bud) return { coords: [ca, cb], dl: prosta, obejscie: false };
  const wolnaProsta = (a, b, zapas = ODSTEP_OD_BUDYNKOW) => {
    const n = Math.max(1, Math.ceil(dist(a, b) / 2.5));
    // pierwsze i ostatnie metry to włączenie do istniejącej ulicy (tam budynki mogą stać blisko)
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (dist(c, ca) < 12 || dist(c, cb) < 12) continue;
      if (bud.zajete(c, zapas)) return false;
    }
    return true;
  };
  if (wolnaProsta(ca, cb)) return { coords: [ca, cb], dl: prosta, obejscie: false };
  // A* po siatce w korytarzu wokół prostej
  const [ax, ay] = bud.komorka(ca);
  const [bx, by] = bud.komorka(cb);
  const M = Math.ceil(150 / 5);
  const x0 = Math.min(ax, bx) - M, y0 = Math.min(ay, by) - M;
  const W = Math.max(ax, bx) + M - x0 + 1, H = Math.max(ay, by) + M - y0 + 1;
  if (W * H > 600000) return null;
  const r = Math.ceil(ODSTEP_OD_BUDYNKOW / 5);
  const zablok = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (bud.zajetaKomorka(x + x0, y + y0))
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
          const xx = x + i, yy = y + j;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) zablok[yy * W + xx] = 1;
        }
  // włączenia do ulic na końcach zawsze dostępne
  for (const [cx, cy] of [[ax - x0, ay - y0], [bx - x0, by - y0]])
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const xx = cx + i, yy = cy + j;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) zablok[yy * W + xx] = 0;
    }
  const start = (ay - y0) * W + (ax - x0);
  const cel = (by - y0) * W + (bx - x0);
  const g = new Float32Array(W * H).fill(Infinity);
  const skad = new Int32Array(W * H).fill(-1);
  const zamk = new Uint8Array(W * H);
  const h = (i) => {
    const dx = Math.abs((i % W) - (bx - x0)), dy = Math.abs(Math.floor(i / W) - (by - y0));
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  // kopiec binarny
  const hk = [], hv = [];
  const wstaw = (k, v) => {
    hk.push(k), hv.push(v);
    let i = hk.length - 1;
    while (i > 0) {
      const p2 = (i - 1) >> 1;
      if (hk[p2] <= hk[i]) break;
      [hk[p2], hk[i]] = [hk[i], hk[p2]];
      [hv[p2], hv[i]] = [hv[i], hv[p2]];
      i = p2;
    }
  };
  const zdejmij = () => {
    const v = hv[0];
    const lk = hk.pop(), lv = hv.pop();
    if (hk.length) {
      hk[0] = lk, hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (rr < hk.length && hk[rr] < hk[m]) m = rr;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]];
        [hv[m], hv[i]] = [hv[i], hv[m]];
        i = m;
      }
    }
    return v;
  };
  g[start] = 0;
  wstaw(h(start), start);
  const SAS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  const limit = (prosta * MAKS_WYDLUZENIE) / 5 + 2;
  let znaleziony = false;
  while (hk.length) {
    const v = zdejmij();
    if (zamk[v]) continue;
    zamk[v] = 1;
    if (v === cel) {
      znaleziony = true;
      break;
    }
    if (g[v] + h(v) > limit) break; // dalej byłoby za długo
    const x = v % W, y = Math.floor(v / W);
    for (const [dx, dy, c] of SAS) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const u = yy * W + xx;
      if (zablok[u] || zamk[u]) continue;
      const ng = g[v] + c;
      if (ng < g[u]) (g[u] = ng), (skad[u] = v), wstaw(ng + h(u), u);
    }
  }
  if (!znaleziony) return null;
  const sciezka = [];
  for (let v = cel; v !== -1; v = skad[v]) sciezka.push(bud.srodek((v % W) + x0, Math.floor(v / W) + y0));
  sciezka.reverse();
  sciezka[0] = ca;
  sciezka[sciezka.length - 1] = cb;
  // wygładzenie: najdalszy punkt widoczny w linii prostej (bez budynków)
  const coords = [ca];
  let i = 0;
  while (i < sciezka.length - 1) {
    let j = sciezka.length - 1;
    while (j > i + 1 && !wolnaProsta(sciezka[i], sciezka[j], ODSTEP_OD_BUDYNKOW - 1)) j--;
    coords.push(sciezka[j]);
    i = j;
  }
  let dl = 0;
  for (let k = 1; k < coords.length; k++) dl += dist(coords[k - 1], coords[k]);
  if (dl > prosta * MAKS_WYDLUZENIE) return null;
  return { coords, dl, obejscie: true };
}

// Szybka odległość w metrach (dokładna dla skali miasta)
function dist([lon1, lat1], [lon2, lat2]) {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx;
  const dy = (lat2 - lat1) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

const klucz = ([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

// Graf sieci drogowej z linii GeoJSON: drogi główne (roads) i ulice lokalne (streets).
// glowna[i]   – węzeł leży na drodze głównej (tylko takie łączymy nowymi drogami),
// szybka[i]   – węzeł leży wyłącznie na drodze szybkiego ruchu lub łącznicy (nie da się tam dołączyć drogi).
const SZYBKIE = /^(motorway|trunk)(_link)?$|_link$/; // drogi szybkiego ruchu i łącznice (zjazdy)
function zbudujGraf(roads, streets) {
  const idx = new Map(); // klucz -> numer węzła
  const wsp = []; // numer -> [lon, lat]
  const nazwa = []; // numer -> nazwa ulicy
  const sasiedzi = []; // numer -> [[numer, metry], ...]
  const glowna = [];
  const zwykla = []; // węzeł leży na drodze innej niż szybkiego ruchu
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
      zwykla.push(false);
    } else if (!nazwa[i] && n) nazwa[i] = n;
    return i;
  };
  const dodaj = (features, czyGlowna) => {
    for (const f of features || []) {
      const g = f.geometry;
      const linie = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
      const szybka = SZYBKIE.test(f.properties?.highway || "");
      for (const l of linie) {
        let prev = null;
        for (const c of l) {
          const i = wezel(c, f.properties?.name || "");
          if (czyGlowna) glowna[i] = true;
          if (!szybka) zwykla[i] = true;
          if (prev !== null && prev !== i) {
            const d = dist(wsp[prev], c);
            sasiedzi[prev].push([i, d]);
            sasiedzi[i].push([prev, d]);
          }
          prev = i;
        }
      }
    }
  };
  dodaj(roads.features, true);
  dodaj(streets?.features, false);
  return { wsp, nazwa, sasiedzi, glowna, szybka: zwykla.map((z) => !z) };
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

function przecina(linia, features) {
  const [w, s, e, n] = turf.bbox(linia);
  for (const r of features) {
    try {
      const [a, b, c, d] = r.bbox || (r.bbox = turf.bbox(r));
      if (c < w || a > e || d < s || b > n) continue;
      if (turf.lineIntersect(linia, r).features.length) return true;
    } catch {
      /* pomijamy */
    }
  }
  return false;
}

// Czy nowa droga przecina rzekę lub kanał (potrzebny most). railways – warstwa torów i kanałów.
// Zwraca false, "duzy" (wielka rzeka – most za kilkaset mln zł) albo "maly" (mniejsza rzeka, kanał).
const WIELKIE_RZEKI = /^(Wisła|Odra|Warta|Nogat|Narew|Bug|San|Noteć)$/i;
export function przecinaRzeke(linia, rivers, railways) {
  const woda = [...(rivers?.features || []), ...(railways?.features || []).filter((f) => f.properties.waterway)];
  if (!woda.length) return false;
  const wielkie = woda.filter((f) => WIELKIE_RZEKI.test(f.properties.name || ""));
  if (wielkie.length && przecina(linia, wielkie)) return "duzy";
  return przecina(linia, woda) ? "maly" : false;
}

// Czy nowa droga przecina tory kolejowe (potrzebny wiadukt) – tory na moście lub w tunelu nie są przeszkodą
export function przecinaTory(linia, railways) {
  const tory = (railways?.features || []).filter((f) => f.properties.railway && !f.properties.bridge && !f.properties.tunnel);
  return tory.length ? przecina(linia, tory) : false;
}

// Łączniki w istniejącej sieci (liczone raz dla danych OSM).
// Dobra propozycja nowej drogi:
//  - łączy dwie drogi główne (nie trasę szybkiego ruchu w środku odcinka),
//  - dziś trzeba objeżdżać co najmniej 3× dłużej i ponad 1 km – liczone po PEŁNEJ sieci,
//    razem z ulicami lokalnymi (inaczej proponowalibyśmy połączenia, które już są),
//  - oba końce są w zabudowie lub tuż przy niej, a przebieg nie idzie przez park ani przez
//    pola i lasy (nowa droga ma obsłużyć ludzi, a nie przecinać tereny otwarte),
//  - ocena: MODEL PODRÓŻY – rejony ok. 500 × 500 m z mieszkańcami i miejscami pracy, przejazdy
//    autem między nimi (model grawitacyjny, suma = podróże autem całego miasta); łącznik jest
//    wart budowy, gdy skraca realne przejazdy: liczymy poj.-km oszczędzane dziennie
//    i dzielimy przez koszt budowy (z mostem / wiaduktem).
// dane: { roads, streets, rivers, boundary, residential, zones, parks }
export function proponujLaczniki(dane) {
  const { roads, streets, rivers, railways, boundary, residential, zones, parks, budynki } = dane || {};
  if (!roads?.features?.length) return [];
  const t0 = performance.now();
  const graf = zbudujGraf(roads, streets);
  const siatka = zbudujSiatke(graf.wsp);
  const zab = siatkaZabudowy(residential, zones);
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

  // parki (z prostokątami do szybkiego odrzucania)
  const listaParkow = (parks?.features || [])
    .map((f) => {
      try {
        return { f, b: turf.bbox(f) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const wParku = (c) =>
    listaParkow.some(({ f, b }) => c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3] && turf.booleanPointInPolygon(c, f));

  // „ludzie” przy punkcie: liczba komórek zabudowy (ok. 1 ha każda) w promieniu ok. 600 m
  const ludzieOkolo = (c) => {
    if (!zab) return 1;
    let n = 0;
    for (let i = -5; i <= 5; i++)
      for (let j = -6; j <= 6; j++) if (przyZabudowie(zab, [c[0] + i * 0.0012, c[1] + j * 0.00072], 0)) n++;
    return n;
  };

  // Punkty startowe: węzły dróg głównych (nie tras szybkiego ruchu), z dala od granicy, w zabudowie:
  //  - ślepe końce dróg głównych,
  //  - po jednym węźle z każdego kwadratu ok. 400 × 400 m, żeby objąć całą sieć.
  const mozna = (i) => graf.glowna[i] && !graf.szybka[i];
  const konce = [];
  const komorki = new Set();
  graf.sasiedzi.forEach((s, i) => {
    if (!mozna(i)) return;
    const c = graf.wsp[i];
    if (!przyZabudowie(zab, c, 2)) return;
    if (s.length !== 1) {
      const k = `${Math.floor(c[0] / 0.006)}:${Math.floor(c[1] / 0.0036)}`;
      if (komorki.has(k)) return;
      komorki.add(k);
    }
    if (wMiescie(c, 400)) konce.push(i);
  });

  const dijkstra = przygotujDijkstre(graf);
  const kandydaci = [];
  for (const a of konce) {
    const ca = graf.wsp[a];
    // cele: węzły dróg głównych w zasięgu łącznika, w zabudowie (bez tej samej ulicy)
    const cele = [];
    for (const b of siatka.obok(ca)) {
      if (b === a || !mozna(b)) continue;
      if (graf.nazwa[a] && graf.nazwa[a] === graf.nazwa[b]) continue;
      const prosta = dist(ca, graf.wsp[b]);
      if (prosta >= MIN_PROSTA && prosta <= MAX_PROSTA && przyZabudowie(zab, graf.wsp[b], 2)) cele.push(b);
    }
    if (!cele.length) continue;
    const odl = dijkstra(a, LIMIT_SIECI, cele);
    let best = null;
    for (const b of cele) {
      const prosta = dist(ca, graf.wsp[b]);
      // brak połączenia w promieniu 5 km po pełnej sieci = zwykle osobny fragment danych
      // (np. drogi wewnętrzne zakładów) – pomijamy, żeby nie proponować bzdur
      const siec = odl(b);
      if (siec === undefined || siec < prosta * MIN_OBJAZD || siec - prosta < MIN_ZYSK) continue;
      const ocena = siec - 3 * prosta;
      if (!best || ocena > best.ocena) best = { a, b, prosta, siec, ocena };
    }
    if (best) kandydaci.push(best);
  }

  // dokładniejsza ocena kandydatów: przebieg (park, pola) i liczba ludzi po obu stronach
  const ocenione = [];
  for (const k of kandydaci) {
    const ca = graf.wsp[k.a];
    const cb = graf.wsp[k.b];
    if (!wMiescie(cb)) continue;
    if (/^most/i.test(graf.nazwa[k.a]) || /^most/i.test(graf.nazwa[k.b])) continue;
    const ludzie = Math.sqrt(ludzieOkolo(ca) * ludzieOkolo(cb));
    if (ludzie < MIN_LUDZIE) continue;
    // przebieg bez budynków (prosto albo obejście); nie da się – kandydat odpada
    const przebieg = przebiegBezBudynkow(ca, cb, budynki);
    if (!przebieg || k.siec < przebieg.dl * MIN_OBJAZD) continue;
    // próbki co 40 m wzdłuż przebiegu: park i tereny otwarte
    let n = 0;
    let park = 0;
    let poza = 0;
    for (let s0 = 1; s0 < przebieg.coords.length; s0++) {
      const [a0, b0] = [przebieg.coords[s0 - 1], przebieg.coords[s0]];
      const m = Math.max(1, Math.ceil(dist(a0, b0) / 40));
      for (let i = 1; i <= m; i++) {
        const c = [a0[0] + ((b0[0] - a0[0]) * i) / m, a0[1] + ((b0[1] - a0[1]) * i) / m];
        n++;
        if (wParku(c)) park++;
        if (!przyZabudowie(zab, c, 1)) poza++;
      }
    }
    if (park / n > MAKS_PARK || poza / n > MAKS_POZA_ZABUDOWA) continue;
    ocenione.push({ ...k, ca, cb, coords: przebieg.coords, dl: przebieg.dl, obejscie: przebieg.obejscie, ludzie, wynik: (k.siec - przebieg.dl) * Math.log(1 + ludzie) });
  }

  // --- model podróży: rejony z mieszkańcami i miejscami pracy ---
  ocenione.sort((x, y) => y.wynik - x.wynik);
  const doOceny = ocenione.slice(0, DO_OCENY);
  const rejony = new Map();
  const dodajRejon = (c, os, prac) => {
    const k = `${Math.floor(c[0] / 0.0072)}:${Math.floor(c[1] / 0.0045)}`;
    const r = rejony.get(k) || rejony.set(k, { sx: 0, sy: 0, w: 0, os: 0, prac: 0 }).get(k);
    const w = os + prac + 1e-6;
    r.sx += c[0] * w;
    r.sy += c[1] * w;
    r.w += w;
    r.os += os;
    r.prac += prac;
  };
  for (const m of punktyMieszkancow(residential, boundary)) dodajRejon(m.c, m.os, 0);
  for (const m of miejscaPracy(zones)) dodajRejon(m.c, 0, m.prac);
  const R = [];
  for (const r of rejony.values()) {
    const c = [r.sx / r.w, r.sy / r.w];
    let wez = null;
    for (const i of siatka.obok(c)) {
      const d = dist(c, graf.wsp[i]);
      if (d < 500 && (!wez || d < wez.d)) wez = { i, d };
    }
    if (wez) R.push({ c, os: r.os, prac: r.prac, wezel: wez.i });
  }
  // przejazdy autem między rejonami: T[o][d] = K · os_o · (0,4·os_d + praca_d) · e^(−odl/ROZPAD)
  const przyciaganie = R.map((r) => 0.4 * r.os + r.prac);
  let sumaW = 0;
  for (let o = 0; o < R.length; o++)
    for (let d = 0; d < R.length; d++) if (o !== d) sumaW += R[o].os * przyciaganie[d] * Math.exp(-dist(R[o].c, R[d].c) / ROZPAD);
  const podrozeAutem = R.reduce((a2, r) => a2 + r.os, 0) * z("podrozyNaOsobe") * z("udzialAuta");
  const K = sumaW ? podrozeAutem / sumaW : 0;
  const T = (o, d) => K * (R[o].os * przyciaganie[d] + R[d].os * przyciaganie[o]) * Math.exp(-dist(R[o].c, R[d].c) / ROZPAD);
  const wezlyRejonow = R.map((r) => r.wezel);
  const odlCache = new Map();
  const odlegloscDoRejonow = (start) => {
    if (odlCache.has(start)) return odlCache.get(start);
    const odl = dijkstra(start, ZASIEG_PODROZY, wezlyRejonow);
    const out = new Float64Array(R.length);
    R.forEach((r, i) => (out[i] = odl(r.wezel) ?? Infinity));
    odlCache.set(start, out);
    return out;
  };
  // oszczędność: dla par rejonów po dwóch stronach łącznika (oba kierunki w T)
  const zyskSieci = (k) => {
    const dA = odlegloscDoRejonow(k.a);
    const dB = odlegloscDoRejonow(k.b);
    const przyA = [];
    const przyB = [];
    for (let i = 0; i < R.length; i++) {
      if (dA[i] <= ZASIEG_PODROZY) przyA.push(i);
      if (dB[i] <= ZASIEG_PODROZY) przyB.push(i);
    }
    let pojKm = 0;
    let przejazdy = 0;
    for (const o of przyA)
      for (const d of przyB) {
        if (o === d) continue;
        const nowa = dA[o] + k.dl + dB[d];
        const stara = Math.min(dA[o] + k.siec + dB[d], KRETOSC * dist(R[o].c, R[d].c) + 300);
        if (stara - nowa < 200) continue;
        const t = T(o, d);
        pojKm += (t * (stara - nowa)) / 1000;
        przejazdy += t;
      }
    return { pojKm, przejazdy };
  };

  for (const k of doOceny) {
    k.linia = turf.lineString(k.coords);
    k.most = przecinaRzeke(k.linia, rivers, railways);
    k.wiadukt = przecinaTory(k.linia, railways);
    Object.assign(k, zyskSieci(k));
    k.koszt = k.dl * z("kosztDrogiNaM") + (k.most ? z(k.most === "maly" ? "kosztMostuMalego" : "kosztMostu") : 0) + (k.wiadukt ? z("kosztWiaduktu") : 0);
    // poj.-km zaoszczędzone dziennie na każdy 1 mln zł kosztu
    k.efekt = k.pojKm / (k.koszt / 1e6);
  }
  const wartosciowe = doOceny.filter((k) => k.pojKm >= MIN_POJKM).sort((x, y) => y.efekt - x.efekt);

  let wybrane = [];
  for (const k of wartosciowe) {
    if (wybrane.length >= (dane.ocenaRuchu ? DO_MODELU : MAX_PROPOZYCJI)) break;
    const { ca, cb } = k;
    const srodek = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2];
    const para = [graf.nazwa[k.a], graf.nazwa[k.b]].sort().join("|");
    // ten sam korytarz (bliskie końce, bliskie środki albo ta sama para ulic w pobliżu) – zostaje lepszy wariant
    const zaBlisko = wybrane.some(
      (w) =>
        Math.min(dist(ca, w.ca), dist(ca, w.cb)) < ODSTEP ||
        Math.min(dist(cb, w.ca), dist(cb, w.cb)) < ODSTEP ||
        dist(srodek, w.srodek) < KORYTARZ ||
        (para === w.para && dist(srodek, w.srodek) < 3 * KORYTARZ)
    );
    if (zaBlisko) continue;
    wybrane.push({ ...k, srodek, para });
  }

  // pełny model rozkładu ruchu dla najlepszych kandydatów: ile aut naprawdę pojedzie nową drogą
  if (dane.ocenaRuchu && wybrane.length) {
    const daneRuchu = { roads, streets, residential, zones, boundary };
    const baza = przypiszRuch(daneRuchu, {}, { iteracje: 4 });
    for (const w of wybrane) {
      const sc = przypiszRuch(daneRuchu, { noweDrogi: [{ id: "kandydat", coords: w.coords, klasa: "zbiorcza" }] }, { iteracje: 4 });
      w.ruchNowej = sc.nowe.kandydat ?? 0;
      w.oszczH = baza.sumy.pojHSzczyt - sc.sumy.pojHSzczyt; // poj.-h w szczycie
    }
    wybrane = wybrane
      .filter((w) => w.ruchNowej >= MIN_RUCH_NOWEJ)
      .sort((x, y) => y.ruchNowej / y.koszt - x.ruchNowej / x.koszt)
      .slice(0, MAX_PROPOZYCJI);
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
      dlugosc: w.dl,
      skrot: w.siec - w.dl,
      ruchNowej: w.ruchNowej,
      most: w.most,
      wiadukt: w.wiadukt,
      pojKm: w.pojKm,
      przejazdy: w.przejazdy,
      powod:
        (w.ruchNowej != null
          ? `Model rozkładu ruchu: nową drogą pojedzie ok. ${(Math.round(w.ruchNowej / 100) * 100).toLocaleString("pl-PL")} pojazdów na dobę${w.oszczH > 0 ? `, w szczycie ${Math.round(w.oszczH).toLocaleString("pl-PL")} poj.-h mniej w korkach` : ""}. `
          : `Model podróży: ok. ${(Math.round(w.przejazdy / 100) * 100).toLocaleString("pl-PL")} przejazdów autem dziennie skróci się średnio o ${(w.pojKm / Math.max(1, w.przejazdy)).toFixed(1)} km ` +
            `(${Math.round(w.pojKm).toLocaleString("pl-PL")} poj.-km mniej dziennie). `) +
        `Dziś objazd ${dalekiObjazd ? "ponad " : ""}${(w.siec / 1000).toFixed(1)} km, nowa droga ${Math.round(w.dl)} m` +
        `${w.most ? ", z mostem" : ""}${w.wiadukt ? ", z wiaduktem nad torami" : ""}${!budynki ? "" : w.obejscie ? ", przebieg omija budynki" : ", bez budynków na trasie"}.`,
      ranga: i + 1,
    };
  });
  console.info(`Propozycje dróg: ${wynik.length} z ${konce.length} punktów startowych (${kandydaci.length} kandydatów), ${Math.round(performance.now() - t0)} ms`);
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
