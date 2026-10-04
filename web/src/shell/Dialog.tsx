import { useEffect, useRef, type ReactNode } from "react";

type Props = { titel: string; oppen: boolean; onStang: () => void; children: ReactNode; fot?: ReactNode; bred?: boolean };

/** Enkel modal dialog (webbläsarens inbyggda dialog-element). Esc och klick utanför stänger. */
export function Dialog({ titel, oppen, onStang, children, fot, bred }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (oppen && !d.open) d.showModal();
    if (!oppen && d.open) d.close();
  }, [oppen]);
  return (
    <dialog
      ref={ref} className={`dialog ${bred ? "bred" : ""}`} onClose={onStang}
      onMouseDown={(e) => { if (e.target === ref.current) onStang(); }}
    >
      {oppen && (
        <div className="dialog-ram">
          <header><h2>{titel}</h2><button className="knapp" onClick={onStang} aria-label="Stäng">✕</button></header>
          <div className="dialog-innehall">{children}</div>
          {fot && <footer>{fot}</footer>}
        </div>
      )}
    </dialog>
  );
}
