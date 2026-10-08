import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFel, skicka } from "./api";
import type { ProjektDokument } from "./typer";

/**
 * Projektets dokument av en typ (servicerapporter, anslutningsinformation …) med autosparning.
 * andra() sparar en stund efter senaste ändringen; vid krock hämtas den andres version.
 */
export function useDokument(projektId: string, typ: string, uppdaterad: number, visaMeddelande: (t: string) => void) {
  const [lista, setLista] = useState<ProjektDokument[] | null>(null);
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [nekad, setNekad] = useState(false);
  const listaRef = useRef(lista);
  listaRef.current = lista;
  const vantar = useRef<{ id: string; data?: string; namn?: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hamta = useCallback(async () => {
    try {
      const l = await api<ProjektDokument[]>(`/api/projekt/${projektId}/dokument?typ=${typ}`);
      setLista(l);
      return l;
    } catch (e) {
      if (e instanceof ApiFel && e.status === 403) { setNekad(true); setLista([]); return []; }
      throw e;
    }
  }, [projektId, typ]);

  useEffect(() => { void hamta().catch((e) => visaMeddelande(`Kunde inte hämta: ${(e as Error).message}`)); }, [hamta]);
  // Andra har ändrat: hämta om, men inte medan man själv har osparat.
  useEffect(() => { if (uppdaterad && !vantar.current) void hamta().catch(() => undefined); }, [uppdaterad]);

  const sparaNu = useCallback(async () => {
    window.clearTimeout(timer.current);
    const v = vantar.current;
    if (!v) return;
    vantar.current = null;
    const d = listaRef.current?.find((x) => x.id === v.id);
    if (!d) return;
    setStatus("sparar");
    try {
      const ny = await api<ProjektDokument>(`/api/projekt/${projektId}/dokument/${v.id}`, {
        method: "PUT", body: skicka({ data: v.data, namn: v.namn, version: d.version }),
      });
      setLista((l) => l?.map((x) => (x.id === ny.id ? ny : x)) ?? l);
      setStatus(vantar.current ? "osparat" : "sparat");
    } catch (e) {
      setStatus("sparat");
      if (e instanceof ApiFel && e.status === 409) {
        await hamta();
        visaMeddelande("Någon annan ändrade samtidigt. Deras version visas nu; gör om din senaste ändring.");
      } else visaMeddelande(`Kunde inte spara: ${(e as Error).message}`);
    }
  }, [projektId, hamta, visaMeddelande]);

  useEffect(() => () => { void sparaNu(); }, [sparaNu]);

  /** Ändrar lokalt direkt och sparar efter en sekund. */
  const andra = useCallback((id: string, data: string, namn?: string) => {
    setLista((l) => l?.map((x) => (x.id === id ? { ...x, data, namn: namn ?? x.namn } : x)) ?? l);
    if (vantar.current && vantar.current.id !== id) void sparaNu();
    vantar.current = { id, data, namn: namn ?? vantar.current?.namn };
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void sparaNu(), 1000);
  }, [sparaNu]);

  const skapa = useCallback(async (namn: string, data: string) => {
    await sparaNu();
    const d = await api<ProjektDokument>(`/api/projekt/${projektId}/dokument`, { method: "POST", body: skicka({ typ, namn, data }) });
    setLista((l) => [...(l ?? []), d]);
    return d;
  }, [projektId, typ, sparaNu]);

  const taBort = useCallback(async (id: string) => {
    if (vantar.current?.id === id) { vantar.current = null; window.clearTimeout(timer.current); }
    await api(`/api/projekt/${projektId}/dokument/${id}`, { method: "DELETE" });
    setLista((l) => l?.filter((x) => x.id !== id) ?? l);
  }, [projektId]);

  return { lista, status, nekad, andra, skapa, taBort, sparaNu, hamta };
}
