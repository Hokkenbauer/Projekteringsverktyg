import { useEffect, useRef, useState } from "react";
import { rensa } from "../../lib/funktionstext";
import {
  TABELLMALLAR, cellVidMarkor, fyllTomma, infogaTabell, kolumn, markorI, nastaCell, rad, taBortKolumn, taBortRad, taBortTabell,
} from "./rikTabell";

type Props = {
  html: string;
  lasläge: boolean;
  onAndra: (html: string) => void;
  onLamna?: () => void;
};

/**
 * Enkel formaterad editor för funktionstexter: rubriker, stycken, punktlistor, fet, kursiv,
 * understruken och tabeller. Tabeller kan infogas (driftkortens standardtabeller), och rader och kolumner
 * läggas till och tas bort. Tab flyttar mellan cellerna. Inklistring blir ren text, så att Words
 * formatering inte följer med som skräp.
 */
export function RikEditor({ html, lasläge, onAndra, onLamna }: Props) {
  const yta = useRef<HTMLDivElement>(null);
  const senast = useRef<string | null>(null);
  const [iTabell, setITabell] = useState(false);
  /** Markörens senaste plats i editorn (en lista i verktygsraden tar fokus från texten). */
  const plats = useRef<Range | null>(null);

  // Fet/kursiv som taggar (<b>, <i>), inte som stilattribut.
  useEffect(() => { try { document.execCommand("styleWithCSS", false, "false"); } catch { /* äldre webbläsare */ } }, []);

  // Innehållet byts bara när det kommer utifrån (annan text vald, eller någon annan ändrade).
  useEffect(() => {
    const e = yta.current;
    if (!e || html === senast.current) return;
    e.innerHTML = html || "<p></p>";
    fyllTomma(e);
    senast.current = html;
  }, [html]);

  // Tabellknapparna är aktiva när markören står i en tabell.
  useEffect(() => {
    const kolla = () => {
      const e = yta.current;
      const sel = window.getSelection();
      if (e && sel?.rangeCount && e.contains(sel.anchorNode)) plats.current = sel.getRangeAt(0).cloneRange();
      setITabell(!!e && !!cellVidMarkor(e));
    };
    document.addEventListener("selectionchange", kolla);
    return () => document.removeEventListener("selectionchange", kolla);
  }, []);

  const andrat = () => {
    const e = yta.current;
    if (!e) return;
    const ny = rensa(e);
    senast.current = ny;
    onAndra(ny);
  };

  const kommando = (namn: string, varde?: string) => {
    yta.current?.focus();
    document.execCommand(namn, false, varde);
    andrat();
  };

  /** Ändring av tabellen där markören står. Funktionen returnerar cellen som markören ska stå i efteråt. */
  const tabell = (gor: (td: HTMLTableCellElement) => HTMLTableCellElement | null | void) => {
    const e = yta.current;
    if (!e) return;
    const td = cellVidMarkor(e);
    if (!td) return;
    const ny = gor(td);
    fyllTomma(e);
    e.focus();
    if (ny) markorI(ny);
    andrat();
  };

  const nyTabell = (index: number) => {
    const e = yta.current;
    const mall = TABELLMALLAR[index];
    if (!e || !mall) return;
    e.focus();
    if (plats.current && e.contains(plats.current.startContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(plats.current);
    }
    const td = infogaTabell(e, mall);
    fyllTomma(e);
    if (td) markorI(td);
    andrat();
  };

  const knapp = (titel: string, etikett: React.ReactNode, gor: () => void, av = false) => (
    <button type="button" className="rikknapp" title={titel} disabled={av} onMouseDown={(e) => { e.preventDefault(); if (!av) gor(); }}>{etikett}</button>
  );

  return (
    <div className="rikeditor">
      {!lasläge && (
        <div className="rikverktyg" role="toolbar" aria-label="Formatering">
          {knapp("Rubrik 1", "R1", () => kommando("formatBlock", "<h1>"))}
          {knapp("Rubrik 2", "R2", () => kommando("formatBlock", "<h2>"))}
          {knapp("Rubrik 3", "R3", () => kommando("formatBlock", "<h3>"))}
          {knapp("Vanligt stycke", "¶", () => kommando("formatBlock", "<p>"))}
          <span className="rikskiljare" />
          {knapp("Fet (Ctrl+B)", <b>F</b>, () => kommando("bold"))}
          {knapp("Kursiv (Ctrl+I)", <i>K</i>, () => kommando("italic"))}
          {knapp("Understruken (Ctrl+U)", <u>U</u>, () => kommando("underline"))}
          <span className="rikskiljare" />
          {knapp("Punktlista", "• Lista", () => kommando("insertUnorderedList"))}
          {knapp("Ta bort formatering", "Rensa", () => kommando("removeFormat"))}
          <span className="rikskiljare" />
          <select
            className="rikval" value="" aria-label="Infoga tabell"
            title="Infoga en tabell efter stycket där markören står. Driftkortens tabeller får rubriktabell, tom rad och datatabell."
            onChange={(ev) => { const i = Number(ev.target.value); ev.target.value = ""; nyTabell(i); }}
          >
            <option value="" disabled>+ Tabell…</option>
            {TABELLMALLAR.map((m, i) => <option key={m.namn} value={i}>{m.namn}</option>)}
          </select>
          {knapp("Ny rad ovanför", "Rad ↑", () => tabell((td) => rad(td, false)), !iTabell)}
          {knapp("Ny rad nedanför (eller Tab i sista cellen)", "Rad ↓", () => tabell((td) => rad(td, true)), !iTabell)}
          {knapp("Ny kolumn till vänster", "Kol ←", () => tabell((td) => kolumn(td, false)), !iTabell)}
          {knapp("Ny kolumn till höger", "Kol →", () => tabell((td) => kolumn(td, true)), !iTabell)}
          {knapp("Ta bort raden", "− Rad", () => tabell(taBortRad), !iTabell)}
          {knapp("Ta bort kolumnen", "− Kol", () => tabell(taBortKolumn), !iTabell)}
          {knapp("Ta bort hela tabellen", "− Tabell", () => tabell(taBortTabell), !iTabell)}
        </div>
      )}
      <div
        ref={yta}
        className="rikyta"
        contentEditable={!lasläge}
        suppressContentEditableWarning
        spellCheck
        onInput={andrat}
        onBlur={onLamna}
        onKeyDown={(ev) => {
          // Tab flyttar mellan tabellens celler i stället för att lämna editorn.
          if (ev.key !== "Tab" || lasläge) return;
          const e = yta.current;
          const td = e && cellVidMarkor(e);
          if (!td) return;
          ev.preventDefault();
          const ny = nastaCell(td, ev.shiftKey);
          if (!ny) return;
          fyllTomma(e);
          markorI(ny);
          andrat();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
      />
    </div>
  );
}
