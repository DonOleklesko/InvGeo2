# InvGeo – prototyp v1.0

> **DANE TESTOWE.** Wyniki pochodzą z uproszczonego modelu, danych OpenStreetMap i szacunkowych założeń. Nie są to dane oficjalne ani weryfikowane na żywo – nie należy ich używać do analiz inwestycji ani podejmowania decyzji. Wyjątek: pomiary GIOŚ w panelu „Dane z oficjalnych źródeł”.

Symulator skutków decyzji miejskich dla Torunia, Bydgoszczy i Elbląga (wybór miasta w nagłówku): mapa 2D, inwestycje (osiedla, parki, drogi, zamknięcia ulic, parkingi i Park & Ride z ładowarkami i fotowoltaiką, nowe linie tramwajowe i autobusowe), model ruchu i hałasu, analiza finansowa, porównanie wariantów A/B/C i rekomendacja.

## Uruchomienie (krok po kroku)

1. Zainstaluj **Node.js** (wersja 18 lub nowsza): https://nodejs.org
2. Otwórz terminal w folderze projektu.
3. Zainstaluj biblioteki (tylko za pierwszym razem):
   ```
   npm install
   ```
4. (Opcjonalnie) pobierz dane miast z OpenStreetMap do plików – są już w `public/data/<miasto>/`, więc ten krok potrzebny jest tylko do odświeżenia:
   ```
   npm run fetch-data
   npm run fetch-data -- --miasto elblag
   ```
   Skrypt pobiera tylko brakujące warstwy – gdy serwery Overpass są przeciążone, po prostu uruchom go ponownie (`npm run fetch-data -- --force` pobiera wszystko od nowa).
5. Uruchom aplikację:
   ```
   npm run dev
   ```
   Przeglądarka otworzy się sama (adres zwykle http://localhost:5173).

   **Na słabszym laptopie (np. biurowy i5 8. generacji)** zamiast `npm run dev` uruchom wersję produkcyjną – jest szybsza (bez narzędzi deweloperskich Reacta, które m.in. liczą model dwa razy):
   ```
   npm start
   ```
   (buduje aplikację i otwiera ją pod http://localhost:4173; pomiary GIOŚ działają tak samo).

### Wydajność

- Dane miast są w plikach (`public/data/<miasto>/`) i trafiają do aplikacji jednym pakietem – model nie przelicza się po każdej wczytanej warstwie.
- Propozycje łączników dróg i Park & Ride liczą się w osobnym wątku (`src/model/propozycje.worker.js`), więc mapa nie zamarza przy starcie; model ruchu liczy się dopiero po narysowaniu mapy, a sieć ulic do prowadzenia tras – w wolnej chwili.
- Zmiana miasta przeładowuje stronę – w pamięci są dane tylko jednego miasta.

## Jak używać

0. **Miasto** – lista w nagłówku (obok nazwy aplikacji): Toruń, Bydgoszcz albo Elbląg. Po zmianie strona wczytuje się od nowa z danymi wybranego miasta (granica, przystanki, linie, drogi, parkingi, strefy pracy, stacje GIOŚ) i od nowa liczy propozycje dróg, linii autobusowych i P&R. Warianty A/B/C i założenia są zapisywane osobno dla każdego miasta. Link do konkretnego miasta: `?miasto=bydgoszcz`.
1. Wybierz wariant (A, B lub C) w lewym panelu.
2. Wybierz typ inwestycji w menu **Inwestycje** nad mapą i narysuj ją:
   - osiedle / park / parking – klikaj narożniki, zakończ klikając pierwszy punkt; **osiedle nie może nachodzić na inne osiedle** (drogi i parki na osiedlu są dozwolone),
   - zamknięcie ulicy / droga / linia tramwajowa / autobusowa – klikaj punkty trasy, zakończ podwójnym kliknięciem. **Linia autobusowa i zamknięcie ulicy** są prowadzone **po istniejących ulicach** (OSM), więc nie przecinają zabudowy (opcja „Nadpisz zasadę: swobodny przebieg” pozwala narysować je dokładnie tak, jak klikasz). **Linia tramwajowa i nowa droga** to nowe torowisko / jezdnia – biegną dokładnie tak, jak narysowano; w razie potrzeby przycisk „Poprowadź po istniejących ulicach” w parametrach.
3. Przystanki nowej linii wyznaczają się automatycznie: co ok. 350–700 m, nie na skrzyżowaniach, tylko przy zabudowie mieszkaniowej lub celach podróży (szkoły, szpitale, strefy pracy, osiedla), z wykorzystaniem istniejących przystanków na trasie. W parametrach linii można przełączyć na tryb ręczny i dodawać/usuwać przystanki kliknięciem na mapie. Dla nowej drogi można wyznaczyć przystanki i utworzyć na niej linię autobusową.
4. Kształt osiedla, parku i parkingu zmienisz przyciskiem „Edytuj kształt na mapie”.
5. Przystanki na mapie: domyślnie tylko w promieniu 500 m od inwestycji, przełącznik „wszystkie” nad mapą. Tam też wyłączysz granicę miasta.
6. Gdy co najmniej dwa warianty mają inwestycje, w prawym dolnym rogu mapy pojawia się przycisk **Porównaj warianty**.
7. **Raport PDF** (nagłówek) pobiera raport aktywnego wariantu: mapa inwestycji, osobna mapa każdej inwestycji z najważniejszymi punktami (np. przy P&R – przystanki w promieniu 400 m), wskaźniki, **porównania** (miasto bez inwestycji a wariant – także prognoza 2030/2036; warianty A/B/C z najkorzystniejszą wartością ★ i punktacją; inwestycje w wariancie między sobą), dane GIOŚ i ostrzeżenie o danych testowych.
8. Prawy panel: skutki zaznaczonej inwestycji, **dane z oficjalnych źródeł** (GIOŚ na żywo: indeks jakości powietrza i średnie roczne PM10/NO₂ ze stacji w Toruniu; GUS; program ochrony przed hałasem UM Toruń), założenia modelu i źródła.
9. Tryb ciemny – przycisk w prawym górnym rogu.

Pomiary GIOŚ są pobierane przez pośrednika serwera Vite (`/gios` w `vite.config.js`), bo API GIOŚ nie zezwala na zapytania z innych domen – działa w `npm run dev` i `npm run preview`.

## Model ruchu i hałasu (`src/model/traffic.js`)

- **Ruch bazowy** każdego odcinka drogi (OSM): klasa drogi, liczba pasów, odległość od centrum, bliskość stref pracy, mosty na Wiśle.
- **Doba**: typowe profile godzinowe dnia roboczego i weekendu → natężenie w każdej godzinie.
- **Zakorkowanie**: obciążenie V/C i czas przejazdu wg krzywej BPR; współczynnik zakorkowania = o ile dłużej jedzie się niż przy pustych drogach (średnia ważona ruchem).
- **Historia i prognoza**: lata 2015–2025 to rekonstrukcja modelowa (trend + spadek w pandemii 2020–21), **nie pomiary**; 2026–2036 – prognoza z trendem i inwestycjami wariantu (wdrażane 2028–2030).
- **Inwestycje** zmieniają ruch na pobliskich odcinkach: osiedla dokładają podróże, zamknięcia przerzucają ruch na objazdy, nowe drogi przejmują ruch, P&R zatrzymuje auta przed centrum, linie komunikacji przejmują część podróży autem.
- **Hałas**: Lden przy jezdni z natężenia ruchu (−3 dB na podwojenie odległości), liczba osób narażonych powyżej zalecenia WHO (53 dB), kontrola normy 64 dB dla nowych osiedli; tramwaje z nowych linii.

To model szacunkowy do porównywania wariantów, nie symulacja mikroskopowa. Prawdziwe pomiary (np. Generalny Pomiar Ruchu GDDKiA, liczniki miejskie) mogą go w przyszłości skalibrować.

## Struktura

| Plik | Co robi |
|---|---|
| `src/data/miasta.js` | **Miasta**: obszar, centrum, nazwa w OSM, stacje GIOŚ, dane GUS; wybór aktywnego miasta |
| `src/data/queries.js` | Zapytania do OpenStreetMap (Overpass) dla wybranego miasta |
| `src/data/loadData.js` | Wczytywanie danych: plik → pamięć przeglądarki → Overpass; linie na przystankach |
| `src/data/convert.js` | Zamiana danych OSM na GeoJSON (linie komunikacji, strefy, punkty) |
| `src/data/torunBoundary.js` | Wbudowana uproszczona granica Torunia (zapas) |
| `src/model/config.js` | **Wszystkie założenia modelu** (liczby do poprawiania) |
| `src/model/simulate.js` | Skutki każdej inwestycji + analiza finansowa (NPV) |
| `src/model/traffic.js` | Model ruchu, zakorkowania i hałasu |
| `src/model/roads.js` | Automatyczne propozycje nowych dróg (graf sieci + objazdy) |
| `src/model/zones.js` | Strefy pracy i propozycje Park & Ride |
| `src/model/propozycje.worker.js`, `watek.js` | Liczenie propozycji dróg i P&R w osobnym wątku (Web Worker) |
| `src/model/network.js` | Graf ulic (drogi główne + lokalne) i prowadzenie tras po sieci |
| `src/model/stops.js` | Automatyczne i ręczne przystanki nowych linii |
| `src/data/official.js` | Dane GIOŚ (na żywo) i wartości referencyjne GUS / UM Toruń |
| `src/data/buildings.js` | Sprawdzanie kolizji proponowanych dróg z budynkami (Overpass) |
| `src/report/pdf.js` | Raport PDF wariantu z mapą |
| `src/components/CompareModal.jsx` | Okno porównania wariantów |
| `src/components/TrafficPanel.jsx` | Panel ruchu: godzina, rok, wykresy, warstwy |
| `src/components/TransitLayers.jsx`, `LinesPanel.jsx` | Linie, przystanki i parki z podświetlaniem |
| `src/components/` | Mapa, panele, rysowanie |

## Dane i licencje

- Dane mapy i obiektów: © OpenStreetMap contributors, licencja ODbL – podpis musi zostać widoczny na mapie.
- Kafelki `tile.openstreetmap.org` są OK do prototypu; przy większym ruchu trzeba przejść na innego dostawcę (zasady: https://operations.osmfoundation.org/policies/tiles/).
- Kolory linii komunikacji są umowne (OSM nie zawiera oficjalnych kolorów MZK).
- Do sprawdzenia w kolejnych wersjach: rozkłady MZK Toruń (GTFS), dane Geoportalu/MSIP Torunia, GUS/BDL (ludność), pomiary ruchu. Licencje i kompletność trzeba zweryfikować.

## Ograniczenia

- Wzory są uproszczone, a liczby w `config.js` to orientacyjne założenia, nie dane z badań.
- Ruch to model szacunkowy (bez rozkładu podróży i wyboru tras), a historia ruchu jest rekonstrukcją, nie pomiarem.
- Brak danych o pojemności szkół i rzeczywistym rozmieszczeniu ludności (używana średnia gęstość miasta).
- Nowe linie komunikacji z wariantu nie są jeszcze uwzględniane przy ocenie dostępu do przystanków dla osiedli i P&R z tego samego wariantu.
