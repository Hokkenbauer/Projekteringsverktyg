#!/usr/bin/env bash
# =============================================================================
# Säkerhetskopior inför skarp drift (t.ex. Karlsängskolan).
#
# Körs i Azure Cloud Shell (Bash):   bash sakerhetskopior.sh
#
#  1. Databasen: automatiska säkerhetskopior sparas i 35 dagar (största möjliga)
#     i stället för 7. Man kan då återställa databasen till valfri minut de
#     senaste 35 dagarna.
#  2. Projektfilerna: varje ändrad eller borttagen fil sparas som en äldre
#     version i 30 dagar (utöver papperskorgen som redan finns).
#  3. Visar hur det ser ut efteråt.
#
# Kan köras om hur många gånger som helst. Kostnaden är liten (lagring av
# säkerhetskopior och äldre filversioner).
# =============================================================================
set -euo pipefail

RG="projekteringsverktyg-test"

steg() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }

steg "Letar upp databasen och fillagringen"
DB=$(az postgres flexible-server list -g "$RG" --query "[0].name" -o tsv)
SA=$(az storage account list -g "$RG" --query "[0].name" -o tsv)
[ -n "$DB" ] || { echo "Hittade ingen databas i $RG"; exit 1; }
[ -n "$SA" ] || { echo "Hittade ingen fillagring i $RG"; exit 1; }
ok "Databas: $DB"
ok "Fillagring: $SA"

steg "Databasens säkerhetskopior sparas i 35 dagar"
az postgres flexible-server update -g "$RG" -n "$DB" --backup-retention 35 -o none
ok "Klart"

steg "Projektfilerna får versionshistorik och papperskorg i 30 dagar"
az storage account blob-service-properties update -g "$RG" -n "$SA" \
  --enable-versioning true \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30 -o none
ok "Klart"

steg "Så här ser det ut nu"
az postgres flexible-server show -g "$RG" -n "$DB" --query "{databas:name, sakerhetskopiorDagar:backup.backupRetentionDays, aldstaAterstallning:backup.earliestRestoreDate}" -o table
az storage account blob-service-properties show -g "$RG" -n "$SA" --query "{versioner:isVersioningEnabled, papperskorgDagar:deleteRetentionPolicy.days}" -o table
echo ""
echo "Klart. Behöver något återställas: säg till, så tar vi det tillsammans."
