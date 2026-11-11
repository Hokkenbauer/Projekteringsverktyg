/**
 * Tabellverktyg för funktionstextens editor: infoga tabell, rader och kolumner, ta bort, och flytta mellan celler.
 *
 * Tabeller från Word bär sin formatering i dolda attribut (data-tcpr, data-trpr, data-ppr, data-r, data-grid).
 * Nya rader och kolumner kopieras därför från en befintlig rad/cell så att typsnitt, bredder och ramar följer med.
 * Nya tabeller kopieras från ett befintligt rubriktabell–datatabell-par i texten när det finns ett med samma antal
 * kolumner (kundens mall), annars markeras de data-pv="rubrik"/"data" och får Arial 8 pt i Word-exporten.
 */

export type TabellMall = { namn: string; kolumner: string[]; /** Etikett–värde-tabell utan rubrikrad (Allmänt). */ rader?: [string, string][] };

/** Driftkortens standardtabeller (se 05 Funktionstexter). */
export const TABELLMALLAR: TabellMall[] = [
  { namn: "Allmänt", kolumner: ["", ""], rader: [["System", ""], ["Betjänar", ""], ["Styrs av", ""], ["Signering", "Funktionsavprovning Datum / Signatur"]] },
  { namn: "Inställningsvärden", kolumner: ["Komponent", "Inställning", "Kommentar"] },
  { namn: "Larminställningar", kolumner: ["Komponent", "Inställning", "Larmtext", "Kategori"] },
  { namn: "Mätning och indikering", kolumner: ["Komponent", "Placering", "Beskrivning", "Enhet"] },
  { namn: "Modbuspunkter", kolumner: ["Komponent", "Adress", "Datapunkt", "Enhet"] },
  { namn: "Rumsförteckning", kolumner: ["Typrum", "Rum", "Rumsnamn", "Anmärkning"] },
  { namn: "Spjällista", kolumner: ["Komponent", "Placering", "Typ", "Anmärkning"] },
  { namn: "Tom tabell, 2 kolumner", kolumner: ["", ""] },
  { namn: "Tom tabell, 3 kolumner", kolumner: ["", "", ""] },
  { namn: "Tom tabell, 4 kolumner", kolumner: ["", "", "", ""] },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cellen som markören står i (inom editorns rot). */
export function cellVidMarkor(rot: HTMLElement): HTMLTableCellElement | null {
  const sel = window.getSelection();
  let n: Node | null = sel?.anchorNode ?? null;
  while (n && n !== rot) {
    if (n instanceof HTMLTableCellElement) return rot.contains(n) ? n : null;
    n = n.parentNode;
  }
  return null;
}

/**
 * Tomma celler och stycken får en radbrytning så att man kan klicka in i dem (en helt tom cell går inte att
 * placera markören i). Radbrytningen tas bort igen när texten sparas.
 */
export function fyllTomma(rot: HTMLElement) {
  rot.querySelectorAll("td, th").forEach((td) => {
    if (!td.firstChild) td.innerHTML = "<p><br></p>";
  });
  rot.querySelectorAll("p, h1, h2, h3, li").forEach((b) => {
    if (!b.firstChild) b.appendChild(document.createElement("br"));
  });
}

const start = (td: HTMLTableCellElement) => {
  let i = 0;
  for (const c of Array.from((td.parentElement as HTMLTableRowElement).cells)) { if (c === td) return i; i += c.colSpan; }
  return i;
};
const tackande = (tr: HTMLTableRowElement, kol: number) => {
  let i = 0;
  for (const c of Array.from(tr.cells)) { if (kol >= i && kol < i + c.colSpan) return { cell: c, start: i }; i += c.colSpan; }
  return null;
};
const antalKolumner = (tr: HTMLTableRowElement) => Array.from(tr.cells).reduce((s, c) => s + c.colSpan, 0);
const rader = (t: HTMLTableElement) => Array.from(t.rows).filter((r) => r.closest("table") === t);

/** En tom kopia av en cell: cellens och första styckets Word-formatering behålls, texten tas bort. */
function tomKopia(td: HTMLTableCellElement): HTMLTableCellElement {
  const k = td.cloneNode(false) as HTMLTableCellElement;
  const forsta = td.querySelector("p, h1, h2, h3");
  const p = forsta ? (forsta.cloneNode(false) as HTMLElement) : document.createElement("p");
  // Styckets attribut (data-ppr, data-r) bär typsnitt och storlek, t.ex. Arial 8 pt och icke-fet.
  p.appendChild(document.createElement("br"));
  k.appendChild(p);
  return k;
}

/** Ändra hur många kolumner en cell spänner över, även i den sparade Word-formateringen. */
function sattSpan(td: HTMLTableCellElement, n: number) {
  if (n > 1) td.colSpan = n; else td.removeAttribute("colspan");
  const tcpr = td.getAttribute("data-tcpr");
  if (tcpr === null) return;
  let x = tcpr.replace(/<w:tcPr\b([^>]*)\/>/, "<w:tcPr$1></w:tcPr>").replace(/<w:gridSpan\b[^>]*\/>/g, "");
  if (n > 1) x = x.replace(/(<w:tcPr\b[^>]*>(?:<w:cnfStyle\b[^>]*\/>)?(?:<w:tcW\b[^>]*\/>)?)/, `$1<w:gridSpan w:val="${n}"/>`);
  td.setAttribute("data-tcpr", x);
}

/** Kolumnbredderna styrs då av tabellens rutnät (data-grid), inte av varje cells egen bredd. */
function slappCellbredder(t: HTMLTableElement) {
  t.querySelectorAll("td, th").forEach((c) => {
    const x = c.getAttribute("data-tcpr");
    if (x !== null && c.closest("table") === t) c.setAttribute("data-tcpr", x.replace(/<w:tcW\b[^>]*\/>/g, ""));
  });
}

function grid(t: HTMLTableElement): number[] | null {
  const g = t.getAttribute("data-grid");
  if (!g) return null;
  const v = g.split(",").map(Number);
  return v.every((x) => x > 0) ? v : null;
}

export function rad(td: HTMLTableCellElement, under: boolean): HTMLTableCellElement {
  const tr = td.parentElement as HTMLTableRowElement;
  const ny = tr.cloneNode(false) as HTMLTableRowElement;
  for (const c of Array.from(tr.cells)) ny.appendChild(tomKopia(c));
  tr.parentNode!.insertBefore(ny, under ? tr.nextSibling : tr);
  return ny.cells[Math.min(td.cellIndex, ny.cells.length - 1)]!;
}

export function kolumn(td: HTMLTableCellElement, hoger: boolean): HTMLTableCellElement | null {
  const t = td.closest("table") as HTMLTableElement;
  const kol = hoger ? start(td) + td.colSpan : start(td);
  let markor: HTMLTableCellElement | null = null;
  for (const tr of rader(t)) {
    const total = antalKolumner(tr);
    const f = kol >= total ? null : tackande(tr, kol);
    if (f && f.start !== kol) { sattSpan(f.cell, f.cell.colSpan + 1); continue; }
    const kalla = f?.cell ?? tr.cells[tr.cells.length - 1];
    if (!kalla) continue;
    const ny = tomKopia(kalla);
    sattSpan(ny, 1);
    tr.insertBefore(ny, f ? f.cell : null);
    if (tr === td.parentElement) markor = ny;
  }
  // Den nya kolumnen tar halva bredden från kolumnen bredvid, så att tabellen blir lika bred som förut.
  const g = grid(t);
  if (g) {
    const granne = Math.min(hoger ? kol - 1 : kol, g.length - 1);
    const halv = Math.round(g[granne]! / 2);
    g[granne] = g[granne]! - halv;
    g.splice(kol, 0, halv);
    t.setAttribute("data-grid", g.join(","));
  }
  slappCellbredder(t);
  return markor;
}

/** Tar bort raden. Returnerar en cell att ställa markören i, eller null om hela tabellen togs bort. */
export function taBortRad(td: HTMLTableCellElement): HTMLTableCellElement | null {
  const tr = td.parentElement as HTMLTableRowElement;
  const t = tr.closest("table") as HTMLTableElement;
  const alla = rader(t);
  if (alla.length <= 1) { taBortTabell(td); return null; }
  const i = alla.indexOf(tr);
  tr.remove();
  const kvar = alla[i + 1] ?? alla[i - 1]!;
  return kvar.cells[Math.min(td.cellIndex, kvar.cells.length - 1)] ?? null;
}

export function taBortKolumn(td: HTMLTableCellElement): HTMLTableCellElement | null {
  const t = td.closest("table") as HTMLTableElement;
  const kol = start(td);
  const g = grid(t);
  for (const tr of rader(t)) {
    const f = tackande(tr, kol);
    if (!f) continue;
    if (f.cell.colSpan > 1) sattSpan(f.cell, f.cell.colSpan - 1);
    else f.cell.remove();
    if (!tr.cells.length) tr.remove();
  }
  if (!rader(t).length) { t.remove(); return null; }
  if (g && kol < g.length) {
    // Bredden går till grannkolumnen.
    const b = g.splice(kol, 1)[0]!;
    if (g.length) { const n = Math.min(kol, g.length - 1); g[n] = g[n]! + b; t.setAttribute("data-grid", g.join(",")); }
  }
  slappCellbredder(t);
  const tr = td.isConnected ? (td.parentElement as HTMLTableRowElement) : rader(t)[0]!;
  return tackande(tr, Math.max(0, kol - 1))?.cell ?? null;
}

export function taBortTabell(td: HTMLTableCellElement) {
  (td.closest("table") as HTMLTableElement).remove();
}

/** Nästa eller föregående cell (Tab / Skift+Tab). Sist i tabellen med Tab läggs en ny rad till. */
export function nastaCell(td: HTMLTableCellElement, bakat: boolean): HTMLTableCellElement | null {
  const t = td.closest("table") as HTMLTableElement;
  const celler = rader(t).flatMap((r) => Array.from(r.cells));
  const i = celler.indexOf(td);
  if (bakat) return celler[i - 1] ?? null;
  return celler[i + 1] ?? rad(td, true).parentElement!.querySelector("td, th") as HTMLTableCellElement;
}

export function markorI(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  // I en cell som bara har en radbrytning ska markören stå före den.
  const sista = el.querySelector("p, h1, h2, h3") ?? el;
  if (sista.childNodes.length === 1 && sista.firstChild?.nodeName === "BR") r.setStart(sista, 0);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/* ---------- Infoga ny tabell ---------- */

const tomt = (el: Element | null) => !!el && (el.textContent ?? "").trim() === "" && !el.querySelector("table");

/** Ett rubriktabell–datatabell-par i texten med n kolumner: rubriktabell (en rad), tomt stycke, datatabell. */
function hittaPar(rot: HTMLElement, n: number): [HTMLTableElement, HTMLTableElement] | null {
  for (const t of Array.from(rot.querySelectorAll(":scope > table")) as HTMLTableElement[]) {
    const r = rader(t);
    if (r.length !== 1 || antalKolumner(r[0]!) !== n) continue;
    const mellan = t.nextElementSibling;
    const data = mellan?.nextElementSibling;
    if (mellan?.tagName === "P" && tomt(mellan) && data instanceof HTMLTableElement && rader(data).length && antalKolumner(rader(data)[0]!) === n)
      return [t, data];
  }
  return null;
}

function sattText(td: HTMLTableCellElement, text: string) {
  const p = td.querySelector("p, h1, h2, h3") ?? td;
  // Behåll en eventuell textbit med eget format (span data-rpr), byt bara texten.
  const span = p.querySelector("span[data-rpr]");
  const mal = (span ?? p) as HTMLElement;
  mal.innerHTML = text ? esc(text) : "<br>";
}

function byggTabell(mall: TabellMall, rot: HTMLElement): HTMLElement[] {
  const n = mall.kolumner.length;
  if (mall.rader) {
    const t = document.createElement("table");
    t.setAttribute("data-pv", "data");
    t.innerHTML = mall.rader.map(([a, b]) => `<tr><td><p>${a ? esc(a) : "<br>"}</p></td><td><p>${b ? esc(b) : "<br>"}</p></td></tr>`).join("");
    return [t];
  }
  const par = hittaPar(rot, n);
  if (par) {
    // Kopiera kundens egen formatering.
    const rub = par[0].cloneNode(true) as HTMLTableElement;
    Array.from(rader(rub)[0]!.cells).forEach((c, i) => sattText(c, mall.kolumner[i] ?? ""));
    const data = par[1].cloneNode(true) as HTMLTableElement;
    const r = rader(data);
    r.slice(1).forEach((x) => x.remove());
    Array.from(r[0]!.cells).forEach((c) => sattText(c, ""));
    const mellan = (par[0].nextElementSibling as HTMLElement).cloneNode(true) as HTMLElement;
    mellan.innerHTML = "<br>";
    return [rub, mellan, data];
  }
  const rub = document.createElement("table");
  rub.setAttribute("data-pv", "rubrik");
  rub.innerHTML = `<tr>${mall.kolumner.map((k) => `<td><p>${k ? esc(k) : "<br>"}</p></td>`).join("")}</tr>`;
  const mellan = document.createElement("p");
  mellan.innerHTML = "<br>";
  const data = document.createElement("table");
  data.setAttribute("data-pv", "data");
  data.innerHTML = `<tr>${mall.kolumner.map(() => "<td><p><br></p></td>").join("")}</tr>`;
  return [rub, mellan, data];
}

/** Infogar tabellen efter stycket (eller tabellen) där markören står, sist i texten om markören är utanför. */
export function infogaTabell(rot: HTMLElement, mall: TabellMall): HTMLTableCellElement | null {
  const sel = window.getSelection();
  let n: Node | null = sel?.anchorNode && rot.contains(sel.anchorNode) ? sel.anchorNode : null;
  while (n && n.parentNode !== rot) n = n.parentNode;
  const delar = byggTabell(mall, rot);
  const efter = document.createElement("p");
  efter.innerHTML = "<br>";
  const ref = n ? n.nextSibling : null;
  for (const d of [...delar, efter]) rot.insertBefore(d, ref);
  const sista = delar[delar.length - 1] as HTMLTableElement;
  return sista.querySelector("td");
}
