# Instruktioner för Claude i det här repot

- Projektet är en ombyggnad av ProjektVerktyg 2.2 (WinForms) till webbapp. Användaren är inte utvecklare: förklara på svenska, i vardagsspråk.
- Allt användaren ser (UI-text, felmeddelanden, README) är på svenska. Kod: svenska namn på domänbegrepp (Komponent, Projekt, Egenkontroll), engelska för tekniska standardbegrepp.
- **Komponenter är navet.** Listor (Skyltlista, Installationslista, Egenkontroll m.fl.) lagrar bara egna fält och pekar på komponentens Id. Kopiera aldrig beteckning, placering m.m.
- Nya tabellflikar byggs med den gemensamma tabellmotorn i `web/src/grid/DataGrid.tsx`, inte med egen tabellkod.
- Varje ändring av projektdata ska loggas i ändringsloggen (`ProjektApi/Andringslogg.cs`) och skickas ut via livesynken (`Synk/ProjektHub.cs`).
- Ingen AI-modell i programmet (beslut). PDF skapas från HTML, inte med QuestPDF.
- .NET SDK finns inte i Claudes miljö: servern byggs och testas av GitHub Actions. Kontrollera körningen med `gh run list` efter push.
- Webben byggs lokalt med `cd web && npm run build` innan push.
- Projektets dokument i claude.ai-projektet *Projekteringsverktyg* (01 Projektöversikt, 02 Beslut och regler, 03 Status och att göra, 04 Drift och Azure) beskriver beslut och läge. Läs dem i början av en ny chatt och uppdatera 02/03 när något stort beslutas eller byggs.
- **Roller i två nivåer:** verktygsroll (Admin, Intern, Extern) och projektroll per projekt (Projektledare, Tekniker, Läsare). Kontrollera behörighet med `Behorighet.KanLasa/KanSkriva/KanLedaProjekt/KanSkapaProjekt/KanAndraMallar` – aldrig med en global roll för projektdata. Ägarens konto får aldrig kunna ändras, och bara ägaren utser Admin.
- **Utskrifter** (utom driftkort och funktionstexter) byggs med `web/src/lib/dokumenttema.ts` (`oppnaDokument`, `tabellHtml`, `formHtml`). Ej valt datum ska vara helt tomt i utskrift och export.
- Databasändringar: ny fil `Data/Migreringar/NNN_namn.sql` med nästa nummer. Ändra aldrig en fil som redan publicerats.
