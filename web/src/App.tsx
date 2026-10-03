import { useCallback, useEffect, useRef, useState } from "react";
import { api, sattTokenKalla, skicka } from "./lib/api";
import { devAnvandare, loggaIn, sattDevAnvandare, type AppConfig, type Inloggning } from "./lib/inloggning";
import type { Mig, TemaNamn } from "./lib/typer";
import { Arbetsyta } from "./features/projekt/Arbetsyta";
import { ProjektLista } from "./features/projekt/ProjektLista";
import { AdminVy } from "./features/admin/AdminVy";
import { rollNamn } from "./lib/typer";
import { TEMAN, kommihagTema, tillampaTema } from "./shell/tema";

type Vag = { typ: "lista" } | { typ: "admin" } | { typ: "projekt"; id: string; flik: string };

/** Adressen i webbläsaren: #/ = projektlistan, #/p/<id>/<flik> = ett projekt. */
function lasVag(): Vag {
  if (location.hash.startsWith("#/admin")) return { typ: "admin" };
  const m = location.hash.match(/^#\/p\/([0-9a-f-]{36})(?:\/([\w-]+))?/i);
  return m ? { typ: "projekt", id: m[1]!, flik: m[2] ?? "komponenter" } : { typ: "lista" };
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [inloggning, setInloggning] = useState<Inloggning | null>(null);
  const [mig, setMig] = useState<Mig | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [vag, setVag] = useState<Vag>(lasVag);
  const [meddelande, setMeddelande] = useState<string | null>(null);

  useEffect(() => {
    const vid = () => setVag(lasVag());
    window.addEventListener("hashchange", vid);
    return () => window.removeEventListener("hashchange", vid);
  }, []);

  // Körs en gång (React kör effekter två gånger i utvecklingsläge).
  const startad = useRef(false);
  useEffect(() => {
    if (startad.current) return;
    startad.current = true;
    (async () => {
      try {
        const c = await api<AppConfig>("/api/config");
        setConfig(c);
        const inl = await loggaIn(c);
        if (!inl) return; // omdirigeras till Microsofts inloggning
        sattTokenKalla(inl.hamtaToken);
        setInloggning(inl);
        const m = await api<Mig>("/api/mig");
        setMig(m);
        tillampaTema(m.tema);
        kommihagTema(m.tema);
      } catch (e) {
        setFel((e as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!meddelande) return;
    const t = window.setTimeout(() => setMeddelande(null), 4000);
    return () => window.clearTimeout(t);
  }, [meddelande]);

  const bytTema = async (tema: TemaNamn) => {
    tillampaTema(tema);
    kommihagTema(tema);
    try {
      setMig(await api<Mig>("/api/mig/tema", { method: "PUT", body: skicka({ tema }) }));
    } catch {
      setMeddelande("Temat kunde inte sparas.");
    }
  };

  const hamtaToken = useCallback(() => inloggning!.hamtaToken(), [inloggning]);

  if (fel) {
    return <div className="laddar"><p className="felruta">Appen kunde inte starta: {fel}</p></div>;
  }
  if (!config || !inloggning || !mig) {
    return <div className="laddar"><p className="dampad">Startar…</p></div>;
  }

  return (
    <div className="app">
      <header className="topprad">
        <a className="varumarke" href="#/"><span className="logga">PV</span>Projekteringsverktyg</a>
        <span className="flex" />
        {mig.rattigheter.hanteraAnvandare && <a className="knapp" href="#/admin">Användare och roller</a>}
        {inloggning.utvecklingslage ? (
          <label className="kontroll">
            Utvecklingsläge, inloggad som
            <input
              defaultValue={devAnvandare()}
              onBlur={(e) => { if (e.target.value && e.target.value !== devAnvandare()) { sattDevAnvandare(e.target.value); location.reload(); } }}
            />
          </label>
        ) : (
          <span className="kontroll">{mig.namn} · {rollNamn(mig.roll)}</span>
        )}
        <label className="kontroll">
          Tema
          <select value={mig.tema} onChange={(e) => bytTema(e.target.value as TemaNamn)}>
            {TEMAN.map((t) => <option key={t.id} value={t.id}>{t.namn}</option>)}
          </select>
        </label>
        {!inloggning.utvecklingslage && <button className="knapp" onClick={inloggning.loggaUt}>Logga ut</button>}
      </header>

      {vag.typ === "admin" && mig.rattigheter.hanteraAnvandare ? (
        <AdminVy mig={mig} visaMeddelande={setMeddelande} />
      ) : vag.typ !== "projekt" ? (
        <ProjektLista kanSkapa={mig.rattigheter.skapaProjekt} onOppna={(id) => { location.hash = `#/p/${id}/oversikt`; }} />
      ) : (
        <Arbetsyta
          key={vag.id}
          projektId={vag.id}
          flik={vag.flik}
          mig={mig}
          hamtaToken={hamtaToken}
          onFlik={(f) => { location.hash = `#/p/${vag.id}/${f}`; }}
          onTillbaka={() => { location.hash = "#/"; }}
          visaMeddelande={setMeddelande}
        />
      )}

      {meddelande && <div className="toast" role="status">{meddelande}</div>}
      <footer className="versionsrad">Version {config.version}</footer>
    </div>
  );
}
