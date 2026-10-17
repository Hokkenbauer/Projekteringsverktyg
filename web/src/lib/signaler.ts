/**
 * En komponents I/O-punkter (samma regler som servern, KomponentApi/Signaler.cs).
 * Signalnamnet blir komponentens beteckning + funktionen, t.ex. LB01-TF01-DRIFT.
 */
export type Signal = { id: string; typ: string; funktion: string; beskrivning: string };

export const TYPER = ["DI", "DU", "AI", "AU", "Modbus RTU", "Modbus TCP", "M-bus", "BACnet", "KNX", "DALI"];

/** Snabbknappar i I/O-rutan. */
export const SNABBTYPER = ["DI", "DU", "AI", "AU", "Modbus RTU", "Modbus TCP", "M-bus"];

export const FUNKTIONER: Record<string, string[]> = {
  DI: ["DRIFT", "LARM", "INDIKERING", "NIVÅ", "FLÖDE", "SÄKERHET"],
  DU: ["MANÖVER", "STOPP", "ÖPPNA", "STÄNG", "STEG2"],
  AI: ["MÄTVÄRDE", "ÅTERKOPPLING", "TEMP", "TRYCK", "FLÖDE"],
  AU: ["STYRSIGNAL", "VARVTAL", "BÖRVÄRDE"],
};

const nyttId = () => Math.random().toString(36).slice(2, 12);

export function normaliseraTyp(typ: string): string | null {
  const t = typ.trim().toUpperCase().replace(/[\s_-]+/g, " ");
  switch (t) {
    case "DI": return "DI";
    case "DU": case "DO": return "DU";
    case "AI": return "AI";
    case "AU": case "AO": return "AU";
    case "RTU": case "MODBUS RTU": case "MODBUS": return "Modbus RTU";
    case "TCP": case "MODBUS TCP": return "Modbus TCP";
    case "MBUS": case "M BUS": return "M-bus";
    case "BACNET": return "BACnet";
    case "KNX": return "KNX";
    case "DALI": return "DALI";
    default: return null;
  }
}

export function nastaFunktion(typ: string, befintliga: Signal[]): string {
  const forslag = FUNKTIONER[typ];
  if (!forslag) return "";
  const anvanda = new Set(befintliga.filter((s) => s.typ === typ).map((s) => s.funktion));
  return forslag.find((f) => !anvanda.has(f)) ?? "";
}

export const nySignal = (typ: string, befintliga: Signal[]): Signal =>
  ({ id: nyttId(), typ, funktion: nastaFunktion(typ, befintliga), beskrivning: "" });

const TYP_RE = /(?<![A-ZÅÄÖ])(?:(\d{1,2})\s*[X×*]?\s*)?(MODBUS[\s_-]*RTU|MODBUS[\s_-]*TCP|MODBUS|M[\s_-]?BUS|BACNET|KNX|DALI|RTU|TCP|DI|DO|DU|AI|AO|AU)(?![A-ZÅÄÖ])/g;

/** "2DI DU AO RTU" → nya punkter efter de befintliga (som påverkar vilka funktioner som föreslås). */
export function tolka(text: string, befintliga: Signal[] = []): Signal[] {
  const ut: Signal[] = [];
  for (const m of text.toUpperCase().matchAll(TYP_RE)) {
    const antal = Math.min(64, Math.max(1, Number(m[1] ?? 1)));
    const typ = normaliseraTyp(m[2] ?? "");
    if (!typ) continue;
    for (let i = 0; i < antal; i++) ut.push(nySignal(typ, [...befintliga, ...ut]));
  }
  return ut;
}

/** "2×DI, DU, AU, Modbus RTU" (samma som servern skriver i Signaltyp). */
export function sammanfatta(lista: Signal[]): string {
  const antal = new Map<string, number>();
  for (const s of lista) antal.set(s.typ, (antal.get(s.typ) ?? 0) + 1);
  const ordning = (t: string) => { const i = TYPER.indexOf(t); return i < 0 ? 999 : i; };
  return [...antal.entries()].sort((a, b) => ordning(a[0]) - ordning(b[0]) || a[0].localeCompare(b[0], "sv"))
    .map(([t, n]) => (n > 1 ? `${n}×${t}` : t)).join(", ");
}

export const signalnamn = (beteckning: string, s: Signal) => [beteckning.trim(), s.funktion.trim()].filter(Boolean).join("-");
