import { useCallback, useEffect, useState } from "react";
import { api, ApiFel, skicka } from "./api";

type KatalogSvar = { namn: string; data: string; version: number; andrad: string | null; andradAv: string };

/**
 * En gemensam katalog (funktionstexter, projekteringsstöd, frågor till teknisk beskrivning, byggvaror).
 * spara() skickar hela katalogen; om någon annan hunnit spara hämtas deras version och felet kastas.
 */
export function useKatalog<T>(namn: string, tom: T) {
  const [data, setData] = useState<T | null>(null);
  const [version, setVersion] = useState(0);
  const [info, setInfo] = useState<{ andrad: string | null; andradAv: string }>({ andrad: null, andradAv: "" });

  const hamta = useCallback(async () => {
    const k = await api<KatalogSvar>(`/api/katalog/${namn}`);
    let d = tom;
    try { if (k.data) d = { ...tom, ...JSON.parse(k.data) }; } catch { /* trasig katalog: börja tomt */ }
    setData(d);
    setVersion(k.version);
    setInfo({ andrad: k.andrad, andradAv: k.andradAv });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namn]);

  useEffect(() => { void hamta().catch(() => setData(tom)); }, [hamta]);

  const spara = useCallback(async (ny: T) => {
    try {
      const k = await api<KatalogSvar>(`/api/katalog/${namn}`, { method: "PUT", body: skicka({ data: JSON.stringify(ny), version }) });
      setData(ny);
      setVersion(k.version);
      setInfo({ andrad: k.andrad, andradAv: k.andradAv });
    } catch (e) {
      if (e instanceof ApiFel && e.status === 409) {
        await hamta();
        throw new Error("Någon annan ändrade katalogen samtidigt. Den är uppdaterad nu, gör om din ändring.");
      }
      throw e;
    }
  }, [namn, version, hamta]);

  return { data, version, info, spara, hamta };
}
