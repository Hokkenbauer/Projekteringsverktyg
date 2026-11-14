import type { TemaNamn } from "../lib/typer";

export const TEMAN: { id: TemaNamn; namn: string }[] = [
  { id: "natt", namn: "Natt (som i dag)" },
  { id: "dag", namn: "Dag" },
  { id: "grafit", namn: "Grafit" },
  { id: "grafitkontrast", namn: "Grafit kontrast" },
  { id: "desigo", namn: "Mellanljust" },
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
  tillampaUtseende(lasUtseende());
}

export function kommihagTema(tema: TemaNamn) {
  try {
    localStorage.setItem("pv-tema", tema);
  } catch {
    /* ignoreras */
  }
}

/**
 * Utseende (typsnitt, meny, tabeller, knappar, ritningshuvud) – oberoende av temat (färgerna).
 * "nytt" provas parallellt med det nuvarande tills det blir standard. Sparas per webbläsare.
 */
export type Utseende = "nuvarande" | "nytt";
export const UTSEENDEN: { id: Utseende; namn: string }[] = [
  { id: "nuvarande", namn: "Nuvarande" },
  { id: "nytt", namn: "Nytt (prov)" },
];

export function lasUtseende(): Utseende {
  try {
    return localStorage.getItem("pv-utseende") === "nytt" ? "nytt" : "nuvarande";
  } catch {
    return "nuvarande";
  }
}

export function tillampaUtseende(u: Utseende) {
  document.documentElement.dataset.utseende = u;
}

export function kommihagUtseende(u: Utseende) {
  try {
    localStorage.setItem("pv-utseende", u);
  } catch {
    /* ignoreras */
  }
}
