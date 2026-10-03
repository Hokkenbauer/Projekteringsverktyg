# Projekteringsverktyg

Webbaserad efterföljare till ProjektVerktyg 2.2 (Windows Forms). Flera personer kan arbeta i samma projekt samtidigt, och allt sparas i Azure.

- **Arkitektur, faser och beslut:** se dokumentet *Projekteringsverktyg – arkitektur, faser och beslut*.
- **Hur varje flik ska fungera:** se dokumentet *Flikbeskrivningar – Projekteringsverktyg*.

## Så hänger det ihop

```
webbläsare (React + TypeScript)  ──HTTPS + livesynk──▶  App Service (ASP.NET Core, .NET 10)
                                                          ├─ PostgreSQL       projektdata
                                                          ├─ Blob Storage     filer
                                                          ├─ Key Vault        hemligheter
                                                          └─ App Insights     fel och prestanda
inloggning: Microsoft Entra ID (jobbkonton)
publicering: GitHub Actions → testmiljön vid varje ändring på main
```

## Mappar

| Mapp | Innehåll |
| --- | --- |
| `web/` | Webbappen. `src/shell` navigering och teman, `src/grid` den gemensamma tabellmotorn, `src/features/<område>` en mapp per funktion, `src/lib` API, inloggning och livesynk. |
| `server/src/Projekteringsverktyg.Server/` | Servern. En mapp per område (`KomponentApi`, `ProjektApi`, `AnvandarApi`), `Data` för databasen, `Synk` för livesynken, `Auth` för inloggning. |
| `server/tests/` | Tester. |
| `infra/` | Skript som sätter upp Azure. |
| `.github/workflows/` | Bygge, test och publicering. |

## Komma igång i Azure (en gång per miljö)

1. Öppna [portal.azure.com](https://portal.azure.com) och klicka på Cloud Shell-ikonen `>_` högst upp. Välj **Bash**.
2. Ladda upp `infra/azure-setup-test.sh` (Hantera filer → Ladda upp) och kör:
   ```bash
   bash azure-setup-test.sh
   ```
3. Skriptet skriver ut fem värden. Lägg in dem i GitHub under **Settings → Secrets and variables → Actions → Variables**:
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_WEBAPP_NAME`.
4. Kör arbetsflödet **Bygg och publicera** igen (Actions → Bygg och publicera → Run workflow). Appen publiceras till testmiljön.

Om databasen nekas i Sweden Central (vissa nya prenumerationer får det), kör skriptet med en annan region för databasen:
`DB_LOCATION=northeurope bash azure-setup-test.sh`

## Köra lokalt (för utvecklare)

Kräver .NET 10 SDK, Node 22 och Docker.

```bash
docker compose up -d                         # lokal PostgreSQL
cd server/src/Projekteringsverktyg.Server
dotnet run                                   # servern på http://localhost:5080
cd web && npm install && npm run dev         # webbappen på http://localhost:5173
```

Lokalt används utvecklingsinloggning: du väljer själv namn uppe till höger, så kan du prova flera användare i olika webbläsarfönster.

## Att göra innan produktion

- Byt `EnsureCreated` mot EF Core-migreringar.
- Behörighet per projekt (medlemmar och roller). I dag ser alla inloggade i organisationen alla projekt.
- Produktionsmiljö (`prod`) med egen resursgrupp och godkännande innan publicering.
