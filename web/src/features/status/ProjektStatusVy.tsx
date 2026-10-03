import { useEffect, useState } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import type { ProjektStatus, Rattigheter, StatusUppgift } from "../../lib/typer";

type Props = {
  projektId: string;
  rattigheter: Rattigheter;
  /** Räknas upp när någon annan ändrat i Projekt Status, så att vyn hämtar om. */
  uppdaterad: number;
  visaMeddelande: (t: string) => void;
};

const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");

export function ProjektStatusVy({ projektId, rattigheter, uppdaterad, visaMeddelande }: Props) {
  const [data, setData] = useState<ProjektStatus | null>(null);
  const [nya, setNya] = useState<Record<string, string>>({});

  const hamta = () => api<ProjektStatus>(`/api/projekt/${projektId}/status`).then(setData).catch((e) => visaMeddelande((e as Error).message));
  useEffect(() => { void hamta(); }, [projektId, uppdaterad]);

  const ersatt = (u: StatusUppgift) => setData((d) => d && { ...d, uppgifter: d.uppgifter.map((x) => (x.id === u.id ? u : x)) });

  const andra = async (u: StatusUppgift, falt: string, varde: string) => {
    try {
      ersatt(await api<StatusUppgift>(`/api/projekt/${projektId}/status/${u.id}`, { method: "PATCH", body: skicka({ falt, varde, version: u.version }) }));
    } catch (e) {
      visaMeddelande(e instanceof ApiFel && e.status === 409 ? "Någon annan ändrade raden samtidigt. Gör om din ändring." : (e as Error).message);
      void hamta();
    }
  };

  const laggTill = async (rubrikId: string) => {
    const text = (nya[rubrikId] ?? "").trim();
    if (!text) return;
    try {
      const u = await api<StatusUppgift>(`/api/projekt/${projektId}/status`, { method: "POST", body: skicka({ rubrikId, text }) });
      setData((d) => d && { ...d, uppgifter: [...d.uppgifter.filter((x) => x.id !== u.id), u] });
      setNya((n) => ({ ...n, [rubrikId]: "" }));
    } catch (e) {
      visaMeddelande((e as Error).message);
    }
  };

  const taBort = async (u: StatusUppgift) => {
    try {
      await api(`/api/projekt/${projektId}/status/${u.id}`, { method: "DELETE" });
      setData((d) => d && { ...d, uppgifter: d.uppgifter.filter((x) => x.id !== u.id) });
    } catch (e) {
      visaMeddelande((e as Error).message);
    }
  };

  if (!data) return <p className="dampad">Hämtar…</p>;
  const totalt = data.uppgifter.length;
  const klara = data.uppgifter.filter((u) => u.klar).length;
  const kanSkriva = rattigheter.skriva;
  const kanUnderrubriker = rattigheter.redigeraUnderrubriker;

  return (
    <>
      <div className="brodsmula">Status</div>
      <h1>Projekt Status</h1>
      <p className="ingress">
        Företagets arbetsmetod: fasta rubriker med underrubriker som läggs till så att de passar projektet.
        {totalt > 0 && ` ${klara} av ${totalt} klara.`}
      </p>
      <div className="statuslista">
        {data.rubriker.map((r) => {
          const rader = data.uppgifter.filter((u) => u.rubrikId === r.id).sort((a, b) => a.ordning - b.ordning);
          const klart = rader.filter((u) => u.klar).length;
          return (
            <section key={r.id} className="panel statusrubrik">
              <div className="panelhuvud">
                <h2>{r.namn}</h2>
                <span className={`framsteg ${rader.length && klart === rader.length ? "klart" : ""}`}>
                  {rader.length ? `${klart} / ${rader.length}` : "Inga underrubriker"}
                </span>
              </div>
              {rader.length > 0 && (
                <div className="grid-ram">
                  <table className="grid statusgrid">
                    <thead>
                      <tr>
                        <th className="smal">Klar</th>
                        <th>Underrubrik</th>
                        <th>Kommentar</th>
                        <th>Utförd av</th>
                        <th>Datum</th>
                        {kanUnderrubriker && <th className="smal" aria-label="Ta bort" />}
                      </tr>
                    </thead>
                    <tbody>
                      {rader.map((u) => (
                        <tr key={u.id} className={u.klar ? "klar" : undefined}>
                          <td className="kryss">
                            <input type="checkbox" aria-label={`Klar: ${u.text}`} checked={u.klar} disabled={!kanSkriva}
                              onChange={(e) => andra(u, "klar", String(e.target.checked))} />
                          </td>
                          <td><TextCell varde={u.text} lasläge={!kanUnderrubriker} etikett="Underrubrik" onSpara={(v) => andra(u, "text", v)} /></td>
                          <td><TextCell varde={u.kommentar} lasläge={!kanSkriva} etikett="Kommentar" onSpara={(v) => andra(u, "kommentar", v)} /></td>
                          <td><TextCell varde={u.utfordAv} lasläge={!kanSkriva} etikett="Utförd av" onSpara={(v) => andra(u, "utfordAv", v)} /></td>
                          <td className="ro">{datum(u.klarDatum)}</td>
                          {kanUnderrubriker && (
                            <td className="smal"><button className="ikonknapp" title="Ta bort underrubriken" onClick={() => taBort(u)}>✕</button></td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {kanUnderrubriker && (
                <form className="ny-underrubrik" onSubmit={(e) => { e.preventDefault(); void laggTill(r.id); }}>
                  <input placeholder={`Ny underrubrik under ${r.namn}`} aria-label={`Ny underrubrik under ${r.namn}`}
                    value={nya[r.id] ?? ""} onChange={(e) => setNya((n) => ({ ...n, [r.id]: e.target.value }))} />
                  <button className="knapp" disabled={!(nya[r.id] ?? "").trim()}>Lägg till</button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TextCell({ varde, lasläge, etikett, onSpara }: { varde: string; lasläge: boolean; etikett: string; onSpara: (v: string) => void }) {
  const [utkast, setUtkast] = useState(varde);
  useEffect(() => setUtkast(varde), [varde]);
  return (
    <input type="text" aria-label={etikett} value={utkast} readOnly={lasläge}
      onChange={(e) => setUtkast(e.target.value)}
      onBlur={() => { if (utkast !== varde) onSpara(utkast); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setUtkast(varde); }} />
  );
}
