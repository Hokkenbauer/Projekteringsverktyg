import type { TemaNamn } from "../lib/typer";

export const TEMAN: { id: TemaNamn; namn: string }[] = [
  { id: "natt", namn: "Natt (som i dag)" },
  { id: "dag", namn: "Dag" },
  { id: "grafit", namn: "Grafit" },
  { id: "fjall", namn: "Fjäll" },
  { id: "system", namn: "Följ datorns inställning" },
];

/** Sätter temat på sidan. "system" följer datorns ljust/mörkt-läge. */
export function tillampaTema(tema: TemaNamn) {
  const rot = document.documentElement;
  rot.dataset.tema = tema;
}

/** Förhindrar att sidan blinkar i fel tema innan användarens val har hämtats. */
export function tillfalligtTema() {
  try {
    const sparat = localStorage.getItem("pv-tema") as TemaNamn | null;
    tillampaTema(sparat ?? "natt");
  } catch {
    tillampaTema("natt");
  }
}

export function kommihagTema(tema: TemaNamn) {
  try {
    localStorage.setItem("pv-tema", tema);
  } catch {
    /* ignoreras */
  }
}
