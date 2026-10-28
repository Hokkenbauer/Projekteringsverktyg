import { useEffect, useRef } from "react";

/**
 * Fördröjd sparning (autosave) som aldrig tappar en ändring:
 * - planera(fn, ms) sparar en stund efter sista ändringen,
 * - när vyn stängs (byte av flik, skåp …) sparas det som väntar direkt i stället för att kastas,
 * - sparaAllaNu() sparar allt som väntar i hela appen och väntar in pågående sparningar
 *   (används före filexporten, så att exporten får med det senaste).
 */

type Vantande = { fn: () => unknown; timer: number };
const vantande = new Map<symbol, Vantande>();
const pagaende = new Set<Promise<unknown>>();

function kor(fn: () => unknown) {
  try {
    const p = Promise.resolve(fn());
    pagaende.add(p);
    void p.catch(() => undefined).finally(() => pagaende.delete(p));
    return p;
  } catch (e) {
    return Promise.reject(e);
  }
}

/** En sparning som görs på annat sätt (t.ex. ritningen när fliken lämnas) och som sparaAllaNu() ska vänta in. */
export function registreraSparning(p: Promise<unknown>) {
  pagaende.add(p);
  void p.catch(() => undefined).finally(() => pagaende.delete(p));
}

/** Sparar allt som väntar och väntar tills alla sparningar är klara. Fel i en sparning visas av vyn själv. */
export async function sparaAllaNu(): Promise<void> {
  for (const [nyckel, v] of [...vantande]) {
    window.clearTimeout(v.timer);
    vantande.delete(nyckel);
    kor(v.fn);
  }
  await Promise.allSettled([...pagaende]);
}

/** Antal ändringar som väntar på att sparas eller håller på att sparas. */
export const osparade = () => vantande.size + pagaende.size;

export function useFordrojdSparning() {
  const nyckel = useRef(Symbol("sparning")).current;
  useEffect(() => () => {
    // Vyn stängs: spara det som väntar nu.
    const v = vantande.get(nyckel);
    if (v) { window.clearTimeout(v.timer); vantande.delete(nyckel); kor(v.fn); }
  }, [nyckel]);
  return {
    /** Sparar med fn efter ms millisekunder; en ny ändring före dess ersätter den väntande. */
    planera(fn: () => unknown, ms: number) {
      const fore = vantande.get(nyckel);
      if (fore) window.clearTimeout(fore.timer);
      const timer = window.setTimeout(() => { vantande.delete(nyckel); kor(fn); }, ms);
      vantande.set(nyckel, { fn, timer });
    },
    /** Sparar det som väntar direkt (t.ex. när fältet lämnas). */
    nu() {
      const v = vantande.get(nyckel);
      if (!v) return Promise.resolve();
      window.clearTimeout(v.timer);
      vantande.delete(nyckel);
      return kor(v.fn);
    },
    /** Glömmer det som väntar (t.ex. när servern har en nyare version). */
    avbryt() {
      const v = vantande.get(nyckel);
      if (v) { window.clearTimeout(v.timer); vantande.delete(nyckel); }
    },
  };
}
