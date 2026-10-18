# Driftkortsmallar – HECO:s historiska flödesbilder

Här finns HECO:s egna driftkort från tidigare projekt (PDF, vektor) och verktygen som Claude använder för att ta fram nya flödesbilder (IO-bilder) till Ritbordet i Projekteringsverktyget.

**Metod (gäller från 2026-10-18):**
1. Flödesbilden byggs på en mall ur Ritbordets bibliotek (*Ritbord › Bibliotek › Mallar*, Ritmall 1.1: Stena, N&N, CMC, Arboga, Futurum, Örebroporten). Välj den mall vars rör, kanaler, växlare och rum liknar systemet mest. Mallens egna symboler (ventiler, givare) tas bort.
2. Komponenterna ritas med symboler ur *Ritbord › Bibliotek › Symboler* och får Karlsängskolans/projektets beteckningar.
3. I/O-strecken dras som i HECO:s historiska driftkort (PDF:erna nedan): kort vågrät bit vid symbolen (givare åt höger, ventilställdon åt vänster), sedan **rakt ner** till AS-linjen och raden. Pumpar och mätare går rakt ner från symbolen. Ett streck per signal, cirka 3 px mellan parallella streck, aldrig två streck på samma x och aldrig fram och tillbaka. Placera symbolerna så att lägre symboler inte hamnar i ett streck från en högre.
4. Topologin hämtas ur projektets VS/VE-underlag.

De historiska PDF:erna används som facit för *hur* I/O-strecken dras och vad som visas (prefab-aggregat med Internstyr, DK1 Generella, VAV-blad).

## Mallar

| Mall | Visar | Använd för |
| --- | --- | --- |
| `samling-1/*/DK1 Generella*.pdf` | Utegivare, MQxx/GTxx, larm med lodrät text och förkortningsruta (AUT, OMK, CBL), MOXA, PLC, stadsnät | DK1 Generella per DUC |
| `samling-2/DK1 Generella.pdf` | Variant med SW01, larmrutor AL01–AL06, LB-rutor, SIOX | DK1 med switch/larmenheter |
| `samling-2/DK2 VP01VS01VV01.pdf` | Primär (FJV/VP) → VVX → VS01, VVX → VV01/VVC01, KV01 med mätare | Undercentral värme och tappvatten |
| `samling-1/AS01/DK2VS01.pdf`, `samling-1/AS01/DK2 VSAGGREGAT.pdf` | VS01-central, VS-grenar till aggregatens värmebatterier | VS-fördelning till LB |
| `samling-1/*/DK3 VS11.pdf`, `samling-2/DK2 VS11.pdf` | Shuntgrupp med radiatorer, golvvärmeslinga | VS21/VS31 m.fl. |
| `samling-1/*/DK4 VV.pdf`, `samling-1/P1/DK3 P1-AL01 VV.pdf` | Varmvattenberedare (VVB) | VV, tank/ackumulator |
| `samling-2/DK5 FLV.pdf` | Fläktluftvärmare/-kylare i rum med ventil och givare | Luftridåer, FLK, fläktkonvektorer |
| `samling-1/AS01/DK3 FF101.pdf`, `samling-2/DK6 FF01.pdf`, `samling-1/AS01/DK4 BGF.pdf` | Frånluftsfläkt i rum med fläktvakt och rumsgivare | KF/FF-fläktar |
| `samling-2/DK4 LB02.pdf`, `samling-2/DK3 LB01.pdf`, `samling-1/*/DK2 LB0x.pdf` | Prefabricerat aggregat med Internstyr, Centralt Brandlarm, Modbus TCP/IP | LB-aggregat |
| `samling-1/H1/DK2 LB01_4.pdf` (m.fl. `_1`–`_10`) | VAV-rum: ST401/ST402, GT501, GN501, RC101 till Modbus, 3 rum per blad | VAV-blad per plan |
| `samling-2/DK3 LB01_R*.pdf`, `samling-2/DK4 LB02 R*.pdf` | VAV-rum med AL-regulatorer, SW01, TCP/IP LAN | VAV med IP-regulatorer |
| `samling-1/G/DK2 LB01_1.pdf`, `_2` | KTD-/VAV-spjäll i rum | Spjäll på lodrät kanal |

## Verktyg (`verktyg/`)

Kräver Python 3 med `pymupdf` (och `cairosvg` för granskningsbilder).

- `pdfmall.py` – läser en historisk PDF till Ritbord-data. Klassar AS-linje och I/O-rader (tas bort, driftkortsmallen ritar dem), I/O-streck (lagret I/O) och resten (Flödesbild). Har funktioner för att byta text (`byt`, `byt_inom`), ta bort (`bort_ruta`, `bort_text`, `bort_exakt`), kopiera symboler (`kopiera`, `importera`), byta färg (`farga`), korta rör (`ersatt_ror`) och lägga till text, rutor och I/O-streck (`ny_text`, `ny_rekt`, `larm`, `ny_io`, `ny_streck`). `data(skap, namn)` ger färdig Ritbord-data med driftkortsmallen.
- `ritbordbas.py` – objektformat och driftkortsmall (samma värden som `rbDriftkortMall()` i Ritbordet).
- `rutnat.py` – renderar en PDF med pt-rutnät, för att hitta koordinater.
- `symbbox.py` – hittar en symbols yttermått i en PDF.
- `granska.py` – renderar Ritbord-data till PNG för kontroll.
- `mallverk.py` – läser en mall ur Ritmall 1.1, tar bort delar (`bort`, `bort_text`), byter text, beskär och visar mallen med rutnät i mallens koordinater (för att placera symboler).
- `rit3.py` – bygger driftkortsbilden: mall, symboler ur symbolbiblioteket (`symboler.json`), texter, ramar, larmrutor och automatisk I/O-dragning enligt reglerna ovan.
- `exempel_karlsangskolan_mallar.py` – **gällande exempel**: Karlsängskolans 29 bilder på biblioteksmallar.
- `exempel_karlsangskolan.py` – äldre försök (urklipp ur historiska PDF:er), behålls som referens. Tidigare bilder: DK1 Generella, värmepumpar med ackumulator, FJV/VS/VV, kyla, shuntgrupper, FLV/FLK, frånluftsfläktar, LB01–LB03 och VAV-blad.

Bilderna levereras i projektfilen (`projekt.json`, `ritbord[]`) och läses in som nytt projekt eller med *Komplettera från fil*.
