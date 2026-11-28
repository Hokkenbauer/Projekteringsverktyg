import type { Komponent } from "./typer";

/**
 * Vem som levererar komponenten. Sparas i komponentens inställningar (JSON, nyckeln "levererasAv"),
 * så att ingen ny databaskolumn behövs. Tomt = SÖE (vi beställer själva).
 * Beställningslistan tar bara med komponenter som SÖE levererar.
 */
export const LEVERANTORER: { kod: string; namn: string }[] = [
  { kod: "", namn: "SÖE (vi beställer)" },
  { kod: "VE", namn: "VE – ventilation" },
  { kod: "RE", namn: "RE – rör/VS" },
  { kod: "EE", namn: "EE – el" },
  { kod: "KE", namn: "KE – kyla" },
  { kod: "SP", namn: "SP – sprinkler" },
  { kod: "Prefab", namn: "Ingår i prefabricerad utrustning" },
  { kod: "Beställare", namn: "Beställaren" },
  { kod: "Annan", namn: "Annan leverantör" },
];

function lasJson(k: Pick<Komponent, "installningar">): Record<string, unknown> {
  try {
    const v = k.installningar?.trim() ? JSON.parse(k.installningar) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** "" = SÖE, annars koden (VE, RE …). */
export function levererasAv(k: Pick<Komponent, "installningar">): string {
  const v = lasJson(k).levererasAv;
  return typeof v === "string" ? v.trim() : "";
}

export const levererasAvSoe = (k: Pick<Komponent, "installningar">) => {
  const v = levererasAv(k).toUpperCase();
  return v === "" || v === "SÖE" || v === "SOE";
};

export const levererasAvNamn = (kod: string) => LEVERANTORER.find((l) => l.kod.toLowerCase() === kod.trim().toLowerCase())?.namn ?? kod;

/** Nya inställningar med levererasAv satt (övriga nycklar, t.ex. gatewayens portar, behålls). */
export function medLevererasAv(k: Pick<Komponent, "installningar">, kod: string): string {
  const j = lasJson(k);
  if (kod.trim()) j.levererasAv = kod.trim(); else delete j.levererasAv;
  return Object.keys(j).length ? JSON.stringify(j) : "";
}
