#!/usr/bin/env bash
# =============================================================================
#  Projekteringsverktyg – sätter upp TESTMILJÖN i Azure
# =============================================================================
#  Körs i Azure Cloud Shell (Bash): portal.azure.com → ikonen >_ högst upp.
#  Ladda upp filen (Hantera filer → Ladda upp) och kör:   bash azure-setup-test.sh
#
#  Skriptet skapar:
#    1. Resursgruppen projekteringsverktyg-test i Sweden Central
#    2. Appserver (App Service), databas (PostgreSQL), fillagring, Key Vault
#       och övervakning (Application Insights)
#    3. Appregistrering för inloggning med era jobbkonton (Entra ID)
#    4. En identitet som låter GitHub publicera till testmiljön utan lösenord
#
#  Det går att köra om skriptet. Befintliga resurser uppdateras då i stället
#  för att dubbleras. OBS: databaslösenordet byts vid varje körning (det
#  sparas i Key Vault och appen hämtar det därifrån, så inget behöver göras).
# =============================================================================
set -euo pipefail

GITHUB_REPO="Hokkenbauer/Projekteringsverktyg"   # exakt som på GitHub, skiftlägeskänsligt
RG="projekteringsverktyg-test"
LOCATION="swedencentral"
DB_LOCATION="${DB_LOCATION:-$LOCATION}"    # kör med DB_LOCATION=northeurope om databasen nekas i Sweden Central
MILJO="test"
APP_REG_NAMN="Projekteringsverktyg (test)"
DEPLOY_REG_NAMN="Projekteringsverktyg GitHub-publicering (test)"

steg() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }

steg "Kontrollerar inloggning och prenumeration"
SUB_ID=$(az account show --query id -o tsv)
SUB_NAMN=$(az account show --query name -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
ok "Prenumeration: $SUB_NAMN ($SUB_ID)"
ok "Organisation (tenant): $TENANT_ID"

steg "Aktiverar de Azure-tjänster som behövs (kan ta några minuter första gången)"
for ns in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights; do
  az provider register --namespace "$ns" --wait --output none
  ok "$ns"
done

steg "Skapar resursgruppen $RG"
az group create --name "$RG" --location "$LOCATION" --output none
ok "$RG i $LOCATION"

# -----------------------------------------------------------------------------
steg "Appregistrering för inloggning: $APP_REG_NAMN"
APP_ID=$(az ad app list --display-name "$APP_REG_NAMN" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "$APP_REG_NAMN" --sign-in-audience AzureADMyOrg --query appId -o tsv)
  ok "Skapad: $APP_ID"
else
  ok "Finns redan: $APP_ID"
fi
APP_OBJ=$(az ad app show --id "$APP_ID" --query id -o tsv)
az ad sp show --id "$APP_ID" --output none 2>/dev/null || az ad sp create --id "$APP_ID" --output none

# -----------------------------------------------------------------------------
steg "Skapar appserver, databas, fillagring, Key Vault och övervakning (5–15 minuter)"
DB_LOSEN="Pv$(openssl rand -hex 16)!"
BICEP=$(mktemp --suffix=.bicep)
cat > "$BICEP" <<'BICEP_SLUT'
@description('Miljöns namn, t.ex. test eller prod.')
param miljo string
param location string = resourceGroup().location
@description('Region för databasen. Normalt samma som övriga, men kan behöva ändras om prenumerationen inte får skapa databaser i regionen.')
param dbLocation string = location
param entraTenantId string
param entraClientId string
@secure()
param dbLosenord string

var suffix = uniqueString(resourceGroup().id)
var namn = 'pv-${miljo}-${suffix}'
var dbNamn = 'projekteringsverktyg'
var dbAdmin = 'pvadmin'

resource logg 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namn}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insikter 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namn}'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logg.id }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${namn}'
  location: dbLocation
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: dbAdmin
    administratorLoginPassword: dbLosenord
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource dbDatabas 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: db
  name: dbNamn
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Släpper bara in trafik från tjänster i Azure (appservern), inte från internet i övrigt.
resource dbBrandvagg 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: db
  name: 'TillatAzureTjanster'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource lagring 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('stpv${miljo}${suffix}', 24)
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobTjanst 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: lagring
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}

resource projektfiler 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobTjanst
  name: 'projektfiler'
}

resource valv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-pv-${miljo}-${suffix}', 24)
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource dbHemlighet 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: valv
  name: 'db-anslutning'
  properties: {
    value: 'Host=${db.properties.fullyQualifiedDomainName};Port=5432;Database=${dbNamn};Username=${dbAdmin};Password=${dbLosenord};Ssl Mode=Require'
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${namn}'
  location: location
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-${namn}'
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      webSocketsEnabled: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
        { name: 'AzureAd__Instance', value: environment().authentication.loginEndpoint }
        { name: 'AzureAd__TenantId', value: entraTenantId }
        { name: 'AzureAd__ClientId', value: entraClientId }
        { name: 'ConnectionStrings__Projekt', value: '@Microsoft.KeyVault(SecretUri=${dbHemlighet.properties.secretUri})' }
        { name: 'Lagring__BlobUrl', value: lagring.properties.primaryEndpoints.blob }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insikter.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
      ]
    }
  }
}

// Appen får läsa hemligheter i Key Vault och läsa/skriva projektfiler, utan lösenord.
resource appLaserHemligheter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: valv
  name: guid(valv.id, app.id, 'kv-secrets-user')
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource appSkriverFiler 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: lagring
  name: guid(lagring.id, app.id, 'blob-data-contributor')
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

output appNamn string = app.name
output appAdress string = app.properties.defaultHostName
output dbServer string = db.name
BICEP_SLUT

UTDATA=$(az deployment group create \
  --resource-group "$RG" \
  --name "projekteringsverktyg-$(date +%Y%m%d%H%M%S)" \
  --template-file "$BICEP" \
  --parameters miljo="$MILJO" dbLocation="$DB_LOCATION" entraTenantId="$TENANT_ID" entraClientId="$APP_ID" dbLosenord="$DB_LOSEN" \
  --query properties.outputs -o json)
rm -f "$BICEP"
APP_NAMN=$(echo "$UTDATA" | jq -r .appNamn.value)
APP_ADRESS=$(echo "$UTDATA" | jq -r .appAdress.value)
ok "Appserver: https://$APP_ADRESS"

# -----------------------------------------------------------------------------
steg "Kopplar inloggningen till appens adress"
SCOPE_ID=$(az ad app show --id "$APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
[ -z "$SCOPE_ID" ] && SCOPE_ID=$(cat /proc/sys/kernel/random/uuid)

az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" \
  --headers "Content-Type=application/json" \
  --body "$(cat <<JSON
{
  "identifierUris": ["api://$APP_ID"],
  "spa": { "redirectUris": ["https://$APP_ADRESS", "http://localhost:5173"] },
  "api": {
    "requestedAccessTokenVersion": 2,
    "oauth2PermissionScopes": [{
      "id": "$SCOPE_ID",
      "value": "access_as_user",
      "type": "User",
      "isEnabled": true,
      "adminConsentDisplayName": "Använda Projekteringsverktyg",
      "adminConsentDescription": "Låter appen anropa Projekteringsverktygets API som den inloggade användaren.",
      "userConsentDisplayName": "Använda Projekteringsverktyg",
      "userConsentDescription": "Låter appen anropa Projekteringsverktygets API som du."
    }]
  }
}
JSON
)"
# Webbappen är samma registrering, så den godkänns i förväg och ingen fråga om samtycke visas.
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$APP_OBJ" \
  --headers "Content-Type=application/json" \
  --body "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$APP_ID\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}"
ok "Inloggning via https://$APP_ADRESS och http://localhost:5173"

# -----------------------------------------------------------------------------
steg "Identitet för publicering från GitHub: $DEPLOY_REG_NAMN"
DEPLOY_ID=$(az ad app list --display-name "$DEPLOY_REG_NAMN" --query "[0].appId" -o tsv)
if [ -z "$DEPLOY_ID" ]; then
  DEPLOY_ID=$(az ad app create --display-name "$DEPLOY_REG_NAMN" --sign-in-audience AzureADMyOrg --query appId -o tsv)
fi
DEPLOY_SP=$(az ad sp show --id "$DEPLOY_ID" --query id -o tsv 2>/dev/null || az ad sp create --id "$DEPLOY_ID" --query id -o tsv)

FED_NAMN="github-${MILJO}"
if ! az ad app federated-credential list --id "$DEPLOY_ID" --query "[?name=='$FED_NAMN'].name" -o tsv | grep -q .; then
  az ad app federated-credential create --id "$DEPLOY_ID" --parameters "{
    \"name\": \"$FED_NAMN\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GITHUB_REPO}:environment:${MILJO}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" --output none
fi

RG_ID=$(az group show --name "$RG" --query id -o tsv)
for i in 1 2 3 4 5 6; do
  if az role assignment create --assignee-object-id "$DEPLOY_SP" --assignee-principal-type ServicePrincipal \
       --role "Website Contributor" --scope "$RG_ID" --output none 2>/dev/null; then break; fi
  sleep 10  # den nya identiteten kan behöva några sekunder innan den syns
done
ok "GitHub får publicera till $RG"

# -----------------------------------------------------------------------------
cat <<KLART

=============================================================================
  KLART. Lägg nu in dessa fem värden i GitHub:
  github.com/${GITHUB_REPO} → Settings → Secrets and variables → Actions
  → fliken Variables → New repository variable (en i taget)
=============================================================================

  AZURE_CLIENT_ID        $DEPLOY_ID
  AZURE_TENANT_ID        $TENANT_ID
  AZURE_SUBSCRIPTION_ID  $SUB_ID
  AZURE_RESOURCE_GROUP   $RG
  AZURE_WEBAPP_NAME      $APP_NAMN

  Appens adress: https://$APP_ADRESS
  (Den svarar först när GitHub har publicerat appen dit.)

  Skicka gärna den här rutan till Claude, så kontrolleras att allt stämmer.
=============================================================================
KLART
