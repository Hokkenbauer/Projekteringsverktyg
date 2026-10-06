#!/usr/bin/env bash
# =============================================================================
# Egen webbadress för testmiljön, t.ex. https://projektering.hecoab.se
#
# Körs i Azure Cloud Shell (Bash) i två steg:
#
#   bash egen-doman.sh steg1   -> visar de två DNS-poster du lägger in hos one.com
#   bash egen-doman.sh steg2   -> (när DNS-posterna slagit igenom) kopplar adressen
#                                 till appen, skapar ett gratis SSL-certifikat och
#                                 lägger till adressen i Microsoft-inloggningen
#
# Vill du ha ett annat namn: ändra DOMAN nedan (samma i båda stegen).
# =============================================================================
set -euo pipefail

DOMAN="projektering.hecoab.se"
RG="projekteringsverktyg-test"
APP="app-pv-test-ri7kensrhyf3o"
INLOGGNINGSAPP="6695edf8-9518-4dbf-971a-c14c1c2a714d"

UNDERDOMAN="${DOMAN%%.*}"   # "projektering"

steg1() {
  local id
  id=$(az webapp show -g "$RG" -n "$APP" --query customDomainVerificationId -o tsv)
  cat <<EOF

Lägg in de här två posterna under DNS-inställningar för hecoab.se hos one.com:

  Typ:    CNAME
  Namn:   $UNDERDOMAN
  Pekar på: $APP.azurewebsites.net

  Typ:    TXT
  Namn:   asuid.$UNDERDOMAN
  Värde:  $id

Det kan ta från några minuter upp till några timmar innan de slår igenom.
Kontrollera med:   nslookup $DOMAN
När svaret innehåller $APP.azurewebsites.net kör du:   bash egen-doman.sh steg2

EOF
}

steg2() {
  echo "Kopplar $DOMAN till appen…"
  az webapp config hostname add --webapp-name "$APP" -g "$RG" --hostname "$DOMAN" --output none

  echo "Skapar gratis SSL-certifikat (kan ta ett par minuter)…"
  local tp
  tp=$(az webapp config ssl create -g "$RG" -n "$APP" --hostname "$DOMAN" --query thumbprint -o tsv)
  az webapp config ssl bind -g "$RG" -n "$APP" --certificate-thumbprint "$tp" --ssl-type SNI --output none

  echo "Lägger till https://$DOMAN i Microsoft-inloggningen…"
  local objekt nuvarande nya
  objekt=$(az ad app show --id "$INLOGGNINGSAPP" --query id -o tsv)
  nuvarande=$(az ad app show --id "$INLOGGNINGSAPP" --query "spa.redirectUris" -o json)
  nya=$(echo "$nuvarande" | jq -c --arg u "https://$DOMAN" '(. // []) + [$u] | unique')
  az rest --method PATCH \
    --uri "https://graph.microsoft.com/v1.0/applications/$objekt" \
    --headers "Content-Type=application/json" \
    --body "{\"spa\":{\"redirectUris\":$nya}}" --output none

  cat <<EOF

Klart. Öppna https://$DOMAN
(Den gamla adressen $APP.azurewebsites.net fungerar fortfarande.)

EOF
}

case "${1:-}" in
  steg1) steg1 ;;
  steg2) steg2 ;;
  *) echo "Använd: bash egen-doman.sh steg1   eller   bash egen-doman.sh steg2"; exit 1 ;;
esac
