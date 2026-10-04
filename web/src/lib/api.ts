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
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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

/** Hämtar en fil från API:t (med inloggning) och sparar den på datorn. */
export async function laddaNer(sokvag: string, reservnamn: string): Promise<void> {
  const headers = new Headers();
  if (tokenKalla) headers.set("Authorization", `Bearer ${await tokenKalla()}`);
  const svar = await fetch(sokvag, { headers });
  if (!svar.ok) throw new ApiFel(svar.status, null, `Fel ${svar.status} vid nedladdning`);
  const dispo = svar.headers.get("Content-Disposition") ?? "";
  const utf8 = dispo.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const vanligt = dispo.match(/filename="?([^";]+)"?/i)?.[1];
  const namn = utf8 ? decodeURIComponent(utf8) : vanligt ?? reservnamn;
  const url = URL.createObjectURL(await svar.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = namn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hämtar en fil från API:t (med inloggning) som rå bytes. */
export async function hamtaBinar(sokvag: string): Promise<ArrayBuffer> {
  const headers = new Headers();
  if (tokenKalla) headers.set("Authorization", `Bearer ${await tokenKalla()}`);
  const svar = await fetch(sokvag, { headers });
  if (!svar.ok) throw new ApiFel(svar.status, null, `Fel ${svar.status} vid hämtning`);
  return svar.arrayBuffer();
}
