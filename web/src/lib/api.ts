export class ApiFel extends Error {
  constructor(
    public status: number,
    public data: unknown,
    meddelande: string,
  ) {
    super(meddelande);
  }
}

let tokenKalla: (() => Promise<string>) | null = null;

export function sattTokenKalla(kalla: () => Promise<string>) {
  tokenKalla = kalla;
}

export async function api<T>(sokvag: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (tokenKalla) headers.set("Authorization", `Bearer ${await tokenKalla()}`);

  const svar = await fetch(sokvag, { ...init, headers });
  if (svar.status === 204) return undefined as T;

  const text = await svar.text();
  const data = text ? safeJson(text) : undefined;
  if (!svar.ok) {
    const meddelande =
      (data as { meddelande?: string; title?: string } | undefined)?.meddelande ??
      (data as { title?: string } | undefined)?.title ??
      `Fel ${svar.status}`;
    throw new ApiFel(svar.status, data, meddelande);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const skicka = (data: unknown) => JSON.stringify(data);
