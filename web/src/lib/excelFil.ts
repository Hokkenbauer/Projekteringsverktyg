/**
 * Läsa och skriva Excel i webbläsaren. Biblioteket (SheetJS) ligger på vår egen server och laddas
 * först när det behövs.
 */
type XlsxLib = {
  read: (data: ArrayBuffer, opt: { type: "array" }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (ark: unknown, opt: { header: 1; raw: false; defval: string }) => unknown[][];
    aoa_to_sheet: (rader: (string | number)[][]) => Record<string, unknown>;
    book_new: () => unknown;
    book_append_sheet: (bok: unknown, ark: unknown, namn: string) => void;
  };
  writeFile: (bok: unknown, namn: string) => void;
};

let laddning: Promise<XlsxLib> | null = null;

function xlsx(): Promise<XlsxLib> {
  const w = window as unknown as { XLSX?: XlsxLib };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  laddning ??= new Promise((ok, fel) => {
    const s = document.createElement("script");
    s.src = "/ritning/lib/xlsx.full.min.js";
    s.onload = () => (w.XLSX ? ok(w.XLSX) : fel(new Error("Excel-biblioteket kunde inte laddas")));
    s.onerror = () => { laddning = null; fel(new Error("Excel-biblioteket kunde inte laddas")); };
    document.head.appendChild(s);
  });
  return laddning;
}

/** Läser första bladet i en Excel- eller CSV-fil som rader med text. */
export async function lasExcel(fil: File): Promise<string[][]> {
  const lib = await xlsx();
  const bok = lib.read(await fil.arrayBuffer(), { type: "array" });
  const ark = bok.Sheets[bok.SheetNames[0] ?? ""];
  if (!ark) return [];
  return lib.utils.sheet_to_json(ark, { header: 1, raw: false, defval: "" })
    .map((r) => r.map((c) => String(c ?? "").trim()));
}

export type Blad = { namn: string; rader: (string | number)[][]; bredder?: number[] };

/** Skapar och laddar ner en Excel-fil. Första raden i varje blad är rubrikerna. */
export async function skrivExcel(filnamn: string, blad: Blad[]) {
  const lib = await xlsx();
  const bok = lib.utils.book_new();
  for (const b of blad) {
    const ark = lib.utils.aoa_to_sheet(b.rader);
    if (b.bredder) ark["!cols"] = b.bredder.map((wch) => ({ wch }));
    lib.utils.book_append_sheet(bok, ark, b.namn.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Blad1");
  }
  lib.writeFile(bok, filnamn.endsWith(".xlsx") ? filnamn : `${filnamn}.xlsx`);
}

/**
 * Hittar rubrikraden och vilken kolumn som motsvarar varje fält, utifrån rubrikernas namn.
 * monster: fält → reguljära uttryck som matchar rubriken (första träffen vinner).
 */
export function tolkaRubriker(rader: string[][], monster: Record<string, RegExp>): { rubrikrad: number; kolumn: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rader.length, 20); i++) {
    const kolumn: Record<string, number> = {};
    rader[i]!.forEach((cell, c) => {
      const t = cell.toLowerCase();
      for (const [falt, re] of Object.entries(monster)) {
        if (kolumn[falt] === undefined && t && re.test(t)) { kolumn[falt] = c; break; }
      }
    });
    if (Object.keys(kolumn).length >= 2) return { rubrikrad: i, kolumn };
  }
  return null;
}
