import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import type { Projekt, ProjektKategori } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

/** Felmeddelande från servern: valideringsfel (namn upptaget o.d.) visas som de är. */
function felText(err: unknown): string {
  if (err instanceof ApiFel) {
    const fel = (err.data as { errors?: Record<string, string[]> } | undefined)?.errors;
    const forsta = fel && Object.values(fel).flat()[0];
    if (forsta) return forsta;
  }
  return (err as Error).message;
}

const OPPNA_NYCKEL = "pv.projektkategorier.oppna";
const UTAN = "utan";

function lasOppna(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(OPPNA_NYCKEL) ?? "[]") as string[]); } catch { return new Set(); }
}

function datum(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("sv-SE") : "";
}

type DialogLage =
  | { typ: "uppgifter"; p: Projekt }
  | { typ: "arkivera"; p: Projekt }
  | { typ: "flytta"; p: Projekt }
  | { typ: "nyKategori"; foralder: string | null }
  | { typ: "kategoriNamn"; k: ProjektKategori }
  | { typ: "flyttaKategori"; k: ProjektKategori }
  | { typ: "taBortKategori"; k: ProjektKategori };

type MenyVal = { text: string; gor: () => void; fara?: boolean };

/** Liten meny bakom ⋯-knappen. Stängs vid klick utanför eller Esc. */
function RadMeny({ val, etikett }: { val: MenyVal[]; etikett: string }) {
  const [oppen, setOppen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!oppen) return;
    const stang = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOppen(false); };
    document.addEventListener("mousedown", stang);
    document.addEventListener("keydown", stang);
    return () => { document.removeEventListener("mousedown", stang); document.removeEventListener("keydown", stang); };
  }, [oppen]);
  if (val.length === 0) return null;
  return (
    <div className="radmeny" ref={ref}>
      <button className="knapp radmeny-knapp" aria-label={etikett} title={etikett} aria-expanded={oppen} onClick={(e) => { e.stopPropagation(); setOppen((v) => !v); }}>⋯</button>
      {oppen && (
        <div className="radmeny-lista" role="menu">
          {val.map((v) => (
            <button key={v.text} role="menuitem" className={v.fara ? "fara" : ""} onClick={(e) => { e.stopPropagation(); setOppen(false); v.gor(); }}>{v.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjektLista({ onOppna, kanSkapa, kanTaBort }: { onOppna: (id: string) => void; kanSkapa: boolean; kanTaBort: boolean }) {
  // Kategorierna är gemensamma och sköts av den som får skapa projekt (samma regel som på servern).
  const kanOrdna = kanSkapa;
  const [projekt, setProjekt] = useState<Projekt[] | null>(null);
  const [kategorier, setKategorier] = useState<ProjektKategori[]>([]);
  const [fel, setFel] = useState<string | null>(null);
  const [nytt, setNytt] = useState({ namn: "", nummer: "", kund: "" });
  const [sparar, setSparar] = useState(false);
  const [importerar, setImporterar] = useState(false);
  const [importerat, setImporterat] = useState<{ projekt: Projekt; rapport: string[]; varningar: string[] } | null>(null);
  const importFil = useRef<HTMLInputElement>(null);
  const [taBort, setTaBort] = useState<Projekt | null>(null);
  const [bekraftelse, setBekraftelse] = useState("");
  const [tarBort, setTarBort] = useState(false);

  const [sok, setSok] = useState("");
  const [oppna, setOppna] = useState<Set<string>>(lasOppna);
  const [visaArkiv, setVisaArkiv] = useState(false);
  const [dialog, setDialog] = useState<DialogLage | null>(null);
  const [falt, setFalt] = useState({ namn: "", nummer: "", kund: "", kategori: "" });
  const [dialogFel, setDialogFel] = useState<string | null>(null);
  const [arbetar, setArbetar] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const vaxla = (id: string, lage?: boolean) => setOppna((s) => {
    const n = new Set(s);
    if (lage ?? !n.has(id)) n.add(id); else n.delete(id);
    try { localStorage.setItem(OPPNA_NYCKEL, JSON.stringify([...n])); } catch { /* privat läge */ }
    return n;
  });

  const hamta = () => {
    api<Projekt[]>("/api/projekt").then(setProjekt).catch((e) => setFel(String(e.message ?? e)));
    api<ProjektKategori[]>("/api/projektkategorier").then(setKategorier).catch(() => setKategorier([]));
  };
  useEffect(hamta, []);

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
      // .zip = projektexport från det här verktyget, annars projektfil (.projxml) från dagens program.
      const url = /\.zip$/i.test(fil.name) ? "/api/projekt/import-export" : "/api/projekt/import";
      const svar = await api<{ projekt: Projekt; rapport: string[]; varningar: string[] }>(url, { method: "POST", body: form });
      setImporterat(svar);
      setProjekt((l) => [{ ...svar.projekt, kanLeda: true }, ...(l ?? [])]);
    } catch (err) {
      setFel(`Importen misslyckades: ${(err as Error).message}`);
    } finally {
      setImporterar(false);
    }
  };

  const skapa = async (e: FormEvent) => {
    e.preventDefault();
    if (!nytt.namn.trim()) return;
    setSparar(true);
    try {
      const p = await api<Projekt>("/api/projekt", { method: "POST", body: skicka(nytt) });
      onOppna(p.id);
    } catch (err) {
      setFel(`Projektet kunde inte skapas: ${felText(err)}`);
    } finally {
      setSparar(false);
    }
  };

  // --- Kategoriträdet ---
  const katMap = useMemo(() => new Map(kategorier.map((k) => [k.id, k])), [kategorier]);
  const barnAv = useMemo(() => {
    const m = new Map<string | null, ProjektKategori[]>();
    for (const k of kategorier) {
      const f = k.foralderId && katMap.has(k.foralderId) ? k.foralderId : null;
      m.set(f, [...(m.get(f) ?? []), k]);
    }
    for (const l of m.values()) l.sort((a, b) => a.ordning - b.ordning || a.namn.localeCompare(b.namn, "sv"));
    return m;
  }, [kategorier, katMap]);
  const aktiva = useMemo(() => (projekt ?? []).filter((p) => !p.arkiverad), [projekt]);
  const arkiverade = useMemo(() => (projekt ?? []).filter((p) => p.arkiverad).sort((a, b) => (b.arkiverad ?? "").localeCompare(a.arkiverad ?? "")), [projekt]);
  const iKategori = (id: string | null) => aktiva.filter((p) => (p.kategoriId && katMap.has(p.kategoriId) ? p.kategoriId : null) === id);
  const antalUnder = (id: string): number => iKategori(id).length + (barnAv.get(id) ?? []).reduce((s, b) => s + antalUnder(b.id), 0);
  const sokvag = (id: string | null | undefined): string => {
    const delar: string[] = [];
    let k = id ? katMap.get(id) : undefined;
    while (k && delar.length < 10) { delar.unshift(k.namn); k = k.foralderId ? katMap.get(k.foralderId) : undefined; }
    return delar.join(" › ");
  };
  /** Alla kategorier i trädordning med indrag, för rullistor. */
  const tradlista = useMemo(() => {
    const ut: { k: ProjektKategori; djup: number }[] = [];
    const ga = (f: string | null, djup: number) => { for (const k of barnAv.get(f) ?? []) { ut.push({ k, djup }); ga(k.id, djup + 1); } };
    ga(null, 0);
    return ut;
  }, [barnAv]);
  const underIds = (id: string): Set<string> => {
    const s = new Set<string>([id]);
    const ga = (f: string) => { for (const b of barnAv.get(f) ?? []) { s.add(b.id); ga(b.id); } };
    ga(id);
    return s;
  };

  // --- Åtgärder ---
  const oppnaDialog = (d: DialogLage) => {
    setDialogFel(null);
    if (d.typ === "uppgifter") setFalt({ namn: d.p.namn, nummer: d.p.nummer, kund: d.p.kund, kategori: "" });
    else if (d.typ === "flytta") setFalt({ namn: "", nummer: "", kund: "", kategori: d.p.kategoriId ?? "" });
    else if (d.typ === "kategoriNamn") setFalt({ namn: d.k.namn, nummer: "", kund: "", kategori: "" });
    else if (d.typ === "flyttaKategori") setFalt({ namn: "", nummer: "", kund: "", kategori: d.k.foralderId ?? "" });
    else setFalt({ namn: "", nummer: "", kund: "", kategori: "" });
    setDialog(d);
  };

  const uppdatera = (p: Projekt) => setProjekt((l) => l?.map((x) => (x.id === p.id ? { ...x, ...p, kategoriId: x.kategoriId, kanLeda: x.kanLeda } : x)) ?? l);

  const flyttaProjekt = async (p: Projekt, kategoriId: string | null) => {
    if ((p.kategoriId ?? null) === kategoriId) return;
    const fore = p.kategoriId;
    setProjekt((l) => l?.map((x) => (x.id === p.id ? { ...x, kategoriId } : x)) ?? l);
    if (kategoriId) vaxla(kategoriId, true);
    try {
      await api("/api/projektkategorier/placering", { method: "PUT", body: skicka({ projektId: p.id, kategoriId }) });
    } catch (err) {
      setProjekt((l) => l?.map((x) => (x.id === p.id ? { ...x, kategoriId: fore } : x)) ?? l);
      setFel(`Projektet kunde inte flyttas: ${felText(err)}`);
    }
  };

  const utfor = async () => {
    if (!dialog) return;
    setArbetar(true);
    setDialogFel(null);
    try {
      switch (dialog.typ) {
        case "uppgifter":
          uppdatera(await api<Projekt>(`/api/projekt/${dialog.p.id}/uppgifter`, { method: "PUT", body: skicka({ namn: falt.namn, nummer: falt.nummer, kund: falt.kund }) }));
          break;
        case "arkivera":
          uppdatera(await api<Projekt>(`/api/projekt/${dialog.p.id}/arkivera`, { method: "POST" }));
          break;
        case "flytta":
          await flyttaProjekt(dialog.p, falt.kategori || null);
          break;
        case "nyKategori": {
          const k = await api<ProjektKategori>("/api/projektkategorier", { method: "POST", body: skicka({ namn: falt.namn, foralderId: dialog.foralder }) });
          setKategorier((l) => [...l, k]);
          if (dialog.foralder) vaxla(dialog.foralder, true);
          break;
        }
        case "kategoriNamn": {
          const k = await api<ProjektKategori>(`/api/projektkategorier/${dialog.k.id}`, { method: "PUT", body: skicka({ namn: falt.namn }) });
          setKategorier((l) => l.map((x) => (x.id === k.id ? k : x)));
          break;
        }
        case "flyttaKategori": {
          const till = falt.kategori || null;
          const k = await api<ProjektKategori>(`/api/projektkategorier/${dialog.k.id}`, { method: "PUT", body: skicka({ foralderId: till, flyttaTillToppen: till === null }) });
          setKategorier((l) => l.map((x) => (x.id === k.id ? k : x)));
          if (till) vaxla(till, true);
          break;
        }
        case "taBortKategori":
          await api(`/api/projektkategorier/${dialog.k.id}`, { method: "DELETE" });
          hamta();
          break;
      }
      setDialog(null);
    } catch (err) {
      setDialogFel(felText(err));
    } finally {
      setArbetar(false);
    }
  };

  const aterstall = async (p: Projekt) => {
    try {
      uppdatera(await api<Projekt>(`/api/projekt/${p.id}/aterstall`, { method: "POST" }));
    } catch (err) {
      setFel(`Projektet kunde inte återställas: ${felText(err)}`);
    }
  };

  // --- Rader ---
  const projektVal = (p: Projekt): MenyVal[] => [
    ...(p.kanLeda ? [{ text: "Ändra namn…", gor: () => oppnaDialog({ typ: "uppgifter", p }) }] : []),
    ...(kanOrdna && !p.arkiverad ? [{ text: "Flytta till kategori…", gor: () => oppnaDialog({ typ: "flytta", p }) }] : []),
    ...(p.kanLeda && !p.arkiverad ? [{ text: "Arkivera…", gor: () => oppnaDialog({ typ: "arkivera", p }) }] : []),
    ...(p.kanLeda && p.arkiverad ? [{ text: "Återställ från arkivet", gor: () => void aterstall(p) }] : []),
    ...(kanTaBort ? [{ text: "Ta bort…", fara: true, gor: () => { setTaBort(p); setBekraftelse(""); } }] : []),
  ];

  const projektRad = (p: Projekt, visaVag = false) => (
    <li
      key={p.id} className="projektrad"
      draggable={kanOrdna && !p.arkiverad}
      onDragStart={(e) => { e.dataTransfer.setData("text/projekt", p.id); e.dataTransfer.effectAllowed = "move"; }}
    >
      <button className="projektknapp" onClick={() => onOppna(p.id)}>
        <b>{p.namn}</b>
        <span>{[p.nummer, p.kund].filter(Boolean).join(" · ") || "—"}{visaVag && (p.arkiverad ? " · Arkiv" : sokvag(p.kategoriId) ? ` · ${sokvag(p.kategoriId)}` : "")}</span>
        <span className="dampad">
          {p.antalKomponenter} komponenter · skapat av {p.skapadAv}
          {p.arkiverad && ` · arkiverat ${datum(p.arkiverad)}`}
        </span>
      </button>
      <RadMeny etikett={`Hantera ${p.namn}`} val={projektVal(p)} />
    </li>
  );

  const slapp = (kategoriId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (kanOrdna && e.dataTransfer.types.includes("text/projekt")) { e.preventDefault(); setDragOver(kategoriId ?? UTAN); } },
    onDragLeave: () => setDragOver((d) => (d === (kategoriId ?? UTAN) ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const p = projekt?.find((x) => x.id === e.dataTransfer.getData("text/projekt"));
      if (p) void flyttaProjekt(p, kategoriId);
    },
  });

  const mapp = (id: string, rubrik: ReactNode, antal: number, innehall: ReactNode, meny: ReactNode, slappMal: string | null | undefined, djup: number) => {
    const oppen = oppna.has(id);
    return (
      <li key={id} className="kategori" style={{ ["--djup" as string]: djup }}>
        <div className={`kategorihuvud${dragOver === (slappMal === null ? UTAN : slappMal) && slappMal !== undefined ? " slapp" : ""}`} {...(slappMal !== undefined ? slapp(slappMal) : {})}>
          <button className="kategoriknapp" aria-expanded={oppen} onClick={() => vaxla(id)}>
            <span className="pil" aria-hidden="true">{oppen ? "▾" : "▸"}</span>
            <span className="mappnamn">{rubrik}</span>
            <span className="antal">{antal}</span>
          </button>
          {meny}
        </div>
        {oppen && innehall}
      </li>
    );
  };

  const kategoriNod = (k: ProjektKategori, djup: number): ReactNode => {
    const barn = barnAv.get(k.id) ?? [];
    const egna = iKategori(k.id);
    const val: MenyVal[] = kanOrdna ? [
      ...(djup < 5 ? [{ text: "Ny underkategori…", gor: () => oppnaDialog({ typ: "nyKategori", foralder: k.id }) }] : []),
      { text: "Byt namn…", gor: () => oppnaDialog({ typ: "kategoriNamn", k }) },
      { text: "Flytta till…", gor: () => oppnaDialog({ typ: "flyttaKategori", k }) },
      { text: "Ta bort kategorin…", fara: true, gor: () => oppnaDialog({ typ: "taBortKategori", k }) },
    ] : [];
    return mapp(
      k.id, k.namn, antalUnder(k.id),
      <ul className="kategoriinnehall">
        {barn.map((b) => kategoriNod(b, djup + 1))}
        {egna.map((p) => projektRad(p))}
        {barn.length === 0 && egna.length === 0 && <li className="dampad liten tomkategori">Tom{kanOrdna ? " – dra hit projekt eller använd ⋯ → Flytta till kategori" : ""}</li>}
      </ul>,
      <RadMeny etikett={`Hantera kategorin ${k.namn}`} val={val} />,
      k.id, djup,
    );
  };

  const traffar = useMemo(() => {
    const s = sok.trim().toLowerCase();
    if (!s) return null;
    return (projekt ?? []).filter((p) => [p.namn, p.nummer, p.kund, sokvag(p.kategoriId)].some((v) => v?.toLowerCase().includes(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sok, projekt, katMap]);

  const utan = iKategori(null);
  const harKategorier = kategorier.length > 0;

  // --- Dialoger ---
  const dialogTitel: Record<DialogLage["typ"], string> = {
    uppgifter: "Ändra namn", arkivera: "Arkivera projekt", flytta: "Flytta till kategori", nyKategori: "Ny kategori",
    kategoriNamn: "Byt namn på kategori", flyttaKategori: "Flytta kategori", taBortKategori: "Ta bort kategori",
  };
  const idag = new Date().toLocaleDateString("sv-SE");
  const kanUtfora = !!dialog && !arbetar && (
    dialog.typ === "uppgifter" || dialog.typ === "nyKategori" || dialog.typ === "kategoriNamn" ? falt.namn.trim() !== "" : true);
  const knappText: Record<DialogLage["typ"], string> = {
    uppgifter: "Spara", arkivera: "Arkivera", flytta: "Flytta", nyKategori: "Skapa kategori",
    kategoriNamn: "Spara", flyttaKategori: "Flytta", taBortKategori: "Ta bort kategorin",
  };
  const kategoriVal = (utesluten?: Set<string>, toppText = "Utan kategori") => (
    <select value={falt.kategori} autoFocus onChange={(e) => setFalt({ ...falt, kategori: e.target.value })}>
      <option value="">{toppText}</option>
      {tradlista.filter(({ k }) => !utesluten?.has(k.id)).map(({ k, djup }) => (
        <option key={k.id} value={k.id}>{"   ".repeat(djup)}{k.namn}</option>
      ))}
    </select>
  );

  return (
    <main className="startsida">
      <div className="brodsmula">Projekteringsverktyg</div>
      <h1>Projekt</h1>
      {fel && <p className="felruta">{/^(Importen|Projektet )/.test(fel) ? fel : `Det gick inte att hämta projekten: ${fel}`} <button className="knapp" onClick={() => setFel(null)}>OK</button></p>}

      <section className="panel">
        <div className="panelhuvud projektverktyg">
          <h2>Alla projekt</h2>
          <input className="projektsok" type="search" placeholder="Sök namn, nummer, kund eller kategori" value={sok} onChange={(e) => setSok(e.target.value)} />
          {kanOrdna && <button className="knapp" onClick={() => oppnaDialog({ typ: "nyKategori", foralder: null })}>+ Ny kategori</button>}
        </div>
        {projekt === null && !fel && <p className="dampad">Hämtar…</p>}
        {projekt?.length === 0 && <p className="dampad">{kanSkapa ? "Inga projekt än. Skapa det första nedan." : "Du är inte medlem i något projekt än. Be en projektledare lägga till dig."}</p>}

        {traffar ? (
          traffar.length ? <ul className="projektlista">{traffar.map((p) => projektRad(p, true))}</ul> : <p className="dampad">Inga projekt matchar sökningen.</p>
        ) : !!projekt?.length && (
          <ul className="projektlista kategoritrad">
            {(barnAv.get(null) ?? []).map((k) => kategoriNod(k, 0))}
            {harKategorier
              ? (utan.length > 0 || kanOrdna) && mapp(UTAN, <i>Utan kategori</i>, utan.length,
                  <ul className="kategoriinnehall">
                    {utan.map((p) => projektRad(p))}
                    {utan.length === 0 && <li className="dampad liten tomkategori">Alla projekt ligger i en kategori.</li>}
                  </ul>, null, null, 0)
              : utan.map((p) => projektRad(p))}
          </ul>
        )}
        {!harKategorier && kanOrdna && !!aktiva.length && !traffar && (
          <p className="dampad liten">Tips: skapa kategorier (t.ex. Bravida, HECO) med <b>+ Ny kategori</b> och dra projekten dit.</p>
        )}

        {!traffar && arkiverade.length > 0 && (
          <div className="arkiv">
            <button className="kategoriknapp" aria-expanded={visaArkiv} onClick={() => setVisaArkiv((v) => !v)}>
              <span className="pil" aria-hidden="true">{visaArkiv ? "▾" : "▸"}</span>
              <span className="mappnamn">Arkiv</span>
              <span className="antal">{arkiverade.length}</span>
            </button>
            {visaArkiv && <ul className="projektlista kategoriinnehall">{arkiverade.map((p) => projektRad(p))}</ul>}
          </div>
        )}
      </section>

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
        <h2>Importera projekt</h2>
        <p className="dampad">
          <b>Projektexport (.zip)</b> från Exportera projektet på Översikt: ett nytt projekt skapas med allt som exporterades –
          komponenter med I/O, listor, kontroller, apparatskåp, funktionstexter, ritningar och projektfiler. Det exporterade projektet påverkas inte.
        </p>
        <p className="dampad">
          <b>Projektfil (.projxml)</b> från ProjektVerktyg 2.2: ett nytt projekt skapas med komponenter, listor, kontroller,
          apparatskåp, modulbeläggning, texter och övrigt. Placeringsritningen (.sro.json) läser du in efteråt under
          Placeringsritningar → Mer → Importera ritning från dagens program; komponenterna kopplas då ihop på beteckningen.
        </p>
        <button className="knapp primar" disabled={importerar} onClick={() => importFil.current?.click()}>
          {importerar ? "Importerar…" : "Välj projektexport (.zip) eller projektfil (.projxml)…"}
        </button>
        <input ref={importFil} type="file" accept=".zip,.projxml,.xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importera(f); }} />
        {importerat && (
          <div className="importrapport">
            <p><b>{importerat.projekt.namn}</b> är importerat.</p>
            <ul>{importerat.rapport.map((r) => <li key={r}>{r}</li>)}</ul>
            {importerat.varningar.length > 0 && <ul className="varningar">{importerat.varningar.map((r) => <li key={r}>{r}</li>)}</ul>}
            <button className="knapp primar" onClick={() => onOppna(importerat.projekt.id)}>Öppna projektet</button>
          </div>
        )}
      </section>}

      <Dialog
        titel={dialog ? dialogTitel[dialog.typ] : ""} oppen={dialog !== null} onStang={() => { if (!arbetar) setDialog(null); }}
        fot={<>
          <button className="knapp" disabled={arbetar} onClick={() => setDialog(null)}>Avbryt</button>
          <button className={`knapp ${dialog?.typ === "taBortKategori" ? "fara" : "primar"}`} disabled={!kanUtfora} onClick={() => void utfor()}>
            {arbetar ? "Arbetar…" : dialog ? knappText[dialog.typ] : ""}
          </button>
        </>}
      >
        {dialog && (
          <form className="dialogformular" onSubmit={(e) => { e.preventDefault(); if (kanUtfora) void utfor(); }}>
            {dialog.typ === "uppgifter" && <>
              <label>Projektnamn<input autoFocus maxLength={200} value={falt.namn} onChange={(e) => setFalt({ ...falt, namn: e.target.value })} /></label>
              <label>Projektnummer<input maxLength={50} value={falt.nummer} onChange={(e) => setFalt({ ...falt, nummer: e.target.value })} /></label>
              <label>Kund<input value={falt.kund} onChange={(e) => setFalt({ ...falt, kund: e.target.value })} /></label>
              <p className="dampad liten">Två aktiva projekt kan inte ha samma namn. Ändringen syns direkt för alla och sparas i projektets ändringslogg.</p>
            </>}
            {dialog.typ === "arkivera" && <>
              <p><b>{dialog.p.namn}</b> flyttas till <b>Arkiv</b> längst ner i listan och får ett nytt namn:</p>
              <p className="namnforslag">{dialog.p.namn.replace(/ – Arkiverat \d{4}-\d{2}-\d{2}( \(\d+\))?$/, "")} – Arkiverat {idag}</p>
              <p className="dampad liten">
                Då är namnet ledigt för nya projekt. Projektet går att öppna och ändra som vanligt. Väljer du
                <i> Återställ från arkivet</i> senare tas datumet bort ur namnet igen, om namnet fortfarande är ledigt.
              </p>
            </>}
            {dialog.typ === "flytta" && <>
              <label>Lägg <b>{dialog.p.namn}</b> i{kategoriVal()}</label>
              {!harKategorier && <p className="dampad liten">Det finns inga kategorier än. Skapa en med <b>+ Ny kategori</b>.</p>}
            </>}
            {dialog.typ === "nyKategori" && <>
              {dialog.foralder && <p className="dampad">Under <b>{sokvag(dialog.foralder)}</b></p>}
              <label>Namn<input autoFocus maxLength={100} value={falt.namn} placeholder={dialog.foralder ? "Örebro" : "Bravida"} onChange={(e) => setFalt({ ...falt, namn: e.target.value })} /></label>
            </>}
            {dialog.typ === "kategoriNamn" && (
              <label>Namn<input autoFocus maxLength={100} value={falt.namn} onChange={(e) => setFalt({ ...falt, namn: e.target.value })} /></label>
            )}
            {dialog.typ === "flyttaKategori" && (
              <label>Lägg <b>{dialog.k.namn}</b> (med allt innehåll) under{kategoriVal(underIds(dialog.k.id), "Översta nivån")}</label>
            )}
            {dialog.typ === "taBortKategori" && (
              <p>
                Kategorin <b>{dialog.k.namn}</b> tas bort. Inga projekt tas bort: projekt och underkategorier i den flyttas
                till {dialog.k.foralderId && katMap.has(dialog.k.foralderId) ? <b>{katMap.get(dialog.k.foralderId)!.namn}</b> : <i>Utan kategori</i>}.
              </p>
            )}
            {dialogFel && <p className="felruta">{dialogFel}</p>}
          </form>
        )}
      </Dialog>

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
            <p className="dampad liten">Vill du bara få bort det ur listan: välj <b>Arkivera</b> i stället. Skriv projektets namn för att bekräfta.</p>
            <input className="bekrafta" value={bekraftelse} autoFocus placeholder={taBort.namn} onChange={(e) => setBekraftelse(e.target.value)} />
          </>
        )}
      </Dialog>
    </main>
  );
}
