import { esc, huvudUppgifter, oppnaDokument } from "./dokumenttema";
import type { Projekt } from "./typer";
import { zip } from "./zip";

/**
 * Dokument som byggs av block (rubriker, text, etikett/värde-tabeller och datatabeller) och kan bli
 * både utskrift/PDF och Word i dokumenttemat "HECO kombinerad": samma ritningshuvud, tabeller med grå
 * rubrikrad och ränder, och fotrad med företagsuppgifter och "Blad x(y)".
 */
export type Block =
  | { typ: "rubrik"; text: string }
  | { typ: "text"; text: string; kursiv?: boolean }
  /** Etikett/värde-tabell (t.ex. Objekt, Kund, Projektör). */
  | { typ: "form"; rader: [string, string][] }
  /** Datatabell. En rad som är en sträng blir en avsnittsrad över hela bredden. */
  | { typ: "tabell"; kolumner: string[]; bredder: number[]; rader: (string[] | string)[]; centrera?: number[] }
  | { typ: "sidbrytning" };

export type BlockDokument = {
  titel: string;
  /** Text i statusrutan när projektet saknar handlingsstatus. */
  kategori?: string;
  liggande?: boolean;
  projekt?: Projekt | null;
  block: Block[];
};

// ---------------------------------------------------------------- Utskrift / PDF

export function blockHtml(block: Block[]): string {
  return block.map((b) => {
    switch (b.typ) {
      case "rubrik": return `<h2>${esc(b.text)}</h2>`;
      case "text": return `<p${b.kursiv ? ' style="font-style:italic"' : ""}>${esc(b.text).replace(/\n/g, "<br>")}</p>`;
      case "form": return `<table class="data form"><tbody>${b.rader.map(([a, v]) => `<tr><th>${esc(a)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
      case "sidbrytning": return `<div style="break-after:page;page-break-after:always"></div>`;
      case "tabell": {
        const mitt = new Set(b.centrera ?? []);
        return `<table class="data"><thead><tr>${b.kolumner.map((k, i) => `<th style="width:${b.bredder[i] ?? 10}%${mitt.has(i) ? ";text-align:center" : ""}">${esc(k)}</th>`).join("")}</tr></thead>
<tbody>${b.rader.map((r) => typeof r === "string"
          ? `<tr class="sektion"><td colspan="${b.kolumner.length}">${esc(r)}</td></tr>`
          : `<tr>${r.map((c, i) => `<td${mitt.has(i) ? ' style="text-align:center"' : ""}>${esc(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      }
    }
  }).join("\n");
}

/** Skriver ut dokumentet (i utskriftsrutan kan man välja Spara som PDF). */
export function skrivUtBlock(d: BlockDokument, fonster?: Window | null) {
  return oppnaDokument({ titel: d.titel, kategori: d.kategori, liggande: d.liggande, projekt: d.projekt,
    css: "h2+table.data,h2+table.form{margin-top:0}table.data+h2,table.data+p{margin-top:5mm}p+table.data{margin-top:1.5mm}", kropp: blockHtml(d.block) }, fonster);
}

// ---------------------------------------------------------------- Word

export type WordLogga = { data: Uint8Array; typ: "png" | "jpeg"; bredd: number; hojd: number };
export type WordHuvud = ReturnType<typeof huvudUppgifter>;

const x = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // Tecken som inte är tillåtna i XML (t.ex. från inklistrad text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const MM = 56.7; // twips per millimeter
const EMU_MM = 36000;
const FONT = "Calibri";

/** En textkörning. Radbrytningar i texten blir radbrytningar i Word. */
function run(text: string, o: { fet?: boolean; kursiv?: boolean; storlek?: number; versaler?: boolean } = {}) {
  const rpr = `<w:rPr>${o.fet ? "<w:b/>" : ""}${o.kursiv ? "<w:i/>" : ""}${o.versaler ? "<w:caps/>" : ""}${o.storlek ? `<w:sz w:val="${o.storlek}"/><w:szCs w:val="${o.storlek}"/>` : ""}</w:rPr>`;
  return text.split("\n").map((del, i) => `<w:r>${rpr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${x(del)}</w:t></w:r>`).join("");
}

function para(innehall: string, o: { jc?: "center" | "right"; fore?: number; efter?: number; hallIhop?: boolean } = {}) {
  const ppr = `<w:pPr>${o.hallIhop ? "<w:keepNext/>" : ""}<w:spacing w:before="${o.fore ?? 0}" w:after="${o.efter ?? 0}"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>`;
  return `<w:p>${ppr}${innehall}</w:p>`;
}

function cell(bredd: number, innehall: string, o: { fyll?: string; span?: number; vMerge?: "restart" | "continue"; vAlign?: "center" | "top" | "bottom" } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${bredd}" w:type="dxa"/>${o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.vMerge ? `<w:vMerge${o.vMerge === "restart" ? ' w:val="restart"' : ""}/>` : ""}${o.fyll ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fyll}"/>` : ""}${o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : ""}</w:tcPr>${innehall || "<w:p/>"}</w:tc>`;
}

const RAM = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join("")}</w:tblBorders>`;

function tabell(bredder: number[], rader: string, marginal = 79) {
  const total = bredder.reduce((s, b) => s + b, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${RAM}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="23" w:type="dxa"/><w:left w:w="${marginal}" w:type="dxa"/><w:bottom w:w="23" w:type="dxa"/><w:right w:w="${marginal}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>
<w:tblGrid>${bredder.map((b) => `<w:gridCol w:w="${b}"/>`).join("")}</w:tblGrid>${rader}</w:tbl>`;
}

/** Fördelar textbredden enligt procentsatserna, så att summan blir exakt bredden. */
function fordela(bredd: number, procent: number[]) {
  const summa = procent.reduce((s, p) => s + p, 0) || 1;
  const ut = procent.map((p) => Math.floor((bredd * p) / summa));
  ut[ut.length - 1]! += bredd - ut.reduce((s, b) => s + b, 0);
  return ut;
}

function blockXml(b: Block, bredd: number): string {
  switch (b.typ) {
    case "rubrik": return para(run(b.text, { fet: true, storlek: 20, versaler: true }), { fore: Math.round(5 * MM), efter: Math.round(1.5 * MM), hallIhop: true });
    case "text": return para(run(b.text, { kursiv: b.kursiv }), { efter: Math.round(1.5 * MM) });
    case "sidbrytning": return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    case "form": {
      const [a, v] = fordela(bredd, [42, 58]);
      return tabell([a!, v!], b.rader.map(([e, t]) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(a!, para(run(e)), { fyll: "F2F2F2" })}${cell(v!, para(run(t)))}</w:tr>`).join(""));
    }
    case "tabell": {
      const br = fordela(bredd, b.bredder.length === b.kolumner.length ? b.bredder : b.kolumner.map(() => 1));
      const mitt = new Set(b.centrera ?? []);
      const huvud = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${b.kolumner.map((k, i) =>
        cell(br[i]!, para(run(k, { fet: true }), { jc: mitt.has(i) ? "center" : undefined }), { fyll: "BFBFBF" })).join("")}</w:tr>`;
      const rader = b.rader.map((r, n) => {
        if (typeof r === "string")
          return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(bredd, para(run(r, { fet: true }), { hallIhop: true }), { fyll: "E2E2E2", span: b.kolumner.length })}</w:tr>`;
        const fyll = n % 2 === 1 ? "F2F2F2" : undefined; // som utskriften: varannan rad grå
        return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${b.kolumner.map((_, i) =>
          cell(br[i]!, para(run(r[i] ?? ""), { jc: mitt.has(i) ? "center" : undefined }), { fyll })).join("")}</w:tr>`;
      }).join("");
      return tabell(br, huvud + rader);
    }
  }
}

/** Ritningshuvudet som tabell i sidhuvudet (upprepas på varje sida). */
function huvudXml(h: WordHuvud, bredd: number, logga: WordLogga | null) {
  const [bl, bm, bh1, bh2] = fordela(bredd, [24, 43, 18, 15]) as [number, number, number, number];
  let bild = "";
  if (logga) {
    const maxB = (bl - 160) / MM, maxH = 22;
    const skala = Math.min(maxB / logga.bredd, maxH / logga.hojd);
    const cx = Math.round(logga.bredd * skala * EMU_MM), cy = Math.round(logga.hojd * skala * EMU_MM);
    bild = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logga"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logga.${logga.typ}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdLogga"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  const liten = (t: string) => run(t, { storlek: 13 });
  const stor = (t: string) => run(t, { storlek: 22 });
  const info = (t: string) => run(t, { storlek: 17 });
  const rad = (vansterLogga: string, mitten: string, hoger: string, hojd = 255) =>
    `<w:tr><w:trPr><w:trHeight w:val="${hojd}"/></w:trPr>${vansterLogga}${mitten}${hoger}</w:tr>`;
  const loggaCell = (forsta: boolean) => cell(bl, forsta ? para(bild, { jc: "center" }) : "", { vMerge: forsta ? "restart" : "continue", vAlign: "center" });
  const dok = (forsta: boolean) => cell(bm, forsta ? para(liten("Dokumentnamn:")) + para(stor(h.titel)) : "", { vMerge: forsta ? "restart" : "continue" });
  const proj = (forsta: boolean) => cell(bm, forsta ? para(liten("Projekt:")) + para(stor(h.projektnamn)) + (h.projektrad ? para(liten(h.projektrad)) : "") : "", { vMerge: forsta ? "restart" : "continue" });
  const uppg = (e: string, v: string) => cell(bh1, para(info(e))) + cell(bh2, para(info(v)));
  const status = (forsta: boolean) => cell(bh1 + bh2, forsta ? para(run(h.status, { fet: true, storlek: 24, versaler: true }), { jc: "center" }) : "", { span: 2, vMerge: forsta ? "restart" : "continue", vAlign: "center" });
  const rader = [
    rad(loggaCell(true), dok(true), uppg("Handling:", h.handling)),
    rad(loggaCell(false), dok(false), uppg("Ansvarig:", h.ansvarig)),
    rad(loggaCell(false), dok(false), uppg("Datum:", h.datum)),
    rad(loggaCell(false), proj(true), uppg("Senast revidering:", h.revidering)),
    rad(loggaCell(false), proj(false), status(true), 300),
    rad(loggaCell(false), proj(false), status(false), 300),
  ].join("");
  return tabell([bl, bm, bh1, bh2], rader, 91) + `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round(4 * MM)}" w:lineRule="exact"/></w:pPr></w:p>`;
}

function fotXml(h: WordHuvud, bredd: number) {
  const falt = (kod: string) => `<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:instrText xml:space="preserve"> ${kod} </w:instrText></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
  return `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="5" w:space="2" w:color="000000"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${bredd}"/></w:tabs><w:spacing w:before="0" w:after="0"/></w:pPr>
${run(h.fotVanster, { storlek: 14 })}<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:tab/></w:r>${run(`${h.titel} · Blad `, { storlek: 14 })}${falt("PAGE")}${run("(", { storlek: 14 })}${falt("NUMPAGES")}${run(")", { storlek: 14 })}</w:p>`;
}

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

/** Bygger en Word-fil (.docx) av blocken. Ren funktion – loggan skickas in färdig som PNG/JPG. */
export function byggWord(d: { liggande?: boolean; block: Block[] }, h: WordHuvud, logga: WordLogga | null): Uint8Array {
  const [sidB, sidH] = d.liggande ? [16838, 11906] : [11906, 16838];
  const sidor = Math.round(12 * MM);
  const bredd = sidB - 2 * sidor;
  const kropp = d.block.map((b) => blockXml(b, bredd)).join("\n");

  const dokument = `${XML}<w:document ${NS}><w:body>${kropp}<w:p/>
<w:sectPr><w:headerReference w:type="default" r:id="rIdHuvud"/><w:footerReference w:type="default" r:id="rIdFot"/>
<w:pgSz w:w="${sidB}" w:h="${sidH}"${d.liggande ? ' w:orient="landscape"' : ""}/>
<w:pgMar w:top="${Math.round(42 * MM)}" w:right="${sidor}" w:bottom="${Math.round(18 * MM)}" w:left="${sidor}" w:header="${Math.round(10 * MM)}" w:footer="${Math.round(8 * MM)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const stilar = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="sv-SE"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  const installningar = `${XML}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="false"/><w:defaultTabStop w:val="709"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const huvud = `${XML}<w:hdr ${NS}>${huvudXml(h, bredd, logga)}</w:hdr>`;
  const fot = `${XML}<w:ftr ${NS}>${fotXml(h, bredd)}</w:ftr>`;

  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const typer = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rotRel = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const dokRel = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStilar" Type="${R}/styles" Target="styles.xml"/>
<Relationship Id="rIdInst" Type="${R}/settings" Target="settings.xml"/>
<Relationship Id="rIdHuvud" Type="${R}/header" Target="header1.xml"/>
<Relationship Id="rIdFot" Type="${R}/footer" Target="footer1.xml"/></Relationships>`;
  const huvudRel = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logga
    ? `<Relationship Id="rIdLogga" Type="${R}/image" Target="media/logga.${logga.typ}"/>` : ""}</Relationships>`;
  const nu = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(h.titel)}</dc:title><dc:creator>${x(h.foretag)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${nu}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nu}</dcterms:modified></cp:coreProperties>`;

  return zip([
    { namn: "[Content_Types].xml", data: typer },
    { namn: "_rels/.rels", data: rotRel },
    { namn: "docProps/core.xml", data: core },
    { namn: "word/document.xml", data: dokument },
    { namn: "word/styles.xml", data: stilar },
    { namn: "word/settings.xml", data: installningar },
    { namn: "word/header1.xml", data: huvud },
    { namn: "word/footer1.xml", data: fot },
    { namn: "word/_rels/document.xml.rels", data: dokRel },
    { namn: "word/_rels/header1.xml.rels", data: huvudRel },
    ...(logga ? [{ namn: `word/media/logga.${logga.typ}`, data: logga.data }] : []),
  ]);
}

/** Loggan som PNG (SVG ritas om till en bild i hög upplösning, eftersom Word inte kan visa SVG överallt). */
async function hamtaLogga(url: string): Promise<WordLogga | null> {
  try {
    const bild = new Image();
    bild.crossOrigin = "anonymous";
    await new Promise<void>((ok, fel) => { bild.onload = () => ok(); bild.onerror = () => fel(new Error("logga")); bild.src = url; });
    const b = bild.naturalWidth || 600, hh = bild.naturalHeight || 200;
    const skala = Math.min(4, 1200 / b) || 1;
    const duk = document.createElement("canvas");
    duk.width = Math.round(b * skala);
    duk.height = Math.round(hh * skala);
    const ctx = duk.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bild, 0, 0, duk.width, duk.height);
    // Tom kant runt loggan skärs bort, som på utskriften.
    const { data } = ctx.getImageData(0, 0, duk.width, duk.height);
    let x0 = duk.width, y0 = duk.height, x1 = -1, y1 = -1;
    for (let y = 0; y < duk.height; y++) for (let xx = 0; xx < duk.width; xx++) {
      const i = (y * duk.width + xx) * 4;
      const synlig = data[i + 3]! > 10 && !(data[i]! > 245 && data[i + 1]! > 245 && data[i + 2]! > 245);
      if (synlig) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const ut = document.createElement("canvas");
    if (x1 >= x0 && y1 >= y0) { ut.width = x1 - x0 + 1; ut.height = y1 - y0 + 1; ut.getContext("2d")!.drawImage(duk, x0, y0, ut.width, ut.height, 0, 0, ut.width, ut.height); }
    else { ut.width = duk.width; ut.height = duk.height; ut.getContext("2d")!.drawImage(duk, 0, 0); }
    const blob = await new Promise<Blob | null>((ok) => ut.toBlob(ok, "image/png"));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), typ: "png", bredd: ut.width, hojd: ut.height };
  } catch { return null; }
}

/** Skapar Word-filen i webbläsaren och laddar ner den. */
export async function laddaNerWord(d: BlockDokument, filnamn: string) {
  const h = huvudUppgifter(d);
  const logga = await hamtaLogga(h.loggaUrl);
  const data = byggWord(d, h, logga);
  const blob = new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn.replace(/[\\/:*?"<>|]+/g, "-").replace(/\.docx$/i, "") + ".docx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
