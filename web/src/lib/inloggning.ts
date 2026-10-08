import {
  AuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

export type AppConfig = {
  version: string;
  auth: { clientId: string; tenantId: string; scope: string } | null;
};

export type Inloggning = {
  /** Hämtar en giltig token för API:t och livesynken. */
  hamtaToken: () => Promise<string>;
  /** Läge utan Entra ID, bara lokalt: användaren väljer namn själv. */
  utvecklingslage: boolean;
  loggaUt: () => void;
};

const DEV_NYCKEL = "pv-dev-anvandare";

export function devAnvandare(): string {
  try {
    return localStorage.getItem(DEV_NYCKEL) || "Utvecklare";
  } catch {
    return "Utvecklare";
  }
}

export function sattDevAnvandare(namn: string) {
  try {
    localStorage.setItem(DEV_NYCKEL, namn);
  } catch {
    /* ignoreras */
  }
}

/**
 * Loggar in användaren. Med Entra ID skickas man till Microsofts inloggning
 * och tillbaka; funktionen returnerar då null medan omdirigeringen pågår.
 */
export async function loggaIn(config: AppConfig): Promise<Inloggning | null> {
  if (!config.auth) {
    return {
      hamtaToken: async () => devAnvandare(),
      utvecklingslage: true,
      loggaUt: () => location.reload(),
    };
  }

  const { clientId, tenantId, scope } = config.auth;
  const pca = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: "localStorage" },
    // Den tysta förnyelsen i bakgrunden ger upp snabbare, så att vi i stället kan skicka
    // användaren till inloggningen (Brave, VPN m.m. kan stoppa den tysta varianten).
    system: { iframeBridgeTimeout: 6000 },
  });
  await pca.initialize();

  const svar = await pca.handleRedirectPromise();
  let konto: AccountInfo | undefined = svar?.account ?? pca.getAllAccounts()[0];
  if (!konto) {
    await pca.loginRedirect({ scopes: [scope] });
    return null;
  }
  pca.setActiveAccount(konto);

  return {
    utvecklingslage: false,
    hamtaToken: async () => {
      konto = pca.getActiveAccount() ?? konto;
      try {
        const r = await pca.acquireTokenSilent({ scopes: [scope], account: konto! });
        return r.accessToken;
      } catch (e) {
        // Inloggningen har gått ut (efter ungefär ett dygn) och kunde inte förnyas tyst. Skicka
        // användaren till Microsofts inloggning i stället för att visa ett fel. Nätverksfel visas som fel.
        if (e instanceof AuthError && !arNatverksfel(e) && !nyssOmdirigerad()) {
          markeraOmdirigering();
          await pca.acquireTokenRedirect({ scopes: [scope], account: konto });
          return new Promise<string>(() => { /* sidan lämnas för inloggningen */ });
        }
        if (e instanceof AuthError && e.errorCode === "timed_out") {
          throw new Error("Inloggningen hos Microsoft svarade inte i tid. Är du ansluten via VPN? Prova att koppla ner den, eller klicka på Logga in igen.");
        }
        throw e;
      }
    },
    loggaUt: () => {
      void pca.logoutRedirect({ account: konto });
    },
  };
}

const OMDIRIGERAD = "pv-inloggning-omdirigerad";

function arNatverksfel(e: AuthError): boolean {
  return /network|endpoints_resolution|no_network/i.test(e.errorCode ?? "");
}

/** Skydd mot en evig loop av omdirigeringar om något är fel med inloggningen. */
function nyssOmdirigerad(): boolean {
  try { return Date.now() - Number(sessionStorage.getItem(OMDIRIGERAD) || 0) < 30_000; } catch { return false; }
}

function markeraOmdirigering() {
  try { sessionStorage.setItem(OMDIRIGERAD, String(Date.now())); } catch { /* ignoreras */ }
}

/** Tömmer den sparade inloggningen och laddar om, så att man loggar in från början. */
export function loggaInIgen() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("msal.") || k.includes("login.windows.net") || k.includes("login.microsoftonline.com")) localStorage.removeItem(k);
    sessionStorage.removeItem(OMDIRIGERAD);
  } catch { /* ignoreras */ }
  location.reload();
}
