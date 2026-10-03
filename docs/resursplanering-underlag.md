# Resursplanering – underlag (2026-10-04)

Användarens fristående HTML-verktyg, se `underlag/resursplanering_v3.html`. Ska bli en riktig flik.

## Vad verktyget gör i dag
- **Resurser** (personer) och **statusar** med färger, redigeras under Inställningar.
- **Projekt** med **aktiviteter** (start, slut, resurser, status, timmar) och underaktiviteter, skapade från aktivitetsmallar.
- Vyer: **tabell** (grupperad per projekt eller resurs, filter på resurs/status, sök), **Gantt** (zoom vecka/månad, baslinjer, milstolpar), **möten** och **anteckningar** per projekt.
- Export till Excel och PDF (klassiskt Gantt-schema).
- Sparar till en lokal fil och webbläsarens minne. Ingen delning mellan personer.

## Tanke för nya appen
- Resursplaneringen spänner över alla projekt: en egen vy utanför det enskilda projektet, kopplad till projekten i appen.
- Resurser = appens användare (plus externa resurser utan inloggning).
- Delad data i databasen med livesynk i stället för lokal fil.
