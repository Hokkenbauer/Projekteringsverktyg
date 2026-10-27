import { useKatalog } from "./katalog";

/**
 * Produktregistret (gemensam katalog "produkter", Verktyg → Produktregister).
 * Komponentens fält Produkt innehåller produktens namn = fabrikat + modell, t.ex. "Siemens QAE2120".
 * Servern fyller i komponenttyp och I/O från registret när en produkt väljs (om de är tomma),
 * och Kraftberäkningen hämtar strömmen. Samma regler finns i KomponentApi/Produkter.cs.
 */
export type Produkt = {
  id: string; fabrikat: string; modell: string; komponenttyp: string;
  /** Standard-I/O i kortform, t.ex. "AI" eller "DI DU AU". */
  io: string;
  /** Ström per fas (A) och antal faser ("1" eller "3"), till Kraftberäkningen. */
  stromA: string; fas: string;
  artikelnummer: string; leverantor: string;
  /** Byggvarubedömning och Sunda Hus. */
  bedomning: string; sundaHus: string;
  /** Länk till datablad. */
  datablad: string; kommentar: string;
  /** Utgången: finns kvar för gamla projekt men föreslås inte. */
  utgatt: boolean;
};
export type Produktregister = { produkter: Produkt[] };
export const TOMT_REGISTER: Produktregister = { produkter: [] };

export const produktNamn = (p: Pick<Produkt, "fabrikat" | "modell">) => `${p.fabrikat.trim()} ${p.modell.trim()}`.trim();

export const tomProdukt = (): Produkt => ({
  id: crypto.randomUUID().replace(/-/g, ""), fabrikat: "", modell: "", komponenttyp: "", io: "", stromA: "", fas: "",
  artikelnummer: "", leverantor: "", bedomning: "", sundaHus: "", datablad: "", kommentar: "", utgatt: false,
});

/** "Siemens QAE2120" → fabrikat Siemens, modell QAE2120 (första ordet är fabrikatet). */
export function franNamn(namn: string): Produkt {
  const t = namn.trim();
  const i = t.indexOf(" ");
  return { ...tomProdukt(), fabrikat: i > 0 ? t.slice(0, i) : "", modell: i > 0 ? t.slice(i + 1) : t };
}

export function useProduktregister() {
  return useKatalog<Produktregister>("produkter", TOMT_REGISTER);
}

/**
 * Förslag i fältet Produkt: registrets aktiva produkter först, sedan värden som bara finns i projektet
 * (de saknas i registret och kan läggas till där).
 */
export function produktForslag(register: Produktregister | null, iProjektet: string[]): string[] {
  const aktiva = (register?.produkter ?? []).filter((p) => !p.utgatt).map(produktNamn).filter(Boolean);
  const sett = new Set(aktiva.map((n) => n.toLowerCase()));
  const ovriga = iProjektet.map((v) => v.trim()).filter((v) => v && !sett.has(v.toLowerCase()));
  return [...aktiva.sort((a, b) => a.localeCompare(b, "sv", { numeric: true })), ...new Set(ovriga)];
}
