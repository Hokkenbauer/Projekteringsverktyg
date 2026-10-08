import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import { useKatalog } from "../../lib/katalog";
import type { Projekt, ProjektDokument } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";

type Mall = { namn: string; text: string };
type Rubrik = { namn: string; mallar: Mall[] };
type TextKatalog = { rubriker: Rubrik[] };
const TOM: TextKatalog = { rubriker: [] };

type Val = { typ: "mall"; r: number; m: number } | { typ: "sparad"; id: string } | null;

type Props = {
  /** funktionstexter: mallar + projektets sparade texter. projekteringsstod: bara referenstexter, inget sparas. */
  lage: "funktionstexter" | "projekteringsstod";
  projektId: string;
  projekt: Projekt | null;
  grupp: string;
  rubrik: string;
  lasläge: boolean;
  kanRedigeraKatalog: boolean;
  /** Räknas upp när någon annan ändrat projektets funktionstexter. */
  uppdaterad: number;
  visaMeddelande: (t: string) => void;
};

/**
 * Funktionstexter och Projekteringsstöd. Till vänster katalogen (rubrik → mall) och, för funktionstexter,
 * projektets egna texter. En mall kopieras till projektet med "Spara i projektet"; originalet ändras inte.
 * Admin, Projektledare och System kan även ändra katalogen.
 */
export function TextKatalogVy(p: Props) {
  const ft = p.lage === "funktionstexter";
  const kat = useKatalog<TextKatalog>(p.lage, TOM);
  const [sparade, setSparade] = useState<ProjektDokument[] | null>(ft ? null : []);
  const [val, setVal] = useState<Val>(null);
  const [text, setText] = useState("");
  const [mallNamn, setMallNamn] = useState("");
  const [sok, setSok] = useState("");
  const [oppna, setOppna] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const timer = useRef<number | undefined>(undefined);
  const valRef = useRef(val);
  valRef.current = val;

  const hamtaSparade = async () => {
    if (!ft) return [];
    const l = await api<ProjektDokument[]>(`/api/projekt/${p.projektId}/dokument?typ=funktionstext`);
    setSparade(l);
    return l;
  };
  useEffect(() => { void hamtaSparade().catch((e) => p.visaMeddelande(`Funktionstexterna kunde inte hämtas: ${(e as Error).message}`)); }, [p.projektId]);

  // Någon annan har ändrat: hämta om, och visa deras text om man inte själv har osparat i samma text.
  useEffect(() => {
    if (!p.uppdaterad || !ft) return;
    void hamtaSparade().then((l) => {
      const v = valRef.current;
      if (v?.typ !== "sparad") return;
      const d = l.find((x) => x.id === v.id);
      if (!d) { setVal(null); setText(""); return; }
      if (status === "sparat") setText(d.data);
    }).catch(() => undefined);
  }, [p.uppdaterad]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rubriker = kat.data?.rubriker ?? [];
  const valdMall = val?.typ === "mall" ? rubriker[val.r]?.mallar[val.m] : undefined;
  const valdSparad = val?.typ === "sparad" ? sparade?.find((d) => d.id === val.id) : undefined;

  const filtrerade = useMemo(() => {
    const s = sok.trim().toLowerCase();
    return rubriker.map((r, ri) => ({
      r, ri,
      mallar: r.mallar.map((m, mi) => ({ m, mi })).filter(({ m }) => !s || m.namn.toLowerCase().includes(s) || m.text.toLowerCase().includes(s) || r.namn.toLowerCase().includes(s)),
    })).filter((x) => !s || x.mallar.length > 0);
  }, [rubriker, sok]);

  const sparaNu = async (id: string, data: string) => {
    const d = sparade?.find((x) => x.id === id);
    if (!d) return;
    setStatus("sparar");
    try {
      const ny = await api<ProjektDokument>(`/api/projekt/${p.projektId}/dokument/${id}`, { method: "PUT", body: skicka({ data, version: d.version }) });
      setSparade((l) => l?.map((x) => (x.id === id ? ny : x)) ?? l);
      setStatus("sparat");
    } catch (e) {
      setStatus("osparat");
      if (e instanceof ApiFel && e.status === 409) {
        const l = await hamtaSparade();
        const aktuell = l.find((x) => x.id === id);
        if (aktuell) setText(aktuell.data);
        setStatus("sparat");
        p.visaMeddelande("Någon annan ändrade texten samtidigt. Deras version visas nu; gör om din senaste ändring.");
      } else p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`);
    }
  };

  const andraText = (t: string) => {
    setText(t);
    if (val?.typ !== "sparad" || p.lasläge) return;
    setStatus("osparat");
    window.clearTimeout(timer.current);
    const id = val.id;
    timer.current = window.setTimeout(() => void sparaNu(id, t), 1000);
  };

  const lamna = async () => {
    window.clearTimeout(timer.current);
    if (val?.typ === "sparad" && status === "osparat") await sparaNu(val.id, text);
  };

  const valjMall = async (r: number, m: number) => {
    await lamna();
    const mall = rubriker[r]?.mallar[m];
    setVal({ typ: "mall", r, m });
    setText(mall?.text ?? "");
    setMallNamn(mall?.namn ?? "");
    setStatus("sparat");
  };
  const valjSparad = async (d: ProjektDokument) => {
    await lamna();
    setVal({ typ: "sparad", id: d.id });
    setText(d.data);
    setStatus("sparat");
  };

  const sparaIProjektet = async () => {
    const namn = window.prompt("Namn på texten i projektet:", valdMall?.namn ?? "Funktionstext");
    if (!namn?.trim()) return;
    try {
      const d = await api<ProjektDokument>(`/api/projekt/${p.projektId}/dokument`, { method: "POST", body: skicka({ typ: "funktionstext", namn, data: text }) });
      setSparade((l) => [...(l ?? []), d]);
      setVal({ typ: "sparad", id: d.id });
      p.visaMeddelande(`${d.namn} är sparad i projektet.`);
    } catch (e) { p.visaMeddelande(`Texten kunde inte sparas: ${(e as Error).message}`); }
  };

  const bytNamn = async () => {
    if (!valdSparad) return;
    const namn = window.prompt("Nytt namn:", valdSparad.namn);
    if (!namn?.trim()) return;
    await lamna();
    try {
      const d = sparade?.find((x) => x.id === valdSparad.id) ?? valdSparad;
      const ny = await api<ProjektDokument>(`/api/projekt/${p.projektId}/dokument/${d.id}`, { method: "PUT", body: skicka({ namn, version: d.version }) });
      setSparade((l) => l?.map((x) => (x.id === ny.id ? ny : x)) ?? l);
    } catch (e) { p.visaMeddelande((e as Error).message); void hamtaSparade(); }
  };

  const taBortSparad = async () => {
    if (!valdSparad || !window.confirm(`Ta bort ${valdSparad.namn} från projektet?`)) return;
    window.clearTimeout(timer.current);
    try {
      await api(`/api/projekt/${p.projektId}/dokument/${valdSparad.id}`, { method: "DELETE" });
      setSparade((l) => l?.filter((x) => x.id !== valdSparad.id) ?? l);
      setVal(null); setText(""); setStatus("sparat");
    } catch (e) { p.visaMeddelande((e as Error).message); }
  };

  // ---- Katalogen (Admin, Projektledare, System) ----
  const sparaKatalog = async (ny: TextKatalog, klart?: string) => {
    try { await kat.spara(ny); if (klart) p.visaMeddelande(klart); return true; }
    catch (e) { p.visaMeddelande((e as Error).message); return false; }
  };
  const kopia = (): Rubrik[] => rubriker.map((r) => ({ ...r, mallar: r.mallar.map((m) => ({ ...m })) }));

  const nyRubrik = async () => {
    const namn = window.prompt("Namn på den nya rubriken:");
    if (!namn?.trim()) return;
    const ny = kopia();
    ny.push({ namn: namn.trim(), mallar: [] });
    if (await sparaKatalog({ rubriker: ny })) setOppna((s) => new Set(s).add(ny.length - 1));
  };
  const bytRubrik = async (ri: number) => {
    const namn = window.prompt("Nytt namn på rubriken:", rubriker[ri]?.namn);
    if (!namn?.trim()) return;
    const ny = kopia();
    ny[ri]!.namn = namn.trim();
    await sparaKatalog({ rubriker: ny });
  };
  const taBortRubrik = async (ri: number) => {
    const r = rubriker[ri];
    if (!r || !window.confirm(`Ta bort rubriken ${r.namn}${r.mallar.length ? ` med ${r.mallar.length} mallar` : ""} ur katalogen? Det gäller alla projekt.`)) return;
    const ny = kopia();
    ny.splice(ri, 1);
    if (await sparaKatalog({ rubriker: ny })) { setVal(null); setText(""); }
  };
  const nyMall = async (ri: number) => {
    const namn = window.prompt(`Namn på den nya mallen under ${rubriker[ri]?.namn}:`);
    if (!namn?.trim()) return;
    const ny = kopia();
    ny[ri]!.mallar.push({ namn: namn.trim(), text: val?.typ === "sparad" ? text : "" });
    if (await sparaKatalog({ rubriker: ny })) {
      setOppna((s) => new Set(s).add(ri));
      void valjMall(ri, ny[ri]!.mallar.length - 1);
    }
  };
  const sparaMall = async () => {
    if (val?.typ !== "mall" || !valdMall) return;
    const ny = kopia();
    ny[val.r]!.mallar[val.m] = { namn: mallNamn.trim() || valdMall.namn, text };
    await sparaKatalog({ rubriker: ny }, "Mallen är sparad i katalogen.");
  };
  const taBortMall = async () => {
    if (val?.typ !== "mall" || !valdMall || !window.confirm(`Ta bort mallen ${valdMall.namn} ur katalogen? Det gäller alla projekt. Texter som redan sparats i projekt påverkas inte.`)) return;
    const ny = kopia();
    ny[val.r]!.mallar.splice(val.m, 1);
    if (await sparaKatalog({ rubriker: ny })) { setVal(null); setText(""); }
  };

  const mallAndrad = !!valdMall && (text !== valdMall.text || (mallNamn.trim() !== "" && mallNamn.trim() !== valdMall.namn));
  const titel = valdSparad?.namn ?? valdMall?.namn ?? "";

  const skrivUtAlla = () => {
    if (!sparade?.length) return;
    skrivUt(p.rubrik, p.projekt, { typ: "text", text: sparade.map((d) => `${d.namn.toUpperCase()}\n\n${d.data.trim()}`).join("\n\n\n") });
  };

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {ft && !!sparade?.length && <button className="knapp" onClick={skrivUtAlla}>Skriv ut alla projektets texter</button>}
          {p.kanRedigeraKatalog && <button className="knapp" onClick={() => void nyRubrik()}>+ Ny rubrik i katalogen</button>}
        </div>
      </div>
      <p className="ingress">
        {ft
          ? "Välj en mall till vänster, anpassa texten och spara den i projektet med ett eget namn. Mallen påverkas inte. Projektets texter sparas automatiskt medan du skriver."
          : "Referenstexter och checklistor att ha med sig i projekteringen. Inget sparas i projektet, men du kan skriva ut texten."}
        {p.kanRedigeraKatalog && " Du kan även ändra katalogen, som är gemensam för alla projekt."}
      </p>

      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <input className="sok" type="search" placeholder="Sök i mallarna" value={sok} onChange={(e) => setSok(e.target.value)} />
          {ft && (
            <div className="sparadelista">
              <h3>Projektets funktionstexter</h3>
              {sparade === null ? <span className="dampad liten">Hämtar…</span>
                : sparade.length === 0 ? <span className="dampad liten">Inga än. Välj en mall och klicka på Spara i projektet.</span>
                : sparade.map((d) => (
                  <button key={d.id} className={`katalograd ${val?.typ === "sparad" && val.id === d.id ? "aktiv" : ""}`} onClick={() => void valjSparad(d)}>
                    {d.namn}
                  </button>
                ))}
            </div>
          )}
          <h3>Mallar</h3>
          {kat.data === null && <span className="dampad liten">Hämtar…</span>}
          {filtrerade.map(({ r, ri, mallar }) => {
            const oppen = oppna.has(ri) || sok.trim() !== "";
            return (
              <div key={ri} className="katalogrubrik">
                <div className="katalogrubrikrad">
                  <button className="rubrikknapp" aria-expanded={oppen} onClick={() => setOppna((s) => { const n = new Set(s); if (n.has(ri)) n.delete(ri); else n.add(ri); return n; })}>
                    <span className="pil">{oppen ? "▾" : "▸"}</span> {r.namn} <span className="dampad">({r.mallar.length})</span>
                  </button>
                  {p.kanRedigeraKatalog && (
                    <span className="radknappar">
                      <button title="Ny mall under rubriken" onClick={() => void nyMall(ri)}>+</button>
                      <button title="Byt namn på rubriken" onClick={() => void bytRubrik(ri)}>✎</button>
                      <button title="Ta bort rubriken" onClick={() => void taBortRubrik(ri)}>✕</button>
                    </span>
                  )}
                </div>
                {oppen && mallar.map(({ m, mi }) => (
                  <button key={mi} className={`katalograd indrag ${val?.typ === "mall" && val.r === ri && val.m === mi ? "aktiv" : ""}`} onClick={() => void valjMall(ri, mi)}>
                    {m.namn}
                  </button>
                ))}
                {oppen && r.mallar.length === 0 && <span className="dampad liten indrag">Inga mallar</span>}
              </div>
            );
          })}
        </aside>

        <section className="panel textyta">
          {!val ? (
            <p className="tomruta">Välj en mall{ft ? " eller en av projektets texter" : ""} till vänster.</p>
          ) : (
            <>
              <div className="textytahuvud">
                {val.typ === "mall" && p.kanRedigeraKatalog
                  ? <input className="mallnamn" value={mallNamn} onChange={(e) => setMallNamn(e.target.value)} aria-label="Mallens namn" />
                  : <h2>{titel}</h2>}
                <span className="dampad liten">
                  {val.typ === "sparad"
                    ? status === "sparar" ? "Sparar…" : status === "osparat" ? "Osparade ändringar" : `Sparad · ändrad av ${valdSparad?.andradAv ?? ""}`
                    : "Mall ur katalogen"}
                </span>
                <span className="grow" />
                {val.typ === "mall" && ft && !p.lasläge && <button className="knapp primar" onClick={() => void sparaIProjektet()}>Spara i projektet…</button>}
                {val.typ === "mall" && p.kanRedigeraKatalog && (
                  <>
                    <button className="knapp" disabled={!mallAndrad} onClick={() => void sparaMall()}>Spara i katalogen</button>
                    <button className="knapp fara" onClick={() => void taBortMall()}>Ta bort ur katalogen</button>
                  </>
                )}
                {val.typ === "sparad" && !p.lasläge && (
                  <>
                    <button className="knapp" onClick={() => void bytNamn()}>Byt namn</button>
                    <button className="knapp fara" onClick={() => void taBortSparad()}>Ta bort</button>
                  </>
                )}
                <button className="knapp" onClick={() => skrivUt(titel || p.rubrik, p.projekt, { typ: "text", text })}>Skriv ut / PDF</button>
              </div>
              <textarea
                className="stortext" value={text} spellCheck
                readOnly={p.lasläge && val.typ === "sparad"}
                onChange={(e) => andraText(e.target.value)}
                onBlur={() => void lamna()}
              />
              {val.typ === "mall" && ft && (
                <p className="dampad liten">Ändringar här sparas inte i mallen. Klicka på Spara i projektet för att spara texten som projektets egen.</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
