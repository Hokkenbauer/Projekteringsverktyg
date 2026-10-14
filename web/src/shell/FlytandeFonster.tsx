import { useEffect, useRef, useState, type ReactNode } from "react";

type Lage = { x: number; y: number; b: number; h: number };
type Props = { nyckel: string; titel: string; onStang: () => void; children: ReactNode; standard?: Partial<Lage> };

const las = (nyckel: string): Lage | null => {
  try { const v = JSON.parse(localStorage.getItem(`pv.fonster.${nyckel}`) ?? "null"); return v && typeof v.x === "number" ? v : null; } catch { return null; }
};
const inom = (l: Lage): Lage => {
  const b = Math.min(Math.max(l.b, 260), window.innerWidth - 16);
  const h = Math.min(Math.max(l.h, 160), window.innerHeight - 16);
  return { b, h, x: Math.min(Math.max(l.x, 8), window.innerWidth - b - 8), y: Math.min(Math.max(l.y, 8), window.innerHeight - h - 8) };
};

/**
 * Ett fönster som ligger ovanpå appen och följer med mellan flikarna. Dra i titelraden för att flytta,
 * i kanterna eller hörnen för att ändra storlek. Läge och storlek kommer ihåg i webbläsaren.
 * Med – minimeras fönstret till en liten ruta som kan flyttas undan och öppnas igen (innehållet ligger kvar).
 */
export function FlytandeFonster({ nyckel, titel, onStang, children, standard }: Props) {
  const [lage, setLage] = useState<Lage>(() => inom(las(nyckel) ?? {
    b: standard?.b ?? 420, h: standard?.h ?? 520,
    x: standard?.x ?? window.innerWidth - (standard?.b ?? 420) - 24, y: standard?.y ?? 90,
  }));
  const drag = useRef<{ typ: string; sx: number; sy: number; fran: Lage } | null>(null);
  const [mini, setMini] = useState(() => { try { return localStorage.getItem(`pv.fonster.${nyckel}.mini`) === "1"; } catch { return false; } });
  const ruta = useRef<HTMLDivElement>(null);
  const valjMini = (v: boolean) => {
    setMini(v);
    if (!v) setLage((l) => inom(l));
    try { localStorage.setItem(`pv.fonster.${nyckel}.mini`, v ? "1" : "0"); } catch { /* bara bekvämlighet */ }
  };

  useEffect(() => {
    try { localStorage.setItem(`pv.fonster.${nyckel}`, JSON.stringify(lage)); } catch { /* bara bekvämlighet */ }
  }, [nyckel, lage]);
  useEffect(() => {
    const vid = () => setLage((l) => inom(l));
    window.addEventListener("resize", vid);
    return () => window.removeEventListener("resize", vid);
  }, []);

  const borja = (typ: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { typ, sx: e.clientX, sy: e.clientY, fran: lage };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const flytta = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy, f = d.fran;
    let { x, y, b, h } = f;
    if (d.typ === "flytta") {
      x += dx; y += dy;
      if (mini) {
        // Den lilla rutan får flyttas ända ut i kanterna.
        const r = ruta.current?.getBoundingClientRect();
        const rb = r?.width ?? 220, rh = r?.height ?? 36;
        setLage({ ...f, x: Math.min(Math.max(x, 4), window.innerWidth - rb - 4), y: Math.min(Math.max(y, 4), window.innerHeight - rh - 4) });
        return;
      }
    }
    if (d.typ.includes("o")) b = f.b + dx;
    if (d.typ.includes("s")) h = f.h + dy;
    if (d.typ.includes("v")) { b = f.b - dx; x = f.x + dx; if (b < 260) { x -= 260 - b; b = 260; } }
    if (d.typ.includes("n")) { h = f.h - dy; y = f.y + dy; if (h < 160) { y -= 160 - h; h = 160; } }
    setLage(inom({ x, y, b, h }));
  };
  const slapp = () => { drag.current = null; };
  const handtag = (typ: string) => (
    <div key={typ} className={`fonster-handtag fh-${typ}`} onPointerDown={borja(typ)} onPointerMove={flytta} onPointerUp={slapp} onPointerCancel={slapp} />
  );

  return (
    <div ref={ruta} className={`flytande-fonster${mini ? " mini" : ""}`} role="dialog" aria-label={titel} style={{ left: lage.x, top: lage.y, width: lage.b, height: lage.h }}>
      <div className="fonster-titel" onPointerDown={borja("flytta")} onPointerMove={flytta} onPointerUp={slapp} onPointerCancel={slapp}
        onDoubleClick={() => valjMini(!mini)} title={mini ? "Dubbelklicka eller tryck ▢ för att öppna" : undefined}>
        <span>{titel}</span>
        <button className="fonster-stang" title={mini ? "Öppna fönstret" : "Minimera till en liten ruta"} aria-label={mini ? "Öppna fönstret" : "Minimera"}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={() => valjMini(!mini)}>{mini ? "▢" : "–"}</button>
        <button className="fonster-stang" title="Stäng fönstret" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={onStang}>✕</button>
      </div>
      <div className="fonster-innehall">{children}</div>
      {["n", "s", "o", "v", "no", "nv", "so", "sv"].map(handtag)}
    </div>
  );
}
