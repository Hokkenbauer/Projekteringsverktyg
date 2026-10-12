import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, skicka } from "../../lib/api";
import type { Projekt } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

export function ProjektLista({ onOppna, kanSkapa, kanTaBort }: { onOppna: (id: string) => void; kanSkapa: boolean; kanTaBort: boolean }) {
  const [projekt, setProjekt] = useState<Projekt[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [nytt, setNytt] = useState({ namn: "", nummer: "", kund: "" });
  const [sparar, setSparar] = useState(false);
  const [importerar, setImporterar] = useState(false);
  const [importerat, setImporterat] = useState<{ projekt: Projekt; rapport: string[]; varningar: string[] } | null>(null);
  const importFil = useRef<HTMLInputElement>(null);
  const [taBort, setTaBort] = useState<Projekt | null>(null);
  const [bekraftelse, setBekraftelse] = useState("");
  const [tarBort, setTarBort] = useState(false);

  const taBortProjekt = async () => {
    if (!taBort) return;
    setTarBort(true);
    try {
      await api(`/api/projekt/${taBort.id}?bekrafta=${encodeURIComponent(bekraftelse.trim())}`, { method: "DELETE" });
      setProjekt((l) => l?.filter((p) => p.id !== taBort.id) ?? l);
      if (importerat?.projekt.id === taBort.id) setImporterat(null);
      setTaBort(null);
    } catch (err) {
      setFel(`Projektet kunde inte tas bort: ${(err as Error).message}`);
    } finally {
      setTarBort(false);
    }
  };

  const importera = async (fil: File) => {
    const form = new FormData();
    form.append("fil", fil, fil.name);
    setImporterar(true);
    setFel(null);
    try {
      const svar = await api<{ projekt: Projekt; rapport: string[]; varningar: string[] }>("/api/projekt/import", { method: "POST", body: form });
      setImporterat(svar);
      setProjekt((l) => [svar.projekt, ...(l ?? [])]);
    } catch (err) {
      setFel(`Importen misslyckades: ${(err as Error).message}`);
    } finally {
      setImporterar(false);
    }
  };

  useEffect(() => {
    api<Projekt[]>("/api/projekt").then(setProjekt).catch((e) => setFel(String(e.message ?? e)));
  }, []);

  const skapa = async (e: FormEvent) => {
    e.preventDefault();
    if (!nytt.namn.trim()) return;
    setSparar(true);
    try {
      const p = await api<Projekt>("/api/projekt", { method: "POST", body: skicka(nytt) });
      onOppna(p.id);
    } catch (err) {
      setFel(String((err as Error).message));
    } finally {
      setSparar(false);
    }
  };

  return (
    <main className="startsida">
      <div className="brodsmula">Projekteringsverktyg</div>
      <h1>Projekt</h1>
      {fel && <p className="felruta">{fel.startsWith("Importen") || fel.startsWith("Projektet kunde") ? fel : `Det gick inte att hämta projekten: ${fel}`}</p>}

      {kanSkapa && <section className="panel">
        <h2>Nytt projekt</h2>
        <form className="nytt-projekt" onSubmit={skapa}>
          <label>Projektnamn<input required value={nytt.namn} onChange={(e) => setNytt({ ...nytt, namn: e.target.value })} placeholder="Kv. Lärkan 4 – Ombyggnad ventilation" /></label>
          <label>Projektnummer<input value={nytt.nummer} onChange={(e) => setNytt({ ...nytt, nummer: e.target.value })} placeholder="P-2026-118" /></label>
          <label>Kund<input value={nytt.kund} onChange={(e) => setNytt({ ...nytt, kund: e.target.value })} /></label>
          <button className="knapp primar" disabled={sparar || !nytt.namn.trim()}>{sparar ? "Skapar…" : "Skapa projekt"}</button>
        </form>
      </section>}

      {kanSkapa && <section className="panel">
        <h2>Importera från dagens program</h2>
        <p className="dampad">
          Välj projektfilen (.projxml) från ProjektVerktyg 2.2. Ett nytt projekt skapas med komponenter, listor, kontroller,
          apparatskåp, modulbeläggning, texter och övrigt. Placeringsritningen (.sro.json) läser du in efteråt under
          Placeringsritningar → Mer → Importera ritning från dagens program; komponenterna kopplas då ihop på beteckningen.
        </p>
        <button className="knapp primar" disabled={importerar} onClick={() => importFil.current?.click()}>
          {importerar ? "Importerar…" : "Välj projektfil (.projxml)…"}
        </button>
        <input ref={importFil} type="file" accept=".projxml,.xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importera(f); }} />
        {importerat && (
          <div className="importrapport">
            <p><b>{importerat.projekt.namn}</b> är importerat.</p>
            <ul>{importerat.rapport.map((r) => <li key={r}>{r}</li>)}</ul>
            {importerat.varningar.length > 0 && <ul className="varningar">{importerat.varningar.map((r) => <li key={r}>{r}</li>)}</ul>}
            <button className="knapp primar" onClick={() => onOppna(importerat.projekt.id)}>Öppna projektet</button>
          </div>
        )}
      </section>}

      <section className="panel">
        <h2>Alla projekt</h2>
        {projekt === null && !fel && <p className="dampad">Hämtar…</p>}
        {projekt?.length === 0 && <p className="dampad">{kanSkapa ? "Inga projekt än. Skapa det första ovan." : "Du är inte medlem i något projekt än. Be en projektledare lägga till dig."}</p>}
        {!!projekt?.length && (
          <ul className="projektlista">
            {projekt.map((p) => (
              <li key={p.id} className={kanTaBort ? "medtabort" : ""}>
                {kanTaBort && <button className="knapp fara tabortprojekt" title="Ta bort projektet" onClick={() => { setTaBort(p); setBekraftelse(""); }}>Ta bort…</button>}
                <button onClick={() => onOppna(p.id)}>
                  <b>{p.namn}</b>
                  <span>{[p.nummer, p.kund].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="dampad">{p.antalKomponenter} komponenter · skapat av {p.skapadAv}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        titel="Ta bort projekt" oppen={taBort !== null} onStang={() => { if (!tarBort) setTaBort(null); }}
        fot={<>
          <button className="knapp" disabled={tarBort} onClick={() => setTaBort(null)}>Avbryt</button>
          <button className="knapp fara" disabled={tarBort || bekraftelse.trim().toLowerCase() !== (taBort?.namn ?? "").trim().toLowerCase()} onClick={() => void taBortProjekt()}>
            {tarBort ? "Tar bort…" : "Ta bort projektet för alltid"}
          </button>
        </>}
      >
        {taBort && (
          <>
            <p>
              Hela <b>{taBort.namn}</b> tas bort för alla: komponenter, listor, kontroller, ritningar, skåp, dokument,
              projektfiler och ändringslogg. Det går inte att ångra i appen.
            </p>
            <p className="dampad liten">Skriv projektets namn för att bekräfta.</p>
            <input className="bekrafta" value={bekraftelse} autoFocus placeholder={taBort.namn} onChange={(e) => setBekraftelse(e.target.value)} />
          </>
        )}
      </Dialog>
    </main>
  );
}
