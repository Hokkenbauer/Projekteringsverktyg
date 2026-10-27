import { useEffect, useMemo, useState } from "react";
import type { ListRad, Projekt } from "../../lib/typer";
import { laddaNerWord, skrivUtBlock, type Block, type BlockDokument } from "../../lib/dokumentBlock";
import { uppgift } from "../../lib/dokumenttema";
import { valtDatum } from "../listor/ListVy";
import { SparaFalt } from "../../shell/SparaFalt";

/**
 * Hinder (Projektering → Stöd/Övrigt): Förhindersanmälan och Underrättelse om hinder.
 * Varje dokument är en rad i listan "forhinder" eller "hinder" (listmotorn sköter sparande, logg och livesynk).
 * Utskrift/PDF och Word i dokumenttemat, men utan handlingsstatus – huvudet visar dokumentets nummer och datum.
 */

export type HinderTyp = "forhinder" | "hinder";

const NAMN: Record<HinderTyp, { flik: string; titel: string; ny: string; status: string }> = {
  forhinder: { flik: "Förhindersanmälan", titel: "Anmälan om förhinder", ny: "Ny förhindersanmälan", status: "FÖRHINDER" },
  hinder: { flik: "Underrättelse om hinder", titel: "Underrättelse om hinder", ny: "Ny underrättelse om hinder", status: "HINDER" },
};

const OMSTANDIGHET = "Att entreprenören hindras att färdigställa kontraktsarbetena inom kontraktstiden – HINDER (AB 04/ABT 06 kap 4 § 3).";
const AVTAL = ["AB 04", "ABT 06", "AB 25", "ABT 25", "ABK 09"];
const MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

const idag = () => new Date().toLocaleDateString("sv-SE");
const omDagar = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };

/** "Ludvika den 27 oktober 2026" (utan ort: bara datumet i text). */
export function ortOchDatum(ort: string, datum: string) {
  const d = valtDatum(datum);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const text = m ? `${Number(m[3])} ${MANADER[Number(m[2]) - 1]} ${m[1]}` : d;
  return [ort.trim(), text].filter(Boolean).join(" den ");
}

/** Orten ur företagets postadress ("771 53 Ludvika" = "Ludvika"). */
const foretagsort = () => uppgift("postadress").replace(/^[\d\s]+/, "").trim();

const kryss = (pa: boolean) => (pa ? "☒" : "☐");

// ---------------------------------------------------------------- Dokumenten

export function forhinderDokument(d: Record<string, string>, projekt: Projekt | null): BlockDokument {
  const lucka = "____________";
  const senast = valtDatum(d.hinderSenast) || lucka;
  const svar = valtDatum(d.svarSenast) || lucka;
  const block: Block[] = [
    { typ: "form", rader: [
      ["Datum", valtDatum(d.datum)], ["Projekt", projekt?.namn ?? ""],
      ["Totalentreprenör", d.totalentreprenor ?? ""], ["Beställare", d.bestallare ?? ""],
    ] },
    { typ: "luft", mm: 3 },
    { typ: "text", text: `Vi vill härmed informera er om att ett hinder kan komma att föreligga i projektet. Detta meddelande utgör inte ett formellt skriftligt hinder enligt ABT 06 kap 4 § 4 (underrättelseplikt), men ett sådant kommer att insändas senast den ${senast}, om inte nedanstående eventuella hinder röjs dessförinnan:` },
    { typ: "rubrik", text: "Eventuella hinder" },
    { typ: "text", text: d.hinder ?? "" },
    { typ: "rubrik", text: "Föreslagen lösning" },
    { typ: "text", text: d.losning ?? "" },
    { typ: "rubrik", text: "Fortsättning" },
    { typ: "text", text: `Vi bevakar utvecklingen noggrant och önskar ert svar avseende föreslagen lösning för att undanröja ovanstående hinder senast den ${svar} för att kunna utvärdera om hindret har undanröjts.` },
    { typ: "luft", mm: 4 },
    { typ: "text", text: `Med vänlig hälsning,\n${[d.avsandare, uppgift("foretag")].filter((x) => x?.trim()).join(" – ")}` },
  ];
  return {
    titel: NAMN.forhinder.titel, projekt, block,
    egetHuvud: { status: NAMN.forhinder.status, rader: [
      ["Nr:", d.nr ?? ""], ["Datum:", valtDatum(d.datum)], ["Avsändare:", d.avsandare ?? ""], ["Projektnr:", projekt?.nummer ?? ""],
    ] },
  };
}

export function hinderDokument(d: Record<string, string>, projekt: Projekt | null): BlockDokument {
  const pa = (k: string) => d[k] === "true";
  const svar = [["svarBestalls", "Arbetet beställs"], ["svarPm", "Svar lämnas i PM"], ["svarAnbud", "Anbud ska lämnas"], ["svarAnnat", "Annat"]]
    .map(([k, t]) => `${kryss(pa(k!))} ${t}`).join("     ");
  const block: Block[] = [
    { typ: "rutor", rader: [[
      { etikett: "Underrättelse nr:", varde: d.nr ?? "" },
      { etikett: "Avser:", varde: d.rubrik ?? "" },
    ]] },
    { typ: "luft" },
    { typ: "rutor", rader: [
      [{ etikett: "Beställare:", varde: d.bestallare ?? "" }, { etikett: "Projekt:", varde: projekt?.namn ?? "" }],
      [{ etikett: "Beställarens kontaktuppgifter (e-post):", varde: d.bestallareEpost ?? "" }, { etikett: "Beställarens kontaktuppgifter (postadress):", varde: d.bestallareAdress ?? "" }],
    ] },
    { typ: "luft" },
    { typ: "rutor", rader: [
      [{ etikett: "Entreprenör:", varde: d.entreprenor ?? "" }, { etikett: "Entreprenadform/tillämpligt standardavtal:", varde: d.entreprenadform ?? "" }],
      [{ etikett: "Entreprenörens platschef:", varde: d.platschef ?? "" }, { etikett: "Ort och datum:", varde: ortOchDatum(d.ort ?? "", d.datum ?? "") }],
    ] },
    { typ: "luft" },
    { typ: "rutor", rader: [[{
      etikett: "Entreprenören underrättar härmed om följande omständighet(er) som är av betydelse för entreprenaden:",
      varde: `${d.omstandighet || OMSTANDIGHET}\n${kryss(pa("seBilaga"))} Se bilaga (med kompletterande uppgifter om omständigheten).`,
    }]] },
    { typ: "luft" },
    { typ: "rutor", rader: [
      [{ etikett: "Omständigheten innebär:", varde: d.innebar ?? "", hojd: 28 }],
      [{ etikett: "Förslag på åtgärd:", varde: d.atgard ?? "", hojd: 28 }],
      [{ etikett: "Datum:", varde: valtDatum(d.datum), bredd: 40, hojd: 14 }, { etikett: "Signatur" }],
    ] },
    { typ: "luft" },
    { typ: "rutor", rader: [
      [{ etikett: "Beställarens svar:", varde: [svar, d.svarText ?? ""].filter((x) => x.trim()).join("\n"), hojd: 22 }],
      [{ etikett: "Datum:", varde: valtDatum(d.svarDatum), bredd: 40, hojd: 14 }, { etikett: "Signatur" }],
    ] },
  ];
  return {
    titel: NAMN.hinder.titel, projekt, block,
    egetHuvud: { status: NAMN.hinder.status, rader: [
      ["Nr:", d.nr ?? ""], ["Datum:", valtDatum(d.datum)], ["Platschef:", d.platschef ?? ""], ["Projektnr:", projekt?.nummer ?? ""],
    ] },
  };
}

// ---------------------------------------------------------------- Vyn

type Props = {
  grupp: string;
  rubrik: string;
  projekt: Projekt | null;
  forhinder: ListRad[] | undefined;
  hinder: ListRad[] | undefined;
  minNamn: string;
  lasläge: boolean;
  onAndra: (lista: HinderTyp, rad: ListRad, falt: string, varde: string) => Promise<ListRad | null>;
  onNy: (lista: HinderTyp, data: Record<string, string>) => Promise<ListRad | null>;
  onTaBort: (lista: HinderTyp, ids: string[]) => void;
  visaMeddelande: (t: string) => void;
};

export function HinderVy(p: Props) {
  const [typ, setTyp] = useState<HinderTyp>(() => { try { return (localStorage.getItem("hinder-flik") as HinderTyp) || "forhinder"; } catch { return "forhinder"; } });
  const [valdId, setValdId] = useState<Record<HinderTyp, string | null>>({ forhinder: null, hinder: null });
  const [arbetar, setArbetar] = useState(false);
  const [listaOppen, setListaOppen] = useState(true);

  const byt = (t: HinderTyp) => { setTyp(t); try { localStorage.setItem("hinder-flik", t); } catch { /* bekvämlighet */ } };

  const rader = (t: HinderTyp) => [...((t === "forhinder" ? p.forhinder : p.hinder) ?? [])].sort((a, b) => b.ordning - a.ordning);
  const lista = useMemo(() => rader(typ), [typ, p.forhinder, p.hinder]);
  const vald = lista.find((r) => r.id === valdId[typ]) ?? lista[0] ?? null;
  useEffect(() => { if (vald && valdId[typ] !== vald.id) setValdId((v) => ({ ...v, [typ]: vald.id })); }, [vald?.id, typ]);

  // ---- Nytt dokument (fälten som brukar vara lika hämtas från det senaste) ----
  const ny = async (t: HinderTyp, extra: Record<string, string> = {}) => {
    const forra = rader(t)[0]?.data ?? {};
    const kund = p.projekt?.kund ?? "";
    const data: Record<string, string> = t === "forhinder"
      ? {
        datum: idag(), hinderSenast: omDagar(7), svarSenast: omDagar(5),
        totalentreprenor: forra.totalentreprenor || kund, bestallare: forra.bestallare || kund,
        avsandare: forra.avsandare || p.minNamn, ...extra,
      }
      : {
        datum: idag(), ort: forra.ort || foretagsort(),
        bestallare: forra.bestallare || kund, bestallareEpost: forra.bestallareEpost ?? "", bestallareAdress: forra.bestallareAdress ?? "",
        entreprenor: forra.entreprenor || uppgift("foretag"), entreprenadform: forra.entreprenadform || "AB 04",
        platschef: forra.platschef || p.minNamn, omstandighet: OMSTANDIGHET, ...extra,
      };
    setArbetar(true);
    try {
      const rad = await p.onNy(t, Object.fromEntries(Object.entries(data).filter(([, v]) => v)));
      if (rad) { byt(t); setValdId((v) => ({ ...v, [t]: rad.id })); }
    } finally { setArbetar(false); }
  };

  /** Förhinder som inte undanröjts blir en formell underrättelse om hinder. */
  const tillHinder = async (r: ListRad) => {
    await ny("hinder", { rubrik: r.data.rubrik ?? "", innebar: r.data.hinder ?? "", atgard: r.data.losning ?? "" });
    p.visaMeddelande(`Underrättelse om hinder skapad från förhinder ${r.data.nr ?? ""}. Kontrollera uppgifterna innan den skickas.`);
  };

  const andra = (falt: string) => (v: string) => { if (vald) void p.onAndra(typ, vald, falt, v); };

  const dokument = (r: ListRad) => (typ === "forhinder" ? forhinderDokument : hinderDokument)(r.data, p.projekt);
  const filnamn = (r: ListRad) => `${NAMN[typ].titel} ${r.data.nr ?? ""} ${p.projekt?.namn ?? ""}`.replace(/\s+/g, " ").trim();
  const word = async (r: ListRad) => {
    setArbetar(true);
    try { await laddaNerWord(dokument(r), filnamn(r)); }
    catch (e) { p.visaMeddelande(`Word-filen kunde inte skapas: ${(e as Error).message}`); }
    finally { setArbetar(false); }
  };
  const taBort = (r: ListRad) => {
    if (window.confirm(`Ta bort ${NAMN[typ].titel.toLowerCase()} ${r.data.nr ?? ""}${r.data.rubrik ? ` (${r.data.rubrik})` : ""}?`)) p.onTaBort(typ, [r.id]);
  };

  // ---- Fält ----
  const d = vald?.data ?? {};
  const text = (falt: string, etikett: string, o: { flerrad?: boolean; rader?: number; lista?: string; placeholder?: string; bred?: boolean } = {}) => (
    <label className={`hinder-falt${o.bred ? " bred" : ""}`}>
      <span>{etikett}</span>
      <SparaFalt etikett={etikett} varde={d[falt] ?? ""} lasläge={p.lasläge} onSpara={andra(falt)}
        flerrad={o.flerrad} rader={o.rader} lista={o.lista} placeholder={o.placeholder} />
    </label>
  );
  const datum = (falt: string, etikett: string) => (
    <label className="hinder-falt">
      <span>{etikett}</span>
      <input type="date" key={d[falt] ?? ""} defaultValue={valtDatum(d[falt])} readOnly={p.lasläge} aria-label={etikett}
        onChange={(e) => { const v = e.target.value; if (!p.lasläge && (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) && v !== valtDatum(d[falt])) andra(falt)(v); }} />
    </label>
  );
  const ruta = (falt: string, etikett: string) => (
    <label className="kryssrad hinder-kryss">
      <input type="checkbox" checked={d[falt] === "true"} disabled={p.lasläge} onChange={(e) => andra(falt)(e.target.checked ? "true" : "false")} /> {etikett}
    </label>
  );

  const antal = (t: HinderTyp) => ((t === "forhinder" ? p.forhinder : p.hinder) ?? []).length;
  const hamtar = (typ === "forhinder" ? p.forhinder : p.hinder) === undefined;

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {!p.lasläge && <button className="knapp primar" disabled={arbetar} onClick={() => void ny(typ)}>+ {NAMN[typ].ny}</button>}
        </div>
      </div>
      <p className="ingress">
        {typ === "forhinder"
          ? "Förhindersanmälan: informera beställaren tidigt om att ett hinder kan komma att uppstå, och föreslå en lösning. Är det inte löst i tid görs en formell underrättelse om hinder (knappen Skapa underrättelse om hinder)."
          : "Underrättelse om hinder enligt AB 04/ABT 06 kap 4 § 3. Beställarens svar och signaturer kan fyllas i här eller för hand på utskriften."}
        {" "}Utskrift och Word har samma huvud som övriga dokument, men visar dokumentets nummer och datum i stället för handlingsstatus.
      </p>

      <div className="hinder-flikar" role="tablist">
        {(["forhinder", "hinder"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={typ === t} className={typ === t ? "aktiv" : ""} onClick={() => byt(t)}>
            {NAMN[t].flik} <small>{antal(t)}</small>
          </button>
        ))}
      </div>

      {hamtar ? <p className="dampad">Hämtar…</p> : lista.length === 0 ? (
        <div className="tomruta">
          <p>Inga dokument än.</p>
          {!p.lasläge && <button className="knapp primar" disabled={arbetar} onClick={() => void ny(typ)}>+ {NAMN[typ].ny}</button>}
        </div>
      ) : (
        <div className={`hinder-yta${listaOppen ? "" : " utan-lista"}`}>
          <aside className="hinder-lista">
            <button className="hinder-listknapp" onClick={() => setListaOppen((o) => !o)}>{listaOppen ? "◂ Dölj listan" : "▸"}</button>
            {listaOppen && lista.map((r) => (
              <button key={r.id} className={`hinder-post${r.id === vald?.id ? " aktiv" : ""}`} onClick={() => setValdId((v) => ({ ...v, [typ]: r.id }))}>
                <span className="mono">{r.data.nr}</span>
                <b>{r.data.rubrik?.trim() || (typ === "forhinder" ? r.data.hinder : r.data.innebar)?.trim().slice(0, 60) || "Utan rubrik"}</b>
                <small>{valtDatum(r.data.datum)}{r.data.skickad === "true" ? ` · skickad ${valtDatum(r.data.skickadDatum)}` : " · ej skickad"}</small>
              </button>
            ))}
          </aside>

          {vald && (
            <section className="hinder-form" key={vald.id}>
              <div className="hinder-verktyg">
                <h2><span className="mono">{d.nr}</span> {NAMN[typ].titel}</h2>
                <div className="knappar">
                  {ruta("skickad", "Skickad")}
                  {typ === "forhinder" && !p.lasläge && (
                    <button className="knapp" disabled={arbetar} onClick={() => void tillHinder(vald)} title="Hindret kvarstår: skapa en formell underrättelse om hinder med samma beskrivning">Skapa underrättelse om hinder</button>
                  )}
                  <button className="knapp" onClick={() => skrivUtBlock(dokument(vald))} title="Välj Spara som PDF i utskriftsrutan för en PDF">Skriv ut / PDF</button>
                  <button className="knapp" disabled={arbetar} onClick={() => void word(vald)}>Word</button>
                  {!p.lasläge && <button className="knapp fara" onClick={() => taBort(vald)}>Ta bort</button>}
                </div>
              </div>

              {typ === "forhinder" ? (
                <>
                  <fieldset className="hinder-grupp">
                    <legend>Uppgifter</legend>
                    {text("rubrik", "Rubrik (visas i listan)", { bred: true, placeholder: "T.ex. Försenade ritningar från VE" })}
                    {datum("datum", "Datum")}
                    <label className="hinder-falt"><span>Projekt</span><input value={p.projekt?.namn ?? ""} readOnly aria-label="Projekt" /></label>
                    {text("totalentreprenor", "Totalentreprenör")}
                    {text("bestallare", "Beställare")}
                  </fieldset>
                  <fieldset className="hinder-grupp">
                    <legend>Eventuella hinder</legend>
                    {text("hinder", "Vad eller vilka moment riskerar att bli ett hinder", { flerrad: true, rader: 5, bred: true })}
                    {text("losning", "Föreslagen lösning", { flerrad: true, rader: 5, bred: true })}
                  </fieldset>
                  <fieldset className="hinder-grupp">
                    <legend>Datum i texten</legend>
                    {datum("hinderSenast", "Formellt hinder skickas senast")}
                    {datum("svarSenast", "Svar på föreslagen lösning senast")}
                    {text("avsandare", "Med vänlig hälsning (avsändare)")}
                  </fieldset>
                </>
              ) : (
                <>
                  <fieldset className="hinder-grupp">
                    <legend>Uppgifter</legend>
                    {text("rubrik", "Avser (rubrik)", { bred: true, placeholder: "T.ex. Försenade ritningar från VE" })}
                    {text("bestallare", "Beställare")}
                    <label className="hinder-falt"><span>Projekt</span><input value={p.projekt?.namn ?? ""} readOnly aria-label="Projekt" /></label>
                    {text("bestallareEpost", "Beställarens kontaktuppgifter (e-post)")}
                    {text("bestallareAdress", "Beställarens kontaktuppgifter (postadress)")}
                    {text("entreprenor", "Entreprenör")}
                    {text("entreprenadform", "Entreprenadform/tillämpligt standardavtal", { lista: "hinder-avtal" })}
                    {text("platschef", "Entreprenörens platschef")}
                    {text("ort", "Ort")}
                    {datum("datum", "Datum")}
                  </fieldset>
                  <fieldset className="hinder-grupp">
                    <legend>Omständighet</legend>
                    {text("omstandighet", "Entreprenören underrättar härmed om följande omständighet(er)", { flerrad: true, rader: 2, bred: true })}
                    {ruta("seBilaga", "Se bilaga (med kompletterande uppgifter om omständigheten)")}
                    {text("innebar", "Omständigheten innebär", { flerrad: true, rader: 5, bred: true })}
                    {text("atgard", "Förslag på åtgärd", { flerrad: true, rader: 4, bred: true })}
                  </fieldset>
                  <fieldset className="hinder-grupp">
                    <legend>Beställarens svar <small>(kan lämnas tomt och fyllas i för hand)</small></legend>
                    <div className="hinder-svar bred">
                      {ruta("svarBestalls", "Arbetet beställs")}
                      {ruta("svarPm", "Svar lämnas i PM")}
                      {ruta("svarAnbud", "Anbud ska lämnas")}
                      {ruta("svarAnnat", "Annat")}
                    </div>
                    {text("svarText", "Kommentar till svaret", { flerrad: true, rader: 2, bred: true })}
                    {datum("svarDatum", "Datum för svar")}
                  </fieldset>
                  <datalist id="hinder-avtal">{AVTAL.map((a) => <option key={a} value={a} />)}</datalist>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
