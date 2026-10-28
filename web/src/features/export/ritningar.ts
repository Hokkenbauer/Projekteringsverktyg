import { api, hamtaBinar } from "../../lib/api";
import type { Komponent, ListRad } from "../../lib/typer";
import { temaForVerktyg } from "../ritning/tema";

/**
 * Placeringsritningar och Ritbordets bilder som PDF till filexporten. Ritverktygen öppnas osynligt (en dold iframe)
 * med värdfunktioner som aldrig sparar något, så att exporten inte kan ändra ritningarna.
 */

type Fil = { namn: string; data: Uint8Array };

/** Öppnar ett ritverktyg osynligt och väntar tills det säger att det är redo. Värdfunktionerna läggs ut under namnet vardNamn. */
async function doltVerktyg<W>(src: string, vardNamn: string, vard: Record<string, unknown>): Promise<{ w: W; stang: () => void }> {
  const fonster = window as unknown as Record<string, unknown>;
  const fore = fonster[vardNamn];
  const ram = document.createElement("iframe");
  ram.setAttribute("aria-hidden", "true");
  ram.tabIndex = -1;
  // Ritverktygen behöver en verklig storlek för att kunna mäta och rita, så ramen ligger utanför skärmen.
  ram.style.cssText = "position:fixed;left:-30000px;top:0;width:1600px;height:1000px;border:0;opacity:0;pointer-events:none";
  const stang = () => { ram.remove(); if (fonster[vardNamn] === nyVard) fonster[vardNamn] = fore; };
  let klar: () => void = () => undefined;
  const redo = new Promise<void>((ok) => { klar = ok; });
  const nyVard = { ...vard, redo: () => klar() };
  fonster[vardNamn] = nyVard;
  ram.src = src;
  document.body.appendChild(ram);
  const tid = new Promise<never>((_, fel) => window.setTimeout(() => fel(new Error("Ritverktyget startade inte")), 45000));
  try { await Promise.race([redo, tid]); }
  catch (e) { stang(); throw e; }
  return { w: ram.contentWindow as unknown as W, stang };
}

type Ritverktyg = {
  pvLaddaRitning?: (json: string | null, namn: string, behallVy: boolean) => Promise<void>;
  pvSync?: (json: string) => void;
  pvTema?: (t: Record<string, string | boolean>) => void;
  pvExporteraPlaner?: () => Promise<{ byggnad: string; plan: string; data: ArrayBuffer }[]>;
};

/** Antal plan med ritning (bakgrund) i placeringsritningen. */
export function antalPlan(ritning: string | null): number {
  try {
    const r = JSON.parse(ritning ?? "null") as { buildings?: { floors?: { layers?: unknown[]; ref?: unknown }[] }[] } | null;
    return (r?.buildings ?? []).reduce((s, b) => s + (b.floors ?? []).filter((f) => (f.layers?.length ?? 0) > 0 && f.ref).length, 0);
  } catch { return 0; }
}

/** En PDF per plan (planvyn och komponentförteckningen). */
export async function placeringsritningarPdf(projektId: string, projektnamn: string, ritning: string | null, komponenter: Komponent[],
  egenkontroll: ListRad[], installationslista: ListRad[]): Promise<Fil[]> {
  if (!antalPlan(ritning)) return [];
  const { w, stang } = await doltVerktyg<Ritverktyg>("/ritning/placeringsritning.html", "pvRitningsVard", {
    meddelande: () => undefined,
    spara: async () => "lasläge",
    laddaUppPdf: async () => { throw new Error("Exporten laddar inte upp något"); },
    hamtaPdf: (fileId: string) => hamtaBinar(`/api/projekt/${projektId}/filer/${fileId}/innehall`),
    komponenter: () => komponenter.map((k) => ({ id: k.id, beteckning: k.beteckning })),
    visaKomponent: () => undefined,
  });
  try {
    if (!w.pvLaddaRitning || !w.pvExporteraPlaner) throw new Error("Ritverktyget saknar export av planer");
    w.pvTema?.(temaForVerktyg());
    await w.pvLaddaRitning(ritning, projektnamn, false);
    const ek = new Map(egenkontroll.filter((r) => r.komponentId).map((r) => [r.komponentId!, r.data]));
    const il = new Map(installationslista.filter((r) => r.komponentId).map((r) => [r.komponentId!, r.data]));
    w.pvSync?.(JSON.stringify(komponenter.map((k) => ({
      ...k, kontrollerad: ek.get(k.id)?.kontrollerad === "true", kabelLangdMeter: il.get(k.id)?.langd ?? "",
    }))));
    await new Promise((ok) => window.setTimeout(ok, 600));
    const planer = await w.pvExporteraPlaner();
    const flera = new Set(planer.map((p) => p.byggnad)).size > 1;
    return planer.map((p) => ({ namn: `${flera ? `${p.byggnad} – ` : ""}${p.plan}`, data: new Uint8Array(p.data) }));
  } finally { stang(); }
}

type Ritbord = {
  rbLadda?: (json: string | null, namn: string) => void;
  rbInstallningar?: (json: string | null) => void;
  rbTema?: (t: Record<string, string | boolean>) => void;
  rbPdfData?: () => Promise<ArrayBuffer | null>;
};

export type RitbordBild = { id: string; namn: string };

/** En PDF per bild i Ritbordet (flödesbilder och SCADA-bakgrunder). */
export async function ritbordPdf(projektId: string, bilder: RitbordBild[], avbrutet: () => boolean): Promise<Fil[]> {
  if (!bilder.length) return [];
  const { w, stang } = await doltVerktyg<Ritbord>("/ritbord/ritbord.html", "rbVard", {
    spara: async () => "lasläge",
    sparaInstallningar: async () => false,
    kanInstallningar: false,
  });
  try {
    if (!w.rbLadda || !w.rbPdfData) throw new Error("Ritbordet saknar PDF-export");
    w.rbTema?.(temaForVerktyg());
    try { w.rbInstallningar?.((await api<{ data: string | null }>("/api/ritbord/installningar")).data); } catch { /* grundinställningarna duger */ }
    const ut: Fil[] = [];
    for (const b of bilder) {
      if (avbrutet()) break;
      const bild = await api<{ namn: string; data: string | null }>(`/api/projekt/${projektId}/ritbord/${b.id}`);
      if (!bild.data) continue; // tom bild (aldrig ritad)
      w.rbLadda(bild.data || null, bild.namn);
      await new Promise((ok) => window.setTimeout(ok, 150));
      const data = await w.rbPdfData();
      if (data) ut.push({ namn: bild.namn || b.namn, data: new Uint8Array(data) });
    }
    return ut;
  } finally { stang(); }
}
