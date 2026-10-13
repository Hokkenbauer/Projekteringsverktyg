import { useEffect, useRef } from "react";
import { rensa } from "../../lib/funktionstext";

type Props = {
  html: string;
  lasläge: boolean;
  onAndra: (html: string) => void;
  onLamna?: () => void;
};

/**
 * Enkel formaterad editor för funktionstexter: rubriker, stycken, punktlistor, fet, kursiv,
 * understruken och tabeller (från Word). Inklistring blir ren text, så att Words formatering
 * inte följer med som skräp.
 */
export function RikEditor({ html, lasläge, onAndra, onLamna }: Props) {
  const yta = useRef<HTMLDivElement>(null);
  const senast = useRef<string | null>(null);

  // Fet/kursiv som taggar (<b>, <i>), inte som stilattribut.
  useEffect(() => { try { document.execCommand("styleWithCSS", false, "false"); } catch { /* äldre webbläsare */ } }, []);

  // Innehållet byts bara när det kommer utifrån (annan text vald, eller någon annan ändrade).
  useEffect(() => {
    const e = yta.current;
    if (!e || html === senast.current) return;
    e.innerHTML = html || "<p></p>";
    senast.current = html;
  }, [html]);

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

  const knapp = (titel: string, etikett: React.ReactNode, gor: () => void) => (
    <button type="button" className="rikknapp" title={titel} onMouseDown={(e) => { e.preventDefault(); gor(); }}>{etikett}</button>
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
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
      />
    </div>
  );
}
