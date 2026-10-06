#!/usr/bin/env bash
# =============================================================================
# Egen webbadress för testmiljön, t.ex. https://projektering.hecoab.se
#
# Körs i Azure Cloud Shell (Bash):
#
#   bash egen-doman.sh steg1   -> visar de två DNS-poster du lägger in hos one.com
#   bash egen-doman.sh steg2   -> (när DNS-posterna slagit igenom) kopplar adressen
#                                 till appen och beställer ett gratis SSL-certifikat,
#                                 sedan körs steg3 automatiskt
#   bash egen-doman.sh steg3   -> väntar in certifikatet, kopplar det (https) och
#                                 godkänner adressen i Microsoft-inloggningen.
#                                 Kan köras om hur många gånger som helst.
#
# Vill du ha ett annat namn: ändra DOMAN nedan (samma i alla steg).
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
  echo ""
  echo "Lägg in de här två posterna under DNS-inställningar för hecoab.se hos one.com:"
  echo ""
  echo "  CNAME   Värdnamn: $UNDERDOMAN          Pekar på: $APP.azurewebsites.net"
  echo "  TXT     Värdnamn: asuid.$UNDERDOMAN    Värde:    $id"
  echo ""
  echo "Kontrollera med:  nslookup $DOMAN"
  echo "När svaret innehåller $APP.azurewebsites.net kör du:  bash egen-doman.sh steg2"
  echo ""
}

steg2() {
  echo "Kopplar $DOMAN till appen…"
  az webapp config hostname add --webapp-name "$APP" -g "$RG" --hostname "$DOMAN" --output none

  echo "Beställer gratis SSL-certifikat. Azure skapar det i bakgrunden (oftast 2–10 minuter)…"
  az webapp config ssl create -g "$RG" -n "$APP" --hostname "$DOMAN" --output none 2>/dev/null || true

  steg3
}

steg3() {
  echo "Väntar på certifikatet (kollar var 15:e sekund, högst 10 minuter)…"
  local tp=""
  for _ in $(seq 1 40); do
    tp=$(az webapp config ssl show -g "$RG" --certificate-name "$DOMAN" --query thumbprint -o tsv 2>/dev/null || true)
    [ -n "$tp" ] && break
    sleep 15
  done
  if [ -z "$tp" ]; then
    echo "Certifikatet är inte klart än. Vänta några minuter och kör:  bash egen-doman.sh steg3"
    exit 1
  fi
  az webapp config ssl bind -g "$RG" -n "$APP" --certificate-thumbprint "$tp" --ssl-type SNI --output none
  echo "Certifikatet är kopplat (https)."

  echo "Lägger till https://$DOMAN i Microsoft-inloggningen…"
  local objekt nuvarande nya
  objekt=$(az ad app show --id "$INLOGGNINGSAPP" --query id -o tsv)
  nuvarande=$(az ad app show --id "$INLOGGNINGSAPP" --query "spa.redirectUris" -o json)
  nya=$(echo "$nuvarande" | jq -c --arg u "https://$DOMAN" '(. // []) + [$u] | unique')
  az rest --method PATCH \
    --uri "https://graph.microsoft.com/v1.0/applications/$objekt" \
    --headers "Content-Type=application/json" \
    --body "{\"spa\":{\"redirectUris\":$nya}}" --output none

  echo ""
  echo "Klart. Öppna https://$DOMAN"
  echo "(Den gamla adressen $APP.azurewebsites.net fungerar fortfarande.)"
  echo ""
}

case "${1:-}" in
  steg1) steg1 ;;
  steg2) steg2 ;;
  steg3) steg3 ;;
  *) echo "Använd: bash egen-doman.sh steg1 | steg2 | steg3"; exit 1 ;;
esac
