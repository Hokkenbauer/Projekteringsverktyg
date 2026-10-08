import { useEffect, useRef, useState } from "react";
import { api, ApiFel, skicka } from "../../lib/api";

type KatalogSvar = { data: string; version: number; andrad: string | null; andradAv: string };

/** Funktioner som planeringsverktyget (iframen) anropar. Se public/resursplanering/resursplanering.html. */
type Vard = {
  hamta: () => Promise<string | null>;
  spara: (json: string) => Promise<"ok" | "konflikt" | "fel" | "lasläge">;
  kanSpara: boolean;
};

type Props = { kanSpara: boolean };

/**
 * Resursplanering: gemensam planering av alla projekt och resurser (tabell, Gantt, möten, anteckningar).
 * Verktyget från dagens program, inbäddat; planeringen sparas på servern och är densamma för alla.
 */
export function ResursplaneringVy({ kanSpara }: Props) {
  const ram = useRef<HTMLIFrameElement>(null);
  const version = useRef(0);
  const [info, setInfo] = useState<{ andrad: string | null; andradAv: string } | null>(null);
  const [helskarm, setHelskarm] = useState(false);

  useEffect(() => {
    const vard: Vard = {
      kanSpara,
      hamta: async () => {
        const k = await api<KatalogSvar>("/api/katalog/resursplanering");
        version.current = k.version;
        setInfo({ andrad: k.andrad, andradAv: k.andradAv });
        return k.data || null;
      },
      spara: async (json) => {
        if (!kanSpara) return "lasläge";
        try {
          const k = await api<KatalogSvar>("/api/katalog/resursplanering", { method: "PUT", body: skicka({ data: json, version: version.current }) });
          version.current = k.version;
          setInfo({ andrad: k.andrad, andradAv: k.andradAv });
          return "ok";
        } catch (e) {
          if (e instanceof ApiFel && e.status === 409) return "konflikt";
          if (e instanceof ApiFel && e.status === 403) return "lasläge";
          return "fel";
        }
      },
    };
    (window as unknown as { rpVard?: Vard }).rpVard = vard;
    return () => { delete (window as unknown as { rpVard?: Vard }).rpVard; };
  }, [kanSpara]);

  // Hämta andras ändringar när man kommer tillbaka till fliken (om man inte själv har osparat).
  useEffect(() => {
    const synlig = () => {
      if (document.visibilityState !== "visible") return;
      const w = ram.current?.contentWindow as (Window & { rpUppdatera?: () => Promise<void> }) | null | undefined;
      void w?.rpUppdatera?.();
    };
    document.addEventListener("visibilitychange", synlig);
    return () => document.removeEventListener("visibilitychange", synlig);
  }, []);

  return (
    <div className={`ritningsyta ${helskarm ? "helskarm" : ""}`}>
      <div className="ritningshuvud">
        <h1>Resursplanering</h1>
        <span className="hjalp" tabIndex={0} title="Gemensam planering av alla projekt och resurser. Sparas automatiskt och är densamma för alla. Admin, Projektledare och System kan ändra, övriga kan läsa.">?</span>
        {!kanSpara && <span className="dampad">Endast läsning</span>}
        <span className="grow" />
        {info?.andradAv && <span className="dampad liten">Senast sparad av {info.andradAv}{info.andrad ? ` ${new Date(info.andrad).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>}
        <button className="knapp" onClick={() => setHelskarm((h) => !h)}>{helskarm ? "Avsluta helskärm" : "Helskärm"}</button>
      </div>
      <iframe ref={ram} className="ritningsram" src={`/resursplanering/resursplanering.html?v=${__BYGGE__}`} title="Resursplanering" />
    </div>
  );
}
