# Instruktioner för Claude i det här repot

- Projektet är en ombyggnad av ProjektVerktyg 2.2 (WinForms) till webbapp. Användaren är inte utvecklare: förklara på svenska, i vardagsspråk.
- Allt användaren ser (UI-text, felmeddelanden, README) är på svenska. Kod: svenska namn på domänbegrepp (Komponent, Projekt, Egenkontroll), engelska för tekniska standardbegrepp.
- **Komponenter är navet.** Listor (Skyltlista, Installationslista, Egenkontroll m.fl.) lagrar bara egna fält och pekar på komponentens Id. Kopiera aldrig beteckning, placering m.m.
- Nya tabellflikar byggs med den gemensamma tabellmotorn i `web/src/grid/DataGrid.tsx`, inte med egen tabellkod.
- Varje ändring av projektdata ska loggas i ändringsloggen (`ProjektApi/Andringslogg.cs`) och skickas ut via livesynken (`Synk/ProjektHub.cs`).
- Ingen AI-modell i programmet (beslut). PDF skapas från HTML, inte med QuestPDF.
- .NET SDK finns inte i Claudes miljö: servern byggs och testas av GitHub Actions. Kontrollera körningen med `gh run list` efter push.
- Webben byggs lokalt med `cd web && npm run build` innan push.
