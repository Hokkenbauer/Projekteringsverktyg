import { useEffect, useState } from "react";

/** Brytpunkter (samma som i stil.css). Mobil: telefon. Smal: padda stående – menyn blir utfällbar. */
export const MOBIL = 760;
export const SMAL = 1000;

/** True när fönstret är högst `max` px brett. Följer med när fönstret ändrar storlek eller paddan vrids. */
export function useSmalSkarm(max = MOBIL): boolean {
  const fraga = `(max-width: ${max}px)`;
  const [smal, setSmal] = useState(() => typeof window !== "undefined" && window.matchMedia(fraga).matches);
  useEffect(() => {
    const mq = window.matchMedia(fraga);
    const vid = () => setSmal(mq.matches);
    vid();
    mq.addEventListener("change", vid);
    return () => mq.removeEventListener("change", vid);
  }, [fraga]);
  return smal;
}

/** Pekskärm utan mus (telefon, padda). */
export const arPekskarm = () => typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
