import type { Komponent } from "./typer";

/**
 * Gateways och anslutningskedjan (samma regler som serverns KomponentApi/Gateways.cs).
 *
 * En gateway är en komponent med komponenttyp "Gateway". Gatewaytypen (t.ex. GW-MB-RTU) och portarna
 * (slingorna) står i komponentens inställningar. Komponenter ansluts med fältet Ansluts till:
 *  - till ett skåp (AS01): signalerna landar i skåpets I/O,
 *  - till en gatewayport (GW-MB-RTU1-Port1): enheten sitter på den slingan,
 *  - till en annan komponent (t.ex. en RC): signalen går till RC:n, och RC:n är i sin tur ansluten vidare.
 * Kedjan räknas fram, inget kopieras.
 */

export const GATEWAY_KOMPONENTTYP = "Gateway";

/** Gatewaytyper. Fler läggs till här (t.ex. GW-BAC-RTU för BACnet MS/TP). */
export const GATEWAYTYPER: { kod: string; namn: string; protokoll: string; maxPerPort: number }[] = [
  { kod: "GW-MB-RTU", namn: "Modbus RTU → TCP", protokoll: "Modbus RTU", maxPerPort: 32 },
  { kod: "GW-BAC-RTU", namn: "BACnet MS/TP → IP", protokoll: "BACnet", maxPerPort: 32 },
];

export type GatewayPort = { namn: string; tcpPort: string; baudrate: string; paritet: string; databitar: string; stopbit: string };
export type GatewayInstallningar = { typ: string; ip: string; portar: GatewayPort[] };

export const nyPort = (n: number, forra?: GatewayPort): GatewayPort => ({
  namn: `Port${n}`, tcpPort: String(1500 + n),
  baudrate: forra?.baudrate ?? "9600", paritet: forra?.paritet ?? "Even", databitar: forra?.databitar ?? "8", stopbit: forra?.stopbit ?? "1",
});

export const arGateway = (k: Komponent) => k.komponenttyp.trim().toLowerCase() === GATEWAY_KOMPONENTTYP.toLowerCase();

export function lasGateway(k: Komponent): GatewayInstallningar {
  let g: Partial<GatewayInstallningar> = {};
  try { if (k.installningar?.trim()) g = JSON.parse(k.installningar) as Partial<GatewayInstallningar>; } catch { g = {}; }
  const portar = (Array.isArray(g.portar) ? g.portar : []).filter(Boolean).map((p, i) => ({ ...nyPort(i + 1), ...p }));
  return { typ: g.typ || "GW-MB-RTU", ip: g.ip ?? "", portar: portar.length ? portar : [nyPort(1)] };
}

export const gatewaytyp = (kod: string) => GATEWAYTYPER.find((t) => t.kod === kod) ?? GATEWAYTYPER[0]!;

/** Standardinställningar för en ny gateway (4 portar, som en MOXA MGate). */
export const nyGateway = (antalPortar = 4): GatewayInstallningar =>
  ({ typ: "GW-MB-RTU", ip: "", portar: Array.from({ length: antalPortar }, (_, i) => nyPort(i + 1)) });

/** Nästa lediga beteckning: GW-MB-RTU1, GW-MB-RTU2 … */
export function nastaGatewayBeteckning(typ: string, komponenter: Komponent[]) {
  const finns = new Set(komponenter.map((k) => k.beteckning.trim().toUpperCase()));
  for (let n = 1; ; n++) if (!finns.has(`${typ}${n}`.toUpperCase())) return `${typ}${n}`;
}

/** "9600 8E1" */
export function installning(p: GatewayPort) {
  if (!p.baudrate?.trim()) return "";
  const par = ({ EVEN: "E", ODD: "O", NONE: "N", MARK: "M", SPACE: "S" } as Record<string, string>)[p.paritet.trim().toUpperCase()] ?? p.paritet.trim().slice(0, 1);
  return `${p.baudrate.trim()} ${p.databitar?.trim() || "8"}${par}${p.stopbit?.trim() || "1"}`;
}

export const portNamn = (gw: Komponent, p: GatewayPort) => `${gw.beteckning.trim()}-${p.namn.trim()}`;

export type Port = { gateway: Komponent; port: GatewayPort; namn: string };

/** Alla gatewayportar i projektet. */
export function allaPortar(komponenter: Komponent[]): Port[] {
  return komponenter.filter(arGateway).filter((g) => g.beteckning.trim())
    .flatMap((g) => lasGateway(g).portar.map((p) => ({ gateway: g, port: p, namn: portNamn(g, p) })));
}

/** Snabbt uppslag, byggs en gång per komponentlista. */
export class Anslutningar {
  private perBeteckning = new Map<string, Komponent>();
  private portar = new Map<string, Port>();
  readonly barn = new Map<string, Komponent[]>();

  constructor(readonly komponenter: Komponent[]) {
    for (const k of komponenter) if (k.beteckning.trim()) this.perBeteckning.set(k.beteckning.trim().toLowerCase(), k);
    for (const p of allaPortar(komponenter)) this.portar.set(p.namn.toLowerCase(), p);
    // "GW-MB-RTU1" utan port = första porten.
    for (const g of komponenter.filter(arGateway)) {
      const forsta = lasGateway(g).portar[0];
      if (forsta && g.beteckning.trim() && !this.portar.has(g.beteckning.trim().toLowerCase()))
        this.portar.set(g.beteckning.trim().toLowerCase(), { gateway: g, port: forsta, namn: portNamn(g, forsta) });
    }
    for (const k of komponenter) {
      const mal = k.anslutsTill.trim().toLowerCase();
      if (!mal) continue;
      this.barn.set(mal, [...(this.barn.get(mal) ?? []), k]);
    }
  }

  port(anslutsTill: string): Port | null { return this.portar.get(anslutsTill.trim().toLowerCase()) ?? null; }
  komponent(beteckning: string): Komponent | null { return this.perBeteckning.get(beteckning.trim().toLowerCase()) ?? null; }

  /** Komponenter anslutna direkt till den här komponenten (eller gatewayporten). */
  anslutna(namn: string): Komponent[] { return this.barn.get(namn.trim().toLowerCase()) ?? []; }

  /**
   * Kedjan uppåt: [komponent, RC, …] och var den slutar (gatewayport, skåp/annat eller inget).
   * Max 10 steg (skydd mot cirklar).
   */
  kedja(k: Komponent): { steg: Komponent[]; port: Port | null; slut: string } {
    const steg: Komponent[] = [];
    let aktuell = k;
    for (let i = 0; i < 10; i++) {
      const mal = aktuell.anslutsTill.trim();
      const port = mal ? this.port(mal) : null;
      if (port) return { steg, port, slut: port.namn };
      const nasta = mal ? this.komponent(mal) : null;
      if (!nasta || nasta.id === aktuell.id || arGateway(nasta) || steg.includes(nasta)) return { steg, port: null, slut: mal };
      steg.push(nasta);
      aktuell = nasta;
    }
    return { steg, port: null, slut: "" };
  }

  /** Härledda värden till Modbus-listan (samma som serverns Gateways.Harledd). */
  harledd(k: Komponent, falt: string): string {
    if (falt === "_protokoll") return protokoll(k);
    const { steg, port } = this.kedja(k);
    if (!port) return "";
    if (falt === "_gateway") return port.namn;
    if (falt === "_installning") return installning(port.port);
    if (falt === "_via") return steg.at(-1)?.beteckning ?? "";
    return "";
  }
}

export function protokoll(k: Komponent) {
  const t = new Set(k.signaler.map((s) => s.typ));
  return [t.has("Modbus RTU") ? "RTU" : "", t.has("Modbus TCP") ? "TCP" : ""].filter(Boolean).join(", ");
}

/** Ser ut som en RC (rumsregulator) eller liknande som andra komponenter kan anslutas till. */
export const arRegulator = (k: Komponent) =>
  /regulator|rumsregl|controller/i.test(k.komponenttyp) || /(^|[-_])RC\d*$/i.test(k.beteckning.trim());

/**
 * Förslag till Ansluts till: gatewayportar, skåp och RC:er (plus värden som redan används).
 * Portar först eftersom de är svårast att skriva rätt.
 */
export function anslutForslag(komponenter: Komponent[], skap: string[] = []): string[] {
  const ut = [
    ...allaPortar(komponenter).map((p) => p.namn),
    ...skap,
    ...komponenter.filter(arRegulator).map((k) => k.beteckning.trim()),
    ...komponenter.map((k) => k.anslutsTill.trim()),
  ].filter(Boolean);
  return [...new Set(ut)];
}

/**
 * Ansluts till-värden som ser ut som gatewayportar men inte finns ("AL01-Port1" utan gateway AL01).
 * Grupperat per gateway, med de portar som används. Används för att skapa gatewaykomponenterna i efterhand.
 */
export function okandaGateways(komponenter: Komponent[]): Map<string, Set<number>> {
  const a = new Anslutningar(komponenter);
  const ut = new Map<string, Set<number>>();
  for (const k of komponenter) {
    const v = k.anslutsTill.trim();
    const m = /^(.+?)[-_ ]?port\s*(\d+)$/i.exec(v);
    if (!m || a.port(v) || a.komponent(v)) continue;
    const gw = m[1]!.replace(/[-_ ]+$/, "");
    if (a.komponent(gw)) continue;
    ut.set(gw, new Set([...(ut.get(gw) ?? []), Number(m[2])]));
  }
  return ut;
}
