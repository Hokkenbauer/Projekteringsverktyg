/** Webbappens aktuella färger och typsnitt, för de inbäddade ritverktygen. */
export function temaForVerktyg(): Record<string, string | boolean> {
  const st = getComputedStyle(document.documentElement);
  const v = (n: string) => st.getPropertyValue(n).trim();
  return {
    bg: v("--bg"), yta: v("--yta"), yta2: v("--yta-2"), linje: v("--linje"), text: v("--text"), dampad: v("--dampad"),
    accent: v("--accent"), accentText: v("--accent-text"), fara: v("--fara"), varning: v("--varning"), klar: v("--ok"),
    sans: v("--font"), mono: v("--font-mono"), ljust: st.colorScheme !== "dark",
  };
}
