import { huvudUppgifter } from "./dokumenttema";
import {
  arSektion, bredderFor, hamtaLogga, sektionText,
  type Block, type BlockDokument, type Cell, type Ruta, type Tabell, type WordHuvud, type WordLogga,
} from "./dokumentBlock";

/**
 * PDF av ett blockdokument, direkt i webbläsaren, i samma tema som utskriften ("HECO kombinerad"):
 * ritningshuvud på varje sida, tabeller med grå rubrikrad och ränder, fotrad med "Blad x(y)".
 *
 * Används där webbläsarens utskrift inte räcker: när många dokument ska bli egna PDF-filer på en gång
 * (filexporten). Typsnittet är Carlito, som har samma mått som Calibri.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type JsPdf = any;
type JsPdfKlass = new (o: { unit: "mm"; format: "a4"; orientation: "portrait" | "landscape"; compress?: boolean }) => JsPdf;

export type PdfResurser = { jsPDF: JsPdfKlass; typsnitt: Record<"normal" | "bold" | "italic" | "bolditalic", string> };

let jspdfLaddning: Promise<JsPdfKlass> | null = null;
function laddaJsPdf(): Promise<JsPdfKlass> {
  const w = window as unknown as { jspdf?: { jsPDF: JsPdfKlass } };
  if (w.jspdf) return Promise.resolve(w.jspdf.jsPDF);
  jspdfLaddning ??= new Promise((ok, fel) => {
    const s = document.createElement("script");
    s.src = "/ritning/lib/jspdf.umd.min.js";
    s.onload = () => (w.jspdf ? ok(w.jspdf.jsPDF) : fel(new Error("PDF-biblioteket kunde inte laddas")));
    s.onerror = () => { jspdfLaddning = null; fel(new Error("PDF-biblioteket kunde inte laddas")); };
    document.head.appendChild(s);
  });
  return jspdfLaddning;
}

/** Typsnittsfilen som "binär sträng" (det format jsPDF vill ha). */
async function hamtaTypsnitt(fil: string): Promise<string> {
  const svar = await fetch(`/typsnitt/${fil}`);
  if (!svar.ok) throw new Error(`Typsnittet ${fil} kunde inte hämtas`);
  const b = new Uint8Array(await svar.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

let resurser: Promise<PdfResurser> | null = null;
/** Bibliotek och typsnitt hämtas en gång (ca 2 MB) och återanvänds för alla PDF:er. */
export function pdfResurser(): Promise<PdfResurser> {
  resurser ??= (async () => {
    const [jsPDF, normal, bold, italic, bolditalic] = await Promise.all([
      laddaJsPdf(), hamtaTypsnitt("Carlito-Regular.ttf"), hamtaTypsnitt("Carlito-Bold.ttf"),
      hamtaTypsnitt("Carlito-Italic.ttf"), hamtaTypsnitt("Carlito-BoldItalic.ttf"),
    ]);
    return { jsPDF, typsnitt: { normal, bold, italic, bolditalic } };
  })();
  resurser.catch(() => { resurser = null; });
  return resurser;
}

// ---------------------------------------------------------------- Mått (mm) och stil

const PT = 25.4 / 72;
const RADAVSTAND = 1.3;
const BRODTEXT = 9.5;
const LINJE = 0.25;
const MARGINAL = { topp: 10, sida: 12, botten: 15 };
const HUVUD_HOJD = 23;
const EFTER_HUVUD = 4;

type Stil = "normal" | "bold" | "italic" | "bolditalic";
/** Tecken som typsnittet saknar ritas som streck (kryssrutor och bock). */
const SYMBOL = /[✔✓☒☐]/;
const SYMBOLER = /([✔✓☒☐])/;

const rgb = (farg: string | undefined): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((farg ?? "").trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** Tecken som typsnittet saknar byts mot närmaste som finns. */
const rensa = (t: string) => t.replace(/➜|➔|⇒/g, "→").replace(/\r/g, "").replace(/\t/g, "    ");

class Ritare {
  readonly pdf: JsPdf;
  readonly B: number;
  readonly H: number;
  readonly x0 = MARGINAL.sida;
  readonly bredd: number;
  readonly toppInnehall = MARGINAL.topp + HUVUD_HOJD + EFTER_HUVUD;
  readonly botten: number;
  y: number;

  constructor(pdf: JsPdf) {
    this.pdf = pdf;
    this.B = pdf.internal.pageSize.getWidth();
    this.H = pdf.internal.pageSize.getHeight();
    this.bredd = this.B - 2 * MARGINAL.sida;
    this.botten = this.H - MARGINAL.botten;
    this.y = this.toppInnehall;
  }

  get iToppen() { return this.y <= this.toppInnehall + 0.01; }
  nySida() { this.pdf.addPage(); this.y = this.toppInnehall; }
  /** Ny sida om det inte får plats (och vi inte redan står överst). */
  plats(mm: number) { if (this.y + mm > this.botten && !this.iToppen) this.nySida(); }

  typ(storlek: number, stil: Stil = "normal") { this.pdf.setFont("Carlito", stil); this.pdf.setFontSize(storlek); }
  radhojd(storlek: number) { return storlek * PT * RADAVSTAND; }
  bredden(t: string) { return this.pdf.getTextWidth(t.replace(/\u00AD/g, "").replace(new RegExp(SYMBOL.source, "g"), "O")); }

  /** Radbryter text till en viss bredd (aktuellt typsnitt). Radbrytningar i texten behålls. */
  bryt(text: string, maxB: number): string[] {
    const ut: string[] = [];
    for (const stycke of rensa(text).split("\n")) {
      const ord = stycke.split(" ");
      let rad = "";
      for (const o of ord) {
        const forsok = rad ? `${rad} ${o}` : o;
        if (this.bredden(forsok) <= maxB) { rad = forsok.replace(/\u00AD/g, ""); continue; }
        if (rad) ut.push(rad);
        // Ett ord som är längre än raden delas, helst vid ett mjukt bindestreck (t.ex. "Projekterings\u00ADledare").
        let rest = o;
        while (this.bredden(rest) > maxB && rest.includes("\u00AD")) {
          const delar = rest.split("\u00AD");
          let n = delar.length - 1;
          while (n > 0 && this.bredden(`${delar.slice(0, n).join("")}-`) > maxB) n--;
          if (n === 0) break;
          ut.push(`${delar.slice(0, n).join("")}-`);
          rest = delar.slice(n).join("\u00AD");
        }
        rest = rest.replace(/\u00AD/g, "");
        while (this.bredden(rest) > maxB && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && this.bredden(rest.slice(0, n)) > maxB) n--;
          ut.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        rad = rest;
      }
      ut.push(rad);
    }
    return ut;
  }

  /** En rad text med baslinjen på y. Kryssrutor och bockar ritas som streck. */
  text(t: string, x: number, y: number, jamn: "left" | "center" | "right" = "left") {
    if (!t) return;
    const w = this.bredden(t);
    let xx = jamn === "center" ? x - w / 2 : jamn === "right" ? x - w : x;
    if (!SYMBOL.test(t)) { this.pdf.text(t, xx, y); return; }
    const storlek = this.pdf.getFontSize() * PT;
    for (const del of t.split(SYMBOLER)) {
      if (!del) continue;
      if (SYMBOL.test(del)) { this.symbol(del, xx, y, storlek); xx += this.bredden("O") + storlek * 0.08; }
      else { this.pdf.text(del, xx, y); xx += this.pdf.getTextWidth(del); }
    }
  }

  private symbol(s: string, x: number, y: number, storlek: number) {
    const p = this.pdf;
    p.setLineWidth(Math.max(0.12, storlek * 0.07));
    const sida = storlek * 0.56;
    const bx = x + storlek * 0.06, by = y - sida - storlek * 0.02;
    if (s === "☐" || s === "☒") {
      p.rect(bx, by, sida, sida, "S");
      if (s === "☒") { p.line(bx, by, bx + sida, by + sida); p.line(bx + sida, by, bx, by + sida); }
    } else {
      p.setLineWidth(Math.max(0.2, storlek * 0.11));
      p.lines([[sida * 0.3, sida * 0.38], [sida * 0.62, -sida * 0.95]], bx + sida * 0.05, by + sida * 0.55, [1, 1], "S", false);
    }
    p.setLineWidth(LINJE);
  }

  fyll(farg: string | undefined, x: number, y: number, b: number, h: number) {
    const c = rgb(farg);
    if (!c) return;
    this.pdf.setFillColor(c[0], c[1], c[2]);
    this.pdf.rect(x, y, b, h, "F");
  }

  ram(x: number, y: number, b: number, h: number) {
    this.pdf.setDrawColor(0);
    this.pdf.setLineWidth(LINJE);
    this.pdf.rect(x, y, b, h, "S");
  }

  textfarg(farg?: string) {
    const c = rgb(farg) ?? [0, 0, 0];
    this.pdf.setTextColor(c[0], c[1], c[2]);
  }
}

// ---------------------------------------------------------------- Huvud och fot

function ritaHuvud(r: Ritare, h: WordHuvud, logga: WordLogga | null) {
  const p = r.pdf;
  const x = r.x0, y = MARGINAL.topp, B = r.bredd, H = HUVUD_HOJD;
  const bL = B * 0.24, bR = B * 0.33, bM = B - bL - bR;
  p.setDrawColor(0);
  p.setLineWidth(LINJE);
  r.ram(x, y, B, H);
  p.line(x + bL, y, x + bL, y + H);
  p.line(x + bL + bM, y, x + bL + bM, y + H);
  p.line(x + bL, y + H / 2, x + bL + bM, y + H / 2);

  if (logga) {
    const maxB = bL - 4, maxH = H - 3;
    const s = Math.min(maxB / logga.bredd, maxH / logga.hojd);
    const lb = logga.bredd * s, lh = logga.hojd * s;
    p.addImage(logga.data, logga.typ === "png" ? "PNG" : "JPEG", x + (bL - lb) / 2, y + (H - lh) / 2, lb, lh, "logga", "FAST");
  }

  r.textfarg();
  const mx = x + bL + 1.6;
  const passa = (t: string, storlek: number, stil: Stil, maxB: number) => {
    let s = storlek;
    r.typ(s, stil);
    while (s > 6 && r.bredden(t) > maxB) { s -= 0.5; r.typ(s, stil); }
  };
  r.typ(6.5); r.text("Dokumentnamn:", mx, y + 2.9);
  passa(h.titel, 11, "normal", bM - 3.2); r.text(h.titel, mx, y + 8.2);
  r.typ(6.5); r.text("Projekt:", mx, y + H / 2 + 2.9);
  passa(h.projektnamn, 11, "normal", bM - 3.2); r.text(h.projektnamn, mx, y + H / 2 + 7.4);
  if (h.projektrad) { passa(h.projektrad, 6.5, "normal", bM - 3.2); r.text(h.projektrad, mx, y + H - 1.3); }

  const rx = x + bL + bM, radH = 4.1;
  for (let i = 0; i < 4; i++) {
    const ry = y + i * radH;
    p.line(rx, ry + radH, rx + bR, ry + radH);
    const [e, v] = h.rader[i] ?? ["", ""];
    passa(e, 8.5, "normal", bR * 0.55 - 3); r.text(e, rx + 1.6, ry + radH - 1.1);
    passa(v, 8.5, "normal", bR * 0.45 - 3); r.text(v, rx + bR * 0.55 + 1.6, ry + radH - 1.1);
  }
  p.line(rx + bR * 0.55, y, rx + bR * 0.55, y + 4 * radH);
  const status = h.status.toUpperCase();
  passa(status, 12, "bold", bR - 3);
  r.text(status, rx + bR / 2, y + 4 * radH + (H - 4 * radH) / 2 + 1.5, "center");
}

function ritaFot(r: Ritare, h: WordHuvud, sida: number, sidor: number) {
  const p = r.pdf;
  const y = r.H - MARGINAL.botten + 2.6;
  p.setDrawColor(0);
  p.setLineWidth(0.21);
  p.line(r.x0, y, r.x0 + r.bredd, y);
  r.textfarg();
  r.typ(7);
  const hoger = `${h.titel} · Blad ${sida}(${sidor})`;
  r.text(hoger, r.x0 + r.bredd, y + 3, "right");
  const plats = r.bredd - r.bredden(hoger) - 6;
  let vanster = h.fotVanster;
  while (vanster.length > 4 && r.bredden(vanster) > plats) vanster = `${vanster.slice(0, -2).trimEnd()}…`;
  r.text(vanster, r.x0, y + 3);
}

// ---------------------------------------------------------------- Block

const PAD_V = 1, PAD_H = 1.4;

type CellUt = { rader: string[]; stil: Stil; jamn: "left" | "center"; fyll?: string; farg?: string };

function tabell(r: Ritare, b: Tabell) {
  const total = (r.bredd * (b.bredd ?? 100)) / 100;
  const bredder = bredderFor(b).map((w) => (w * total) / 100);
  const xs = bredder.reduce<number[]>((a, w) => [...a, a[a.length - 1]! + w], [r.x0]);
  const mitt = new Set(b.centrera ?? []);
  const lh = r.radhojd(BRODTEXT);

  const forbered = (celler: (Cell | undefined)[], stil: Stil, jamnFor: (i: number) => boolean): { celler: CellUt[]; hojd: number } => {
    const ut = celler.map((c, i) => {
      const o = typeof c === "string" || c === undefined ? { text: c ?? "" } : c;
      const s: Stil = o.fet || stil === "bold" ? "bold" : "normal";
      r.typ(BRODTEXT, s);
      return { rader: r.bryt(o.text, bredder[i]! - 2 * PAD_H), stil: s, jamn: (jamnFor(i) || o.mitt ? "center" : "left") as CellUt["jamn"], fyll: o.fyll, farg: o.farg };
    });
    return { celler: ut, hojd: Math.max(...ut.map((c) => c.rader.length)) * lh + 2 * PAD_V };
  };

  const ritaRad = (rad: { celler: CellUt[]; hojd: number }, y: number, h: number, zebra?: string) => {
    rad.celler.forEach((c, i) => {
      const x = xs[i]!, w = bredder[i]!;
      r.fyll(c.fyll ?? zebra, x, y, w, h);
      r.ram(x, y, w, h);
      r.typ(BRODTEXT, c.stil);
      r.textfarg(c.farg);
      c.rader.forEach((t, j) => r.text(t, c.jamn === "center" ? x + w / 2 : x + PAD_H, y + PAD_V + lh * j + BRODTEXT * PT * 0.95, c.jamn));
    });
    r.textfarg();
  };

  const helRad = (text: string, fyll: string, farg: string | undefined, stil: Stil, storlek = BRODTEXT) => {
    r.typ(storlek, stil);
    const rader = r.bryt(text, total - 2 * PAD_H);
    const h = rader.length * r.radhojd(storlek) + 2 * PAD_V;
    return {
      hojd: h,
      rita: (y: number) => {
        r.fyll(fyll, r.x0, y, total, h);
        r.ram(r.x0, y, total, h);
        r.typ(storlek, stil);
        r.textfarg(farg);
        rader.forEach((t, j) => r.text(t, r.x0 + PAD_H, y + PAD_V + r.radhojd(storlek) * j + storlek * PT * 0.95));
        r.textfarg();
      },
    };
  };

  // Rubrikraderna upprepas överst på varje ny sida.
  const titel = b.titelrad ? helRad(b.titelrad.text, b.titelrad.fyll ?? "#BFBFBF", b.titelrad.farg, "bold", 10) : null;
  const rubrik = b.utanRubrik ? null : forbered(b.kolumner, "bold", (i) => mitt.has(i));
  const rubrikHojd = (titel?.hojd ?? 0) + (rubrik?.hojd ?? 0);
  const ritaRubrik = () => {
    if (titel) { titel.rita(r.y); r.y += titel.hojd; }
    if (rubrik) { ritaRad({ ...rubrik, celler: rubrik.celler.map((c) => ({ ...c, fyll: "#BFBFBF" })) }, r.y, rubrik.hojd); r.y += rubrik.hojd; }
  };

  const rader = b.rader.map((rad, n) => {
    if (arSektion(rad)) {
      const o: { fyll?: string; farg?: string } = typeof rad === "string" ? {} : rad;
      const s = helRad(sektionText(rad), o.fyll ?? "#E2E2E2", o.farg, "bold");
      return { sektion: true, hojd: s.hojd, rita: (y: number) => s.rita(y) };
    }
    const f = forbered(b.kolumner.map((_, i) => rad[i]), "normal", (i) => mitt.has(i));
    const hojd = Math.max(f.hojd, b.radhojd ?? 0);
    const zebra = !b.utanRubrik && n % 2 === 1 ? "#F2F2F2" : undefined;
    return { sektion: false, hojd, f, zebra, rita: (y: number) => ritaRad(f, y, hojd, zebra) };
  });

  // Rubriken ska inte stå ensam längst ned på en sida.
  r.plats(rubrikHojd + (rader[0]?.hojd ?? 0) + (rader[0]?.sektion ? rader[1]?.hojd ?? 0 : 0));
  ritaRubrik();
  rader.forEach((rad, i) => {
    // En avsnittsrad följer med nästa rad till nästa sida.
    const behov = rad.hojd + (rad.sektion ? rader[i + 1]?.hojd ?? 0 : 0);
    if (r.y + behov > r.botten && r.y > r.toppInnehall + rubrikHojd + 0.01) { r.nySida(); ritaRubrik(); }
    if ("f" in rad && rad.f && r.y + rad.hojd > r.botten) {
      // Raden är högre än en hel sida: dela den mellan sidorna.
      delaRad(r, rad.f, rad.zebra, xs, bredder, lh, ritaRubrik);
      return;
    }
    rad.rita(r.y);
    r.y += rad.hojd;
  });
}

/** En tabellrad som inte får plats på en sida delas rad för rad. */
function delaRad(r: Ritare, f: { celler: CellUt[] }, zebra: string | undefined, xs: number[], bredder: number[], lh: number, ritaRubrik: () => void) {
  let kvar = f.celler.map((c) => [...c.rader]);
  while (kvar.some((c) => c.length)) {
    const ryms = Math.max(1, Math.floor((r.botten - r.y - 2 * PAD_V) / lh));
    const nu = kvar.map((c) => c.slice(0, ryms));
    kvar = kvar.map((c) => c.slice(ryms));
    const h = Math.max(...nu.map((c) => c.length)) * lh + 2 * PAD_V;
    f.celler.forEach((c, i) => {
      const x = xs[i]!, w = bredder[i]!;
      r.fyll(c.fyll ?? zebra, x, r.y, w, h);
      r.ram(x, r.y, w, h);
      r.typ(BRODTEXT, c.stil);
      r.textfarg(c.farg);
      nu[i]!.forEach((t, j) => r.text(t, c.jamn === "center" ? x + w / 2 : x + PAD_H, r.y + PAD_V + lh * j + BRODTEXT * PT * 0.95, c.jamn));
    });
    r.textfarg();
    r.y += h;
    if (kvar.some((c) => c.length)) { r.nySida(); ritaRubrik(); }
  }
}

function form(r: Ritare, b: Extract<Block, { typ: "form" }>) {
  const eb = b.etikettBredd ?? 42;
  tabell(r, {
    typ: "tabell", kolumner: ["", ""], bredder: [eb, 100 - eb], utanRubrik: true, bredd: b.bredd,
    rader: b.rader.map(([e, v]) => [{ text: e, fyll: "#F2F2F2" }, v]),
  });
}

function rutor(r: Ritare, b: Extract<Block, { typ: "rutor" }>) {
  const lh = r.radhojd(BRODTEXT), lhE = r.radhojd(9);
  for (const rad of b.rader) {
    const fri = 100 - rad.reduce((s, x) => s + (x.bredd ?? 0), 0);
    const utan = rad.filter((x) => !x.bredd).length;
    const bredder = rad.map((x) => ((x.bredd ?? fri / Math.max(1, utan)) * r.bredd) / 100);
    const innehall = rad.map((x: Ruta, i) => {
      r.typ(9, "bold");
      const etikett = x.etikett ? r.bryt(x.etikett, bredder[i]! - 3.2) : [];
      r.typ(BRODTEXT, x.dampad ? "italic" : "normal");
      const varde = x.varde ? r.bryt(x.varde, bredder[i]! - 3.2) : [];
      return { etikett, varde, dampad: !!x.dampad, hojd: Math.max(x.hojd ?? 0, etikett.length * lhE + varde.length * lh + 2.4) };
    });
    const h = Math.max(...innehall.map((c) => c.hojd));
    r.plats(h);
    let x = r.x0;
    innehall.forEach((c, i) => {
      const w = bredder[i]!;
      r.ram(x, r.y, w, h);
      let ty = r.y + 1.2;
      r.typ(9, "bold");
      r.textfarg();
      for (const t of c.etikett) { r.text(t, x + 1.6, ty + 9 * PT * 0.95); ty += lhE; }
      r.typ(BRODTEXT, c.dampad ? "italic" : "normal");
      r.textfarg(c.dampad ? "#777777" : undefined);
      for (const t of c.varde) { r.text(t, x + 1.6, ty + BRODTEXT * PT * 0.95); ty += lh; }
      r.textfarg();
      x += w;
    });
    r.y += h - LINJE; // rutorna delar kantlinje med raden under
  }
  r.y += LINJE;
}

function textblock(r: Ritare, text: string, stil: Stil, storlek = BRODTEXT) {
  r.typ(storlek, stil);
  const lh = r.radhojd(storlek);
  for (const rad of r.bryt(text, r.bredd)) {
    r.plats(lh);
    r.typ(storlek, stil);
    r.text(rad, r.x0, r.y + storlek * PT * 0.95);
    r.y += lh;
  }
}

/** Ungefärlig höjd på början av ett block (det som inte får skiljas från rubriken ovanför). */
function borjan(b?: Block): number {
  if (!b) return 0;
  const rad = BRODTEXT * PT * RADAVSTAND + 2 * PAD_V;
  switch (b.typ) {
    case "rutor": return Math.min(60, Math.max(12, ...(b.rader[0] ?? []).map((x) => x.hojd ?? 0)) + 2);
    case "tabell": return (b.titelrad ? rad + 1 : 0) + (b.utanRubrik ? 0 : rad) + Math.max(rad, b.radhojd ?? 0) * Math.min(2, Math.max(1, b.rader.length));
    case "form": return rad * Math.min(2, b.rader.length);
    case "text": return BRODTEXT * PT * RADAVSTAND * 2;
    default: return 10;
  }
}

const arTabell = (b?: Block) => b?.typ === "tabell" || b?.typ === "form" || b?.typ === "rutor";

function ritaBlock(r: Ritare, block: Block[]) {
  block.forEach((b, i) => {
    const fore = block[i - 1];
    switch (b.typ) {
      case "rubrik": {
        if (!r.iToppen) r.y += i === 0 ? 0 : 5;
        // Rubriken följer med början av nästa block till nästa sida.
        r.plats(r.radhojd(10) + 1.5 + borjan(block[i + 1]));
        textblock(r, b.text.toUpperCase(), "bold", 10);
        r.y += 1.5;
        break;
      }
      case "text":
        if (arTabell(fore) && !r.iToppen) r.y += 4;
        textblock(r, b.text, b.kursiv && b.fet ? "bolditalic" : b.kursiv ? "italic" : b.fet ? "bold" : "normal");
        r.y += 1.5;
        break;
      case "tabell":
      case "form":
        if (arTabell(fore) && !r.iToppen) r.y += 3;
        if (b.typ === "tabell") tabell(r, b); else form(r, b);
        break;
      case "rutor":
        if ((fore?.typ === "tabell" || fore?.typ === "form" || fore?.typ === "text") && !r.iToppen) r.y += fore.typ === "text" ? 1.5 : 3;
        rutor(r, b);
        break;
      case "luft": if (!r.iToppen) r.y += b.mm ?? 4; break;
      case "sidbrytning": if (!r.iToppen) r.nySida(); break;
    }
  });
}

/** Bygger PDF-filen. Ren funktion – bibliotek, typsnitt och logga skickas in färdiga. */
export function byggPdf(d: { titel: string; liggande?: boolean; block: Block[] }, h: WordHuvud, logga: WordLogga | null, res: PdfResurser): Uint8Array {
  const pdf: JsPdf = new res.jsPDF({ unit: "mm", format: "a4", orientation: d.liggande ? "landscape" : "portrait", compress: true });
  pdf.addFileToVFS("Carlito-Regular.ttf", res.typsnitt.normal);
  pdf.addFileToVFS("Carlito-Bold.ttf", res.typsnitt.bold);
  pdf.addFileToVFS("Carlito-Italic.ttf", res.typsnitt.italic);
  pdf.addFileToVFS("Carlito-BoldItalic.ttf", res.typsnitt.bolditalic);
  pdf.addFont("Carlito-Regular.ttf", "Carlito", "normal");
  pdf.addFont("Carlito-Bold.ttf", "Carlito", "bold");
  pdf.addFont("Carlito-Italic.ttf", "Carlito", "italic");
  pdf.addFont("Carlito-BoldItalic.ttf", "Carlito", "bolditalic");
  pdf.setProperties({ title: h.titel, subject: h.projektnamn, creator: h.foretag, author: h.foretag });
  pdf.setLineHeightFactor(RADAVSTAND);

  const r = new Ritare(pdf);
  ritaBlock(r, d.block);
  const sidor = pdf.getNumberOfPages();
  for (let i = 1; i <= sidor; i++) {
    pdf.setPage(i);
    ritaHuvud(r, h, logga);
    ritaFot(r, h, i, sidor);
  }
  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

const loggor = new Map<string, Promise<WordLogga | null>>();
/** Loggan som PNG, en gång per adress. */
export function loggaFor(url: string) {
  let l = loggor.get(url);
  if (!l) { l = hamtaLogga(url); loggor.set(url, l); }
  return l;
}

/** PDF av ett blockdokument (huvudet med projektets aktuella dokumentuppgifter). */
export async function pdfAv(d: BlockDokument): Promise<Uint8Array> {
  const h = huvudUppgifter(d);
  const [res, logga] = await Promise.all([pdfResurser(), loggaFor(h.loggaUrl)]);
  return byggPdf(d, h, logga, res);
}
