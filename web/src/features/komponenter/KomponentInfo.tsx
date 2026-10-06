import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Komponent, ListDef, ListRad, Logg } from "../../lib/typer";
import { NAVIGERING } from "../../shell/navigering";
import { omfattar } from "../listor/ListVy";

type Plats = { byggnad: string; plan: string; rum: string; placerad: boolean };

type Props = {
  projektId: string;
  komponent: Komponent | undefined;
  listdefinitioner: ListDef[];
  onStang: () => void;
  /** Gå till en flik och markera komponentens rad där. */
  onGaTill: (flik: string, komponentId: string) => void;
  onVisaPaRitning: (komponentId: string) => void;
  /** Räknas upp när något i projektet ändrats, så att panelen hämtar om. */
  uppdaterad: number;
};

const tid = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
const flikFor = (lista: string) => NAVIGERING.flatMap((g) => g.flikar).find((f) => f.lista === lista);

/** Ritningen sparas som JSON; här letas komponentens placeringar upp utan att ritverktyget behöver vara öppet. */
function platserIRitning(json: string | null, id: string): Plats[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json) as { buildings?: { name: string; floors: { name: string; rooms: { id: string; name: string }[]; components: { pvId?: string; x: number | null; roomId?: string | null }[] }[] }[] };
    const ut: Plats[] = [];
    for (const b of p.buildings ?? []) for (const f of b.floors ?? []) for (const c of f.components ?? []) {
      if (c.pvId !== id) continue;
      const rum = c.roomId ? f.rooms?.find((r) => r.id === c.roomId)?.name ?? "" : "";
      ut.push({ byggnad: b.name, plan: f.name, rum, placerad: c.x != null });
    }
    return ut;
  } catch {
    return [];
  }
}

/** Status i en lista, i klartext. */
function status(lista: string, data: Record<string, string> | undefined): string {
  const d = data ?? {};
  const bock = (k: string, namn: string) => (d[k] === "true" ? `${namn} ✓${d[k + "Datum"] ? " " + d[k + "Datum"] : ""}` : null);
  switch (lista) {
    case "egenkontroll":
      return d.kontrollerad === "true" ? `Kontrollerad ${d.datum ?? ""} ${d.sign ?? ""}`.trim() : "Ej kontrollerad";
    case "installationslista": {
      const delar = [bock("utdragen", "Utdragen"), bock("ansluten", "Ansluten"), bock("markning", "Märkt")].filter(Boolean);
      return [d.langd ? `${d.langd} m` : null, ...delar].filter(Boolean).join(" · ") || "Inget ifyllt";
    }
    case "skyltlista":
      return [d.skyltfarg && `Skylt ${d.skyltfarg.toLowerCase()}`, d.textfarg && `text ${d.textfarg.toLowerCase()}`].filter(Boolean).join(", ") || "Standardskylt";
    case "brandspjall":
      return [d.lufttyp, d.funktion].filter(Boolean).join(" · ") || "Inget ifyllt";
    default:
      return "";
  }
}

/**
 * Komponentinformation: var komponenten finns i projektet, med länkar dit.
 * Allt läses från samma komponent (samma Id), inget är kopierat.
 */
export function KomponentInfo({ projektId, komponent, listdefinitioner, onStang, onGaTill, onVisaPaRitning, uppdaterad }: Props) {
  const [rader, setRader] = useState<Record<string, ListRad | null>>({});
  const [platser, setPlatser] = useState<Plats[] | null>(null);
  const [logg, setLogg] = useState<Logg[]>([]);
  const id = komponent?.id;
  const kopplade = listdefinitioner.filter((d) => d.kopplad && komponent && omfattar(d, komponent.komponenttyp));

  useEffect(() => {
    if (!id) return;
    let avbruten = false;
    (async () => {
      const svar = await Promise.all(kopplade.map(async (d) => {
        try {
          const l = await api<ListRad[]>(`/api/projekt/${projektId}/listor/${d.id}`);
          return [d.id, l.find((r) => r.komponentId === id) ?? null] as const;
        } catch { return [d.id, null] as const; }
      }));
      if (avbruten) return;
      setRader(Object.fromEntries(svar));
      try {
        const r = await api<{ data: string | null }>(`/api/projekt/${projektId}/ritning`);
        if (!avbruten) setPlatser(platserIRitning(r.data, id));
      } catch { if (!avbruten) setPlatser([]); }
      try {
        const l = await api<Logg[]>(`/api/projekt/${projektId}/andringslogg?entitetId=${id}&antal=8`);
        if (!avbruten) setLogg(l);
      } catch { /* loggen är inte nödvändig */ }
    })();
    return () => { avbruten = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, projektId, uppdaterad, kopplade.length]);

  useEffect(() => {
    const tangent = (e: KeyboardEvent) => { if (e.key === "Escape") onStang(); };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  }, [onStang]);

  if (!komponent) return null;
  const k = komponent;
  const uppgifter: [string, string][] = [
    ["System", k.system], ["Komponenttyp", k.komponenttyp], ["Signaltyp", k.signaltyp], ["Placering", k.placering],
    ["Beskrivning", k.beskrivning], ["Ansluts till", k.anslutsTill], ["Kabeltyp", k.kabeltyp],
    ["Produkttyp", k.produkttyp], ["Fabrikat", k.produkt], ["Monteringsanvisning", k.monteringsanvisning], ["Övrigt", k.ovrigt],
  ];

  return (
    <aside className="infopanel" aria-label={`Komponentinformation för ${k.beteckning}`}>
      <header>
        <div>
          <div className="brodsmula">Komponentinformation</div>
          <h2 className="mono">{k.beteckning || "(utan beteckning)"}</h2>
          <span className="dampad">{[k.komponenttyp, k.system].filter(Boolean).join(" · ")}</span>
        </div>
        <button className="knapp" onClick={onStang} aria-label="Stäng">✕</button>
      </header>

      <section>
        <h3>Finns i</h3>
        <ul className="finnsi">
          <li>
            <button className="lank" onClick={() => onGaTill("komponenter", k.id)}>Komponenter</button>
            <span>Ändrad {tid(k.andrad)} av {k.andradAv}</span>
          </li>
          {kopplade.map((d) => {
            const flik = flikFor(d.id);
            if (!flik) return null;
            return (
              <li key={d.id}>
                <button className="lank" onClick={() => onGaTill(flik.id, k.id)}>{flik.namn}</button>
                <span>{d.id in rader ? status(d.id, rader[d.id]?.data) || (d.id === "signallista" ? k.signaltyp || "Signaltyp saknas" : "") : "…"}</span>
              </li>
            );
          })}
          <li>
            <button className="lank" onClick={() => onVisaPaRitning(k.id)}>Placeringsritningar</button>
            <span>
              {platser === null ? "…" : platser.length === 0 ? "Inte på någon ritning än"
                : platser.map((p) => p.placerad ? [p.byggnad, p.plan, p.rum].filter(Boolean).join(" › ") : `${p.byggnad} › ${p.plan} (ej placerad)`).join("; ")}
            </span>
          </li>
        </ul>
      </section>

      <section>
        <h3>Uppgifter</h3>
        <dl className="uppgifter">
          {uppgifter.filter(([, v]) => v).map(([n, v]) => (<div key={n}><dt>{n}</dt><dd>{v}</dd></div>))}
        </dl>
        {uppgifter.every(([, v]) => !v) && <p className="dampad">Inga uppgifter ifyllda.</p>}
      </section>

      <section>
        <h3>Senaste ändringar</h3>
        {logg.length === 0 ? <p className="dampad">Inga ändringar loggade.</p> : (
          <ul className="minilista">
            {logg.map((l) => <li key={l.id}><span>{tid(l.tidpunkt)}</span><span>{l.anvandarNamn} {l.beskrivning}</span></li>)}
          </ul>
        )}
      </section>
    </aside>
  );
}
