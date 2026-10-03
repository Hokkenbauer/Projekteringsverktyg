import { useCallback, useEffect, useRef, useState } from "react";
import { api, laddaNer } from "../../lib/api";
import type { ProjektFil } from "../../lib/typer";

type Props = {
  projektId: string;
  lasläge: boolean;
  /** Räknas upp när någon annan laddat upp eller tagit bort en fil. */
  uppdaterad: number;
  visaMeddelande: (text: string) => void;
};

const storlek = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} kB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const tid = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/** Projektets filer i fasta mappar. Samma filnamn i samma mapp blir en ny version. */
export function ProjektfilerVy({ projektId, lasläge, uppdaterad, visaMeddelande }: Props) {
  const [mappar, setMappar] = useState<string[]>([]);
  const [filer, setFiler] = useState<ProjektFil[] | null>(null);
  const [vald, setVald] = useState<string>("");
  const [laddar, setLaddar] = useState(false);
  const [drar, setDrar] = useState(false);
  const [versioner, setVersioner] = useState<{ fil: ProjektFil; lista: ProjektFil[] } | null>(null);
  const valjare = useRef<HTMLInputElement>(null);

  const hamta = useCallback(async () => {
    try {
      const svar = await api<{ mappar: string[]; filer: ProjektFil[] }>(`/api/projekt/${projektId}/filer`);
      setMappar(svar.mappar);
      setFiler(svar.filer);
      setVald((v) => v || svar.mappar[0] || "");
    } catch (e) {
      visaMeddelande(`Filerna kunde inte hämtas: ${(e as Error).message}`);
    }
  }, [projektId, visaMeddelande]);

  useEffect(() => { void hamta(); }, [hamta, uppdaterad]);

  const ladda = async (lista: FileList | File[]) => {
    const filerAttLadda = [...lista];
    if (!filerAttLadda.length || !vald) return;
    const form = new FormData();
    form.append("mapp", vald);
    for (const f of filerAttLadda) form.append("filer", f, f.name);
    setLaddar(true);
    try {
      await api(`/api/projekt/${projektId}/filer`, { method: "POST", body: form });
      visaMeddelande(filerAttLadda.length === 1 ? `${filerAttLadda[0]!.name} är uppladdad.` : `${filerAttLadda.length} filer är uppladdade.`);
      await hamta();
    } catch (e) {
      visaMeddelande(`Uppladdningen misslyckades: ${(e as Error).message}`);
    } finally {
      setLaddar(false);
      if (valjare.current) valjare.current.value = "";
    }
  };

  const taBort = async (f: ProjektFil) => {
    if (!window.confirm(`Ta bort ${f.namn} med alla ${f.antalVersioner} versioner?`)) return;
    try {
      await api(`/api/projekt/${projektId}/filer/${f.id}`, { method: "DELETE" });
      await hamta();
    } catch (e) {
      visaMeddelande(`Filen kunde inte tas bort: ${(e as Error).message}`);
    }
  };

  const visaVersioner = async (f: ProjektFil) => {
    try {
      setVersioner({ fil: f, lista: await api<ProjektFil[]>(`/api/projekt/${projektId}/filer/${f.id}/versioner`) });
    } catch (e) {
      visaMeddelande((e as Error).message);
    }
  };

  const hamtaFil = (f: ProjektFil) =>
    laddaNer(`/api/projekt/${projektId}/filer/${f.id}/innehall`, f.namn).catch((e) => visaMeddelande((e as Error).message));

  const iMappen = (filer ?? []).filter((f) => f.mapp === vald);
  const antalIMapp = (m: string) => (filer ?? []).filter((f) => f.mapp === m).length;

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <h1>Projektfiler</h1>
      <p className="ingress">
        Ritningar, beskrivningar, leveranser och foton. Laddar du upp en fil med samma namn i samma mapp sparas den som en ny
        version, och de gamla versionerna finns kvar.
      </p>

      <div className="filyta">
        <nav className="mapplista" aria-label="Mappar">
          {mappar.map((m) => (
            <button key={m} className={`mapp ${m === vald ? "aktiv" : ""}`} onClick={() => { setVald(m); setVersioner(null); }}>
              <span aria-hidden="true">📁</span> {m}
              <span className="antal">{antalIMapp(m) || ""}</span>
            </button>
          ))}
        </nav>

        <section
          className={`filinnehall ${drar ? "drar" : ""}`}
          onDragOver={(e) => { if (!lasläge) { e.preventDefault(); setDrar(true); } }}
          onDragLeave={() => setDrar(false)}
          onDrop={(e) => { e.preventDefault(); setDrar(false); if (!lasläge) void ladda(e.dataTransfer.files); }}
        >
          <div className="verktygsrad">
            <b>{vald}</b>
            {!lasläge && (
              <>
                <input ref={valjare} type="file" multiple hidden onChange={(e) => e.target.files && void ladda(e.target.files)} />
                <button className="knapp primar" disabled={laddar} onClick={() => valjare.current?.click()}>
                  {laddar ? "Laddar upp…" : "+ Ladda upp filer"}
                </button>
                <span className="dampad">eller dra filerna hit</span>
              </>
            )}
          </div>

          {filer === null ? <p className="dampad">Hämtar…</p> : iMappen.length === 0 ? (
            <p className="tomruta">Inga filer i den här mappen än.</p>
          ) : (
            <table className="grid fillista">
              <thead><tr><th>Namn</th><th>Version</th><th>Storlek</th><th>Uppladdad</th><th>Av</th><th /></tr></thead>
              <tbody>
                {iMappen.map((f) => (
                  <tr key={f.id}>
                    <td><button className="lank" onClick={() => void hamtaFil(f)}>{f.namn}</button></td>
                    <td>
                      {f.antalVersioner > 1
                        ? <button className="lank" onClick={() => void visaVersioner(f)}>v{f.version} ({f.antalVersioner})</button>
                        : `v${f.version}`}
                    </td>
                    <td className="mono">{storlek(f.storlek)}</td>
                    <td>{tid(f.uppladdad)}</td>
                    <td>{f.uppladdadAv}</td>
                    <td className="hoger">
                      {!lasläge && <button className="knapp fara liten" onClick={() => void taBort(f)}>Ta bort</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {versioner && (
            <div className="panel versioner">
              <div className="panelhuvud">
                <h2>Versioner av {versioner.fil.namn}</h2>
                <button className="knapp" onClick={() => setVersioner(null)}>Stäng</button>
              </div>
              <ul className="minilista">
                {versioner.lista.map((v) => (
                  <li key={v.id}>
                    <button className="lank" onClick={() => void hamtaFil(v)}>Version {v.version}</button>
                    <span className="dampad">{tid(v.uppladdad)} · {v.uppladdadAv} · {storlek(v.storlek)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
