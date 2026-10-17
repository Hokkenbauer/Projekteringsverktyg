import { useState } from "react";
import { useDokument } from "../../lib/dokument";
import type { Projekt, ProjektDokument } from "../../lib/typer";
import { oppnaDokument, tabellHtml } from "../../lib/dokumenttema";

const SERVICETYPER = ["Planerat underhåll", "Felavhjälpning", "Driftsättning", "Inspektion", "Rådgivning", "Uppgradering"];
const STATUSAR = ["Utfört", "Pågående", "Beställt", "Krävs uppföljning"];

type Atgard = { beskrivning: string; status: string };
type Rapport = {
  datum: string; tidAnkomst: string; tidAvresa: string; tekniker: string; serviceTyp: string; nastaBesok: string;
  kund: string; kontakt: string; fastighet: string; adress: string; anlaggning: string; ordernr: string;
  arbete: string; atgarder: Atgard[]; anmarkningar: string; rekommendationer: string; material: string;
  signTekniker: string; signKund: string;
};
const TOM: Rapport = {
  datum: "", tidAnkomst: "", tidAvresa: "", tekniker: "", serviceTyp: "", nastaBesok: "", kund: "", kontakt: "",
  fastighet: "", adress: "", anlaggning: "", ordernr: "", arbete: "", atgarder: [], anmarkningar: "", rekommendationer: "",
  material: "", signTekniker: "", signKund: "",
};
const las = (d: ProjektDokument): Rapport => { try { return { ...TOM, ...JSON.parse(d.data || "{}") }; } catch { return { ...TOM }; } };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** SR-ÅÅMMDD-NNN, där NNN räknar upp bland dagens rapporter i projektet. */
export function nyttRapportnummer(befintliga: string[], idag = new Date()): string {
  const d = `${String(idag.getFullYear()).slice(2)}${String(idag.getMonth() + 1).padStart(2, "0")}${String(idag.getDate()).padStart(2, "0")}`;
  const prefix = `SR-${d}-`;
  const max = befintliga.filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  minNamn: string;
  grupp: string;
  rubrik: string;
  lasläge: boolean;
  uppdaterad: number;
  visaMeddelande: (t: string) => void;
};

/** Servicerapporter i projektet: en lista till vänster, formuläret till höger, utskrift/PDF. */
export function ServicerapportVy(p: Props) {
  const dok = useDokument(p.projektId, "servicerapport", p.uppdaterad, p.visaMeddelande);
  const [valdId, setValdId] = useState<string | null>(null);
  const lista = [...(dok.lista ?? [])].sort((a, b) => b.namn.localeCompare(a.namn, "sv", { numeric: true }));
  const vald = lista.find((d) => d.id === valdId) ?? lista[0];
  const r = vald ? las(vald) : null;

  const andra = <K extends keyof Rapport>(k: K, v: Rapport[K]) => vald && r && dok.andra(vald.id, JSON.stringify({ ...r, [k]: v }));

  const ny = async () => {
    const idag = new Date();
    const namn = nyttRapportnummer(lista.map((d) => d.namn), idag);
    const forra = lista[0] ? las(lista[0]) : null;
    const data: Rapport = {
      ...TOM, datum: idag.toISOString().slice(0, 10), tekniker: p.minNamn,
      kund: forra?.kund || p.projekt?.kund || "", kontakt: forra?.kontakt ?? "", fastighet: forra?.fastighet ?? "",
      adress: forra?.adress ?? "", anlaggning: forra?.anlaggning || p.projekt?.namn || "",
    };
    try { const d = await dok.skapa(namn, JSON.stringify(data)); setValdId(d.id); }
    catch (e) { p.visaMeddelande(`Rapporten kunde inte skapas: ${(e as Error).message}`); }
  };
  const taBort = async () => {
    if (!vald || !window.confirm(`Ta bort servicerapport ${vald.namn}? Det går inte att ångra.`)) return;
    try { await dok.taBort(vald.id); setValdId(null); } catch (e) { p.visaMeddelande((e as Error).message); }
  };

  const skrivUt = () => {
    if (!vald || !r) return;
    const tre = (par: [string, string][]) => `<table class="data form tre"><tbody>${[0, 3].map((o) => `<tr>${par.slice(o, o + 3).map(([e, v]) => `<th>${esc(e)}</th><td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    oppnaDokument({
      titel: `Servicerapport ${vald.namn}`, kategori: "Servicerapport",
      css: "table.tre th{width:13%}table.tre td{width:20%} .sign{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-top:10mm}.sign div{border-top:1px solid #000;padding-top:1mm}",
      kropp: `<h2>Uppdrag</h2>${tre([["Datum", r.datum], ["Ankomst", r.tidAnkomst], ["Avresa", r.tidAvresa], ["Tekniker", r.tekniker], ["Typ av service", r.serviceTyp], ["Nästa planerade besök", r.nastaBesok]])}
<h2>Fastighet och kund</h2>${tre([["Kund", r.kund], ["Kontaktperson", r.kontakt], ["Fastighetsbeteckning", r.fastighet], ["Adress", r.adress], ["Anläggning", r.anlaggning], ["Ordernr", r.ordernr]])}
<h2>Utfört arbete</h2><div class="ruta">${esc(r.arbete)}</div>
${r.atgarder.length ? `<h2>Åtgärder</h2>${tabellHtml(["Åtgärd", "Status"], r.atgarder.map((a) => [a.beskrivning, a.status]), [undefined, "30%"])}` : ""}
<h2>Anmärkningar</h2><div class="ruta">${esc(r.anmarkningar)}</div>
<h2>Rekommendationer</h2><div class="ruta">${esc(r.rekommendationer)}</div>
<h2>Material</h2><div class="ruta">${esc(r.material)}</div>
<div class="sign"><div>Tekniker: ${esc(r.signTekniker)}</div><div>Kund: ${esc(r.signKund)}</div></div>`,
    });
  };

  const falt = (k: "datum" | "tidAnkomst" | "tidAvresa" | "tekniker" | "nastaBesok" | "kund" | "kontakt" | "fastighet" | "adress" | "anlaggning" | "ordernr" | "signTekniker" | "signKund", etikett: string, typ = "text") => (
    <label className="riskfalt"><span>{etikett}</span>
      <input type={typ} value={r?.[k] ?? ""} readOnly={p.lasläge} onChange={(e) => andra(k, e.target.value)} /></label>
  );
  const text = (k: "arbete" | "anmarkningar" | "rekommendationer" | "material", etikett: string, rader = 3) => (
    <label className="risksektion"><span>{etikett}</span>
      <textarea rows={rader} value={r?.[k] ?? ""} readOnly={p.lasläge} onChange={(e) => andra(k, e.target.value)} /></label>
  );

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {!p.lasläge && <button className="knapp primar" onClick={() => void ny()}>+ Ny servicerapport</button>}
          {vald && <button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button>}
        </div>
      </div>
      <p className="ingress">
        En rapport per servicebesök. Rapportnumret (SR-ÅÅMMDD-NNN) skapas automatiskt men kan ändras. Allt sparas automatiskt
        {dok.status === "sparar" ? " (sparar…)" : dok.status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>
      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <h3>Rapporter</h3>
          {dok.lista === null ? <span className="dampad liten">Hämtar…</span>
            : lista.length === 0 ? <span className="dampad liten">Inga rapporter än.</span>
            : lista.map((d) => {
              const x = las(d);
              return (
                <button key={d.id} className={`katalograd ${vald?.id === d.id ? "aktiv" : ""}`} onClick={() => { void dok.sparaNu(); setValdId(d.id); }}>
                  <span className="mono">{d.namn}</span><br /><span className="dampad liten">{[x.serviceTyp, x.tekniker].filter(Boolean).join(" · ")}</span>
                </button>
              );
            })}
        </aside>
        {!vald || !r ? <p className="tomruta">Inga servicerapporter i projektet än.{!p.lasläge && " Klicka på Ny servicerapport."}</p> : (
          <div className="intyg">
            <section className="panel">
              <div className="textytahuvud">
                <input className="mallnamn mono" value={vald.namn} readOnly={p.lasläge} aria-label="Rapportnummer"
                  onChange={(e) => dok.andra(vald.id, vald.data, e.target.value)} />
                <span className="grow" />
                {!p.lasläge && <button className="knapp fara" onClick={() => void taBort()}>Ta bort rapporten</button>}
              </div>
              <h2 style={{ marginTop: 12 }}>Uppdrag</h2>
              <div className="riskhuvud">
                {falt("datum", "Datum", "date")}{falt("tidAnkomst", "Ankomst", "time")}{falt("tidAvresa", "Avresa", "time")}
                {falt("tekniker", "Tekniker")}
                <label className="riskfalt"><span>Typ av service</span>
                  <select value={r.serviceTyp} disabled={p.lasläge} onChange={(e) => andra("serviceTyp", e.target.value)}>
                    <option value="" />{SERVICETYPER.map((t) => <option key={t}>{t}</option>)}
                  </select></label>
                {falt("nastaBesok", "Nästa planerade besök", "date")}
              </div>
            </section>
            <section className="panel">
              <h2>Fastighet och kund</h2>
              <div className="riskhuvud">
                {falt("kund", "Kund")}{falt("kontakt", "Kontaktperson")}{falt("fastighet", "Fastighetsbeteckning")}
                {falt("adress", "Adress")}{falt("anlaggning", "Anläggning")}{falt("ordernr", "Ordernr")}
              </div>
            </section>
            <section className="panel">
              <h2>Utfört arbete</h2>
              {text("arbete", "Beskrivning av utfört arbete", 4)}
              <table className="formtabell" style={{ marginTop: 10 }}>
                <thead><tr><th>Åtgärd</th><th style={{ width: 190 }}>Status</th>{!p.lasläge && <th />}</tr></thead>
                <tbody>
                  {r.atgarder.map((a, i) => (
                    <tr key={i}>
                      <td><input value={a.beskrivning} readOnly={p.lasläge} onChange={(e) => andra("atgarder", r.atgarder.map((x, j) => (j === i ? { ...x, beskrivning: e.target.value } : x)))} /></td>
                      <td><select value={a.status} disabled={p.lasläge} onChange={(e) => andra("atgarder", r.atgarder.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}>
                        <option value="" />{STATUSAR.map((t) => <option key={t}>{t}</option>)}</select></td>
                      {!p.lasläge && <td><button className="knapp liten" title="Ta bort åtgärden" onClick={() => andra("atgarder", r.atgarder.filter((_, j) => j !== i))}>✕</button></td>}
                    </tr>
                  ))}
                  {!p.lasläge && <tr><td colSpan={3}><button className="knapp" onClick={() => andra("atgarder", [...r.atgarder, { beskrivning: "", status: "Utfört" }])}>+ Lägg till åtgärd</button></td></tr>}
                </tbody>
              </table>
            </section>
            <section className="panel risksektioner" style={{ marginTop: 0 }}>
              {text("anmarkningar", "Anmärkningar")}{text("rekommendationer", "Rekommendationer")}{text("material", "Material")}
            </section>
            <section className="panel">
              <h2>Signatur</h2>
              <div className="riskhuvud">{falt("signTekniker", "Tekniker")}{falt("signKund", "Kund")}</div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
