import { useEffect, useMemo, useRef, useState } from "react";
import { DriftkortSidfotDialog } from "../ritning/DriftkortSidfot";
import { api, ApiFel, laddaNer, skicka } from "../../lib/api";
import { arFormaterad, dela, harWordFormat, sattIhop, systemINamn, textAv } from "../../lib/funktionstext";
import { KomponentSok, type Kalla } from "./KomponentSok";
import { useKatalog } from "../../lib/katalog";
import type { Komponent, Projekt, ProjektDokument } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";
import { Dialog } from "../../shell/Dialog";
import { RikEditor } from "./RikEditor";

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
  /** Projektets komponenter, för att jämföra beteckningarna i en funktionstext. */
  komponenter?: Komponent[];
  onNyKomponent?: (k: Komponent) => void;
};

type ImportSvar = { skapade: ProjektDokument[]; rapport: { fil: string; namn: string; system: string | null; stycken: number; tabeller: number; fel: string | null }[] };

/**
 * Funktionstexter och Projekteringsstöd. Till vänster katalogen (rubrik → mall) och, för funktionstexter,
 * projektets egna texter. En mall kopieras till projektet med "Spara i projektet"; originalet ändras inte.
 * Admin, Projektledare och System kan även ändra katalogen.
 */
export function TextKatalogVy(p: Props) {
  const ft = p.lage === "funktionstexter";
  const kat = useKatalog<TextKatalog>(p.lage, TOM);
  const [sparade, setSparade] = useState<ProjektDokument[] | null>(ft ? null : []);
  const [sidfotOppen, setSidfotOppen] = useState(false);
  const [val, setVal] = useState<Val>(null);
  const [text, setText] = useState("");
  const [mallNamn, setMallNamn] = useState("");
  const [sok, setSok] = useState("");
  const [oppna, setOppna] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const timer = useRef<number | undefined>(undefined);
  const importFil = useRef<HTMLInputElement>(null);
  const [importerar, setImporterar] = useState(false);
  /** Projektets texter som är markerade (för att ta bort flera på en gång). */
  const [markerade, setMarkerade] = useState<Set<string>>(new Set());
  const [allaKomponenterOppen, setAllaKomponenterOppen] = useState(false);
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
  const valdSparadNu = valdSparad;

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

  const bytNamn = async (vilken?: ProjektDokument) => {
    const valdSparad = vilken ?? valdSparadNu;
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

  /**
   * Tar bort texter ur projektet. Pågående sparning stoppas först (annars kan en sen sparning försöka skriva till
   * en borttagen text), och listan hämtas om från servern efteråt så att det som visas stämmer.
   */
  const taBortTexter = async (ids: string[]) => {
    const namn = (sparade ?? []).filter((d) => ids.includes(d.id)).map((d) => d.namn);
    if (!ids.length || !window.confirm(ids.length === 1 ? `Ta bort ${namn[0]} från projektet?` : `Ta bort ${ids.length} texter från projektet?\n\n${namn.join("\n")}`)) return;
    window.clearTimeout(timer.current);
    if (val?.typ === "sparad" && ids.includes(val.id)) { setVal(null); setText(""); setStatus("sparat"); }
    const fel: string[] = [];
    for (const id of ids) {
      try { await api(`/api/projekt/${p.projektId}/dokument/${id}`, { method: "DELETE" }); }
      catch (e) { if (!(e instanceof ApiFel && e.status === 404)) fel.push(`${(sparade ?? []).find((d) => d.id === id)?.namn ?? id}: ${(e as Error).message}`); }
    }
    setMarkerade(new Set());
    let kvar: ProjektDokument[] = [];
    try { kvar = (await hamtaSparade()).filter((d) => ids.includes(d.id)); } catch { /* listan hämtas om vid nästa ändring */ }
    if (fel.length || kvar.length) p.visaMeddelande(`Kunde inte ta bort: ${fel.length ? fel.join("; ") : kvar.map((d) => d.namn).join(", ")}`);
    else p.visaMeddelande(ids.length === 1 ? `${namn[0]} är borttagen.` : `${ids.length} texter är borttagna.`);
  };
  const taBortSparad = () => { if (valdSparad) void taBortTexter([valdSparad.id]); };

  /** Sätter systemet (för beteckningar utan systemnamn) i en importerad text. */
  const sattSystem = async (id: string, system: string) => {
    const d = sparade?.find((x) => x.id === id);
    if (!d || !arFormaterad(d.data)) return;
    const { meta, html } = dela(d.data);
    const data = sattIhop({ ...meta, System: system || null }, html);
    if (val?.typ === "sparad" && val.id === id) { andraText(data); return; }
    try {
      const ny = await api<ProjektDokument>(`/api/projekt/${p.projektId}/dokument/${id}`, { method: "PUT", body: skicka({ data, version: d.version }) });
      setSparade((l) => l?.map((x) => (x.id === id ? ny : x)) ?? l);
    } catch (e) { p.visaMeddelande(`Systemet kunde inte sparas: ${(e as Error).message}`); }
  };
  /** Text att söka komponenter i, med system ur texten (eller ur namnet). */
  const kalla = (d: ProjektDokument, data = d.data): Kalla => ({
    id: d.id, namn: d.namn, text: textAv(data),
    system: (arFormaterad(data) ? dela(data).meta.System ?? "" : "") || systemINamn(d.namn)[0] || "",
  });

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

  const escH = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const skrivUtAlla = () => {
    if (!sparade?.length) return;
    skrivUt(p.rubrik, p.projekt, { typ: "html", html: sparade.map((d) => `<div class="ftnamn">${escH(d.namn)}</div>${dela(d.data).html}`).join("") });
  };
  // Utskrift i Word utan flödesbilder: en text, några eller alla i en fil, i mallens Word-stil med projektets sidfot.
  const [wordVal, setWordVal] = useState<Set<string> | null>(null);
  const [wordArbetar, setWordArbetar] = useState(false);
  const laddaNerWord = async (ids: string[]) => {
    if (!ids.length) return;
    setWordArbetar(true);
    try {
      await lamna();
      const forsta = sparade?.find((d) => d.id === ids[0]);
      const namn = ids.length === 1 && forsta ? (/\.docx$/i.test(forsta.namn) ? forsta.namn : `${forsta.namn}.docx`)
        : `Funktionstexter ${[p.projekt?.nummer, p.projekt?.namn].filter(Boolean).join(" ")}.docx`;
      await laddaNer(`/api/projekt/${p.projektId}/funktionstexter/word?ids=${ids.join(",")}`, namn);
      setWordVal(null);
    } catch (e) { p.visaMeddelande(`Word-filen kunde inte skapas: ${(e as Error).message}`); }
    setWordArbetar(false);
  };
  const skrivUtValt = () => {
    if (arFormaterad(text)) skrivUt(titel || p.rubrik, p.projekt, { typ: "html", html: dela(text).html });
    else skrivUt(titel || p.rubrik, p.projekt, { typ: "text", text });
  };

  // ---- Import av Word-filer (färdiga funktionstexter/driftkort) ----
  const [importStatus, setImportStatus] = useState("");
  /**
   * Varje fil läses in i webbläsaren först och skickas sedan för sig. En fil som inte går att läsa
   * (öppen i Word, bara sparad i molnet/OneDrive, eller ändrad efter att den valdes) ger då ett
   * begripligt meddelande för just den filen, och de andra importeras ändå.
   */
  const importera = async (filer: File[]) => {
    if (!filer.length) return;
    await lamna();
    setImporterar(true);
    const ok: string[] = [];
    const fel: string[] = [];
    let forsta: ProjektDokument | undefined;
    try {
      for (const [i, f] of filer.entries()) {
        setImportStatus(filer.length > 1 ? ` ${i + 1}/${filer.length}` : "");
        let data: ArrayBuffer;
        try { data = await f.arrayBuffer(); }
        catch {
          fel.push(`${f.name} är troligen öppen i Word. Stäng filen i Word och importera igen. (Ligger den i OneDrive eller SharePoint kan den också behöva laddas ner till datorn först: högerklicka och välj "Behåll alltid på den här enheten".)`);
          continue;
        }
        const form = new FormData();
        form.append("filer", new Blob([data], { type: f.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), f.name);
        try {
          const svar = await api<ImportSvar>(`/api/projekt/${p.projektId}/funktionstexter/import`, { method: "POST", body: form });
          forsta ??= svar.skapade[0];
          svar.rapport.forEach((r) => (r.fel ? fel.push(`${r.fil} – ${r.fel}`) : ok.push(r.namn)));
        } catch (e) {
          const m = (e as Error).message;
          fel.push(`${f.name} – ${/fetch|network/i.test(m) ? "ingen kontakt med servern (kontrollera nätverket/VPN och försök igen)" : m}`);
        }
      }
      await hamtaSparade();
      if (forsta) { setVal({ typ: "sparad", id: forsta.id }); setText(forsta.data); setStatus("sparat"); }
      if (ok.length) p.visaMeddelande(`Importerade: ${ok.join(", ")}.`);
      // Fel visas i en ruta som ligger kvar tills man klickat OK, så att det inte missas.
      if (fel.length) window.alert(`${fel.length === 1 ? "En fil" : `${fel.length} filer`} kunde inte importeras:\n\n${fel.join("\n\n")}`);
    } catch (e) { p.visaMeddelande(`Importen misslyckades: ${(e as Error).message}`); }
    finally { setImporterar(false); setImportStatus(""); }
  };

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {ft && (
            <button className="knapp" onClick={() => setSidfotOppen(true)} title="Status, datum, namn och loggor i sidfoten – gemensamt för projektets driftkort och Word-exporter">Sidfot för driftkort…</button>
          )}
          {ft && !p.lasläge && (
            <button className="knapp" disabled={importerar} onClick={() => importFil.current?.click()} title="Färdiga funktionstexter eller driftkort i Word (.docx). Varje fil blir en text i projektet, kopplad till sitt system.">
              {importerar ? `Importerar${importStatus}…` : "Importera Word…"}
            </button>
          )}
          <input ref={importFil} type="file" multiple hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void importera(f); }} />
          {ft && !!sparade?.length && (
            <button className="knapp primar" title="Funktionstexterna i Word utan flödesbilder, i mallarnas Word-stil med projektets sidfot. Välj alla eller några."
              onClick={() => setWordVal(new Set(sparade.map((d) => d.id)))}>Skriv ut i Word (utan bild)…</button>
          )}
          {ft && !!sparade?.length && p.komponenter && (
            <button className="knapp" onClick={() => setAllaKomponenterOppen(true)} title="Jämför komponenterna i alla projektets texter med Komponenter och lägg till de som saknas">Komponenter ur texterna…</button>
          )}
          {ft && !!sparade?.length && <button className="knapp" onClick={skrivUtAlla} title="Snabb utskrift från webbläsaren (inte Word-stil)">Skriv ut alla (webb)</button>}
          {p.kanRedigeraKatalog && <button className="knapp" onClick={() => void nyRubrik()}>+ Ny rubrik i katalogen</button>}
        </div>
      </div>
      <p className="ingress">
        {ft
          ? "Välj en mall till vänster, anpassa texten och spara den i projektet med ett eget namn. Mallen påverkas inte. Färdiga funktionstexter eller driftkort i Word tar du in med Importera Word. Projektets texter sparas automatiskt medan du skriver."
          : "Referenstexter och checklistor att ha med sig i projekteringen. Inget sparas i projektet, men du kan skriva ut texten."}
        {p.kanRedigeraKatalog && " Du kan även ändra katalogen, som är gemensam för alla projekt."}
      </p>

      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <input className="sok" type="search" placeholder="Sök i mallarna" value={sok} onChange={(e) => setSok(e.target.value)} />
          {ft && (
            <div className="sparadelista">
              <div className="sparadehuvud">
                <h3>Projektets funktionstexter</h3>
                {!p.lasläge && !!sparade?.length && (
                  <label className="kryssrad liten" title="Markera alla">
                    <input type="checkbox" checked={markerade.size === sparade.length && sparade.length > 0}
                      onChange={(e) => setMarkerade(e.target.checked ? new Set(sparade.map((d) => d.id)) : new Set())} /> Alla
                  </label>
                )}
              </div>
              {!p.lasläge && markerade.size > 0 && (
                <div className="sparadeverktyg">
                  <span className="liten">{markerade.size} markerade</span>
                  <button className="knapp liten fara" onClick={() => void taBortTexter([...markerade])}>Ta bort markerade</button>
                  <button className="knapp liten" onClick={() => setMarkerade(new Set())}>Avmarkera</button>
                </div>
              )}
              {sparade === null ? <span className="dampad liten">Hämtar…</span>
                : sparade.length === 0 ? <span className="dampad liten">Inga än. Välj en mall och klicka på Spara i projektet.</span>
                : sparade.map((d) => (
                  <div key={d.id} className="sparadrad">
                  {!p.lasläge && (
                    <input type="checkbox" aria-label={`Markera ${d.namn}`} checked={markerade.has(d.id)}
                      onChange={(e) => setMarkerade((m) => { const n = new Set(m); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                  )}
                  <button
                    className={`katalograd ${val?.typ === "sparad" && val.id === d.id ? "aktiv" : ""}`}
                    title={p.lasläge ? d.namn : `${d.namn} – dubbelklicka för att byta namn`}
                    onClick={() => void valjSparad(d)}
                    onDoubleClick={() => { if (!p.lasläge) void valjSparad(d).then(() => bytNamn(d)); }}
                  >
                    {d.namn}{arFormaterad(d.data) && <span className="dampad liten"> · {dela(d.data).meta.System ? `${dela(d.data).meta.System} · ` : ""}Word</span>}
                    {arFormaterad(d.data) && !harWordFormat(d.data) && (
                      <span className="liten" style={{ color: "var(--varning)" }} title="Texten importerades innan Words formatering sparades. Importera Word-filen igen för att få originalets typsnitt, storlekar och tabellbredder i exporten."> · importera om för originalformat</span>
                    )}
                  </button>
                  </div>
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
                {valdSparad && <button className="knapp" title="Den här texten i Word utan flödesbild, i mallens Word-stil med projektets sidfot" onClick={() => void lamna().then(() => laddaNer(`/api/projekt/${p.projektId}/funktionstexter/${valdSparad.id}/word`, /\.docx$/i.test(valdSparad.namn) ? valdSparad.namn : `${valdSparad.namn}.docx`))}>Word (utan bild)</button>}
                <button className="knapp" onClick={skrivUtValt}>Skriv ut / PDF</button>
              </div>
              {val.typ === "sparad" && arFormaterad(text) ? (
                <RikEditor
                  html={dela(text).html} lasläge={p.lasläge}
                  onAndra={(html) => andraText(sattIhop(dela(text).meta, html))}
                  onLamna={() => void lamna()}
                />
              ) : (
                <textarea
                  className="stortext" value={text} spellCheck
                  readOnly={p.lasläge && val.typ === "sparad"}
                  onChange={(e) => andraText(e.target.value)}
                  onBlur={() => void lamna()}
                />
              )}
              {ft && valdSparad && p.komponenter && (
                <details className="kompitext">
                  <summary>Komponenter i texten – jämför med Komponenter</summary>
                  <KomponentSok
                    projektId={p.projektId} kallor={[kalla(valdSparad, text)]} komponenter={p.komponenter} lasläge={p.lasläge}
                    onSattSystem={arFormaterad(text) ? (id, sy) => void sattSystem(id, sy) : undefined}
                    onNyKomponent={p.onNyKomponent} visaMeddelande={p.visaMeddelande}
                  />
                </details>
              )}
              {val.typ === "mall" && ft && (
                <p className="dampad liten">Ändringar här sparas inte i mallen. Klicka på Spara i projektet för att spara texten som projektets egen.</p>
              )}
            </>
          )}
        </section>
      </div>
      {ft && allaKomponenterOppen && sparade && p.komponenter && (
        <Dialog titel="Komponenter ur projektets texter" oppen onStang={() => setAllaKomponenterOppen(false)} bred
          fot={<button className="knapp" onClick={() => setAllaKomponenterOppen(false)}>Stäng</button>}>
          <KomponentSok
            projektId={p.projektId} kallor={sparade.map((d) => kalla(d))} komponenter={p.komponenter} lasläge={p.lasläge}
            onSattSystem={(id, sy) => void sattSystem(id, sy)} onNyKomponent={p.onNyKomponent} visaMeddelande={p.visaMeddelande}
          />
        </Dialog>
      )}
      {ft && wordVal && sparade && (
        <Dialog
          titel="Skriv ut funktionstexter i Word" oppen={!!wordVal} onStang={() => setWordVal(null)}
          fot={<>
            <span className="dampad">{wordVal.size} av {sparade.length} valda</span>
            <button className="knapp" onClick={() => setWordVal(null)}>Avbryt</button>
            <button className="knapp primar" disabled={!wordVal.size || wordArbetar}
              onClick={() => void laddaNerWord(sparade.filter((d) => wordVal.has(d.id)).map((d) => d.id))}>
              {wordArbetar ? "Skapar…" : wordVal.size === 1 ? "Skapa Word-fil" : "Skapa en Word-fil med valda"}
            </button>
          </>}
        >
          <p className="dampad liten" style={{ marginTop: 0 }}>
            Texterna hamnar i en Word-fil i den ordning de står i listan, utan flödesbilder. Varje text börjar på en ny sida.
            Stil, spalter och sidfot tas från den första textens Word-mall; status, datum och loggor från Sidfot för driftkort.
          </p>
          <div className="knappgrupp" style={{ marginBottom: 8 }}>
            <button type="button" className="knapp liten" onClick={() => setWordVal(new Set(sparade.map((d) => d.id)))}>Välj alla</button>
            <button type="button" className="knapp liten" onClick={() => setWordVal(new Set())}>Välj ingen</button>
          </div>
          <div className="wordval">
            {sparade.map((d) => (
              <label key={d.id} className="kryssrad">
                <input type="checkbox" checked={wordVal.has(d.id)}
                  onChange={(e) => setWordVal((v) => { const n = new Set(v); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                {d.namn}
              </label>
            ))}
          </div>
        </Dialog>
      )}
      {ft && (
        <DriftkortSidfotDialog
          projektId={p.projektId} projekt={p.projekt} oppen={sidfotOppen} lasläge={p.lasläge}
          kanHanteraLoggor={p.kanRedigeraKatalog} visaMeddelande={p.visaMeddelande} onStang={() => setSidfotOppen(false)}
        />
      )}
    </>
  );
}
