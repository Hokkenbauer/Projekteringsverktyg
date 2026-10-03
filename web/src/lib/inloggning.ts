import {
  InteractionRequiredAuthError,
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
        if (e instanceof InteractionRequiredAuthError) {
          await pca.acquireTokenRedirect({ scopes: [scope], account: konto });
        }
        throw e;
      }
    },
    loggaUt: () => {
      void pca.logoutRedirect({ account: konto });
    },
  };
}
