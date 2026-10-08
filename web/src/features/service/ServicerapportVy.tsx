import { useState } from "react";
import { useDokument } from "../../lib/dokument";
import type { Projekt, ProjektDokument } from "../../lib/typer";

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
    const f = window.open("", "_blank");
    if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan."); return; }
    const falt = (e: string, v: string) => `<div><span>${esc(e)}</span><b>${esc(v) || "&nbsp;"}</b></div>`;
    f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Servicerapport ${esc(vald.namn)}</title>
<style>@page{size:A4;margin:14mm 14mm 16mm}body{font-family:Arial,sans-serif;font-size:10pt;color:#1a202c}
.topp{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1E3450;padding-bottom:8px;margin-bottom:14px}
h1{margin:0;font-size:20pt;color:#1E3450}.nr{font-family:monospace;font-size:12pt}
.kort{border:1px solid #cbd5e0;border-radius:6px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}
.kort h2{margin:0 0 8px;font-size:10.5pt;text-transform:uppercase;letter-spacing:.06em;color:#1E3450}
.rutnat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px}.rutnat div{display:flex;flex-direction:column}
.rutnat span{font-size:8pt;color:#718096}.rutnat b{font-weight:600}
p{white-space:pre-wrap;margin:0;line-height:1.45}table{border-collapse:collapse;width:100%;margin-top:8px}
th{text-align:left;font-size:8.5pt;color:#718096;border-bottom:1px solid #cbd5e0;padding:4px}td{border-bottom:1px solid #edf2f7;padding:5px 4px;vertical-align:top}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:26px}.sign div{border-top:1px solid #333;padding-top:4px;font-size:9pt}</style></head><body>
<div class="topp"><h1>Servicerapport</h1><div class="nr">${esc(vald.namn)}</div></div>
<div class="kort"><h2>Uppdrag</h2><div class="rutnat">${falt("Datum", r.datum)}${falt("Ankomst", r.tidAnkomst)}${falt("Avresa", r.tidAvresa)}${falt("Tekniker", r.tekniker)}${falt("Typ av service", r.serviceTyp)}${falt("Nästa planerade besök", r.nastaBesok)}</div></div>
<div class="kort"><h2>Fastighet och kund</h2><div class="rutnat">${falt("Kund", r.kund)}${falt("Kontaktperson", r.kontakt)}${falt("Fastighetsbeteckning", r.fastighet)}${falt("Adress", r.adress)}${falt("Anläggning", r.anlaggning)}${falt("Ordernr", r.ordernr)}</div></div>
<div class="kort"><h2>Utfört arbete</h2><p>${esc(r.arbete)}</p>
${r.atgarder.length ? `<table><thead><tr><th>Åtgärd</th><th style="width:140px">Status</th></tr></thead><tbody>${r.atgarder.map((a) => `<tr><td>${esc(a.beskrivning)}</td><td>${esc(a.status)}</td></tr>`).join("")}</tbody></table>` : ""}</div>
<div class="kort"><h2>Anmärkningar</h2><p>${esc(r.anmarkningar)}</p></div>
<div class="kort"><h2>Rekommendationer</h2><p>${esc(r.rekommendationer)}</p></div>
<div class="kort"><h2>Material</h2><p>${esc(r.material)}</p></div>
<div class="sign"><div>Tekniker: ${esc(r.signTekniker)}</div><div>Kund: ${esc(r.signKund)}</div></div>
<script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
    f.document.close();
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
