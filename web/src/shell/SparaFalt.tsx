import { useEffect, useRef, useState } from "react";

/** Textfält som sparar när man lämnar det (eller trycker Enter), så att varje tangent inte blir en ändring. */
export function SparaFalt({ varde, onSpara, placeholder, lasläge, flerrad, etikett, rader, lista, typ }: {
  varde: string; onSpara: (v: string) => void; placeholder?: string; lasläge: boolean; flerrad?: boolean; etikett: string;
  /** Antal rader för flerradiga fält. */
  rader?: number;
  /** Id på en datalist med förslag. */
  lista?: string;
  typ?: "text" | "date";
}) {
  const [text, setText] = useState(varde);
  const fokus = useRef(false);
  useEffect(() => { if (!fokus.current) setText(varde); }, [varde]);
  const spara = () => { fokus.current = false; if (text.trim() !== varde.trim()) onSpara(text.trim()); };
  const gemensamt = {
    value: text, placeholder, readOnly: lasläge, "aria-label": etikett,
    onFocus: () => { fokus.current = true; },
    onBlur: spara,
  };
  return flerrad
    ? <textarea {...gemensamt} rows={rader ?? 2} onChange={(e) => setText(e.target.value)} />
    : <input type={typ ?? "text"} list={lista} {...gemensamt} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(varde); fokus.current = false; } }} />;
}

