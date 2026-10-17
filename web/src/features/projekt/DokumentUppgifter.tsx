import { useEffect, useRef, useState } from "react";
import { api, skicka } from "../../lib/api";
import { STANDARD_UPPGIFTER, sattDokumentUppgifter, type DokUppgifter } from "../../lib/dokumenttema";
import type { Projekt, ProjektDokument } from "../../lib/typer";
import { STATUSAR, hamtaLoggor, hamtaSidfot, lasBild, type Logga, type Sidfot } from "../ritning/DriftkortSidfot";

const TYP = "dokumenthuvud";

/**
 * Skär bort tom kant (vit eller genomskinlig) runt en PNG/JPG-logga, så att själva loggan fyller rutan på utskrifterna.
 * SVG lämnas som den är. Returnerar ny base64 (PNG) eller den gamla om inget behövde skäras bort.
 */
async function beskar(data: string, typ: string): Promise<{ data: string; typ: string }> {
  if (!/png|jpe?g/i.test(typ)) return { data, typ };
  const bild = await new Promise<HTMLImageElement>((ok, fel) => {
    const im = new Image(); im.onload = () => ok(im); im.onerror = () => fel(new Error("Bilden kunde inte läsas."));
    im.src = `data:${typ};base64,${data}`;
  });
  const b = bild.naturalWidth, h = bild.naturalHeight;
  if (!b || !h || b * h > 25_000_000) return { data, typ };
  const c = document.createElement("canvas"); c.width = b; c.height = h;
  const ctx = c.getContext("2d"); if (!ctx) return { data, typ };
  ctx.drawImage(bild, 0, 0);
  const px = ctx.getImageData(0, 0, b, h).data;
  let x0 = b, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4;
    const tom = px[i + 3]! < 16 || (px[i]! > 240 && px[i + 1]! > 240 && px[i + 2]! > 240);
    if (tom) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { data, typ };
  const marg = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  x0 = Math.max(0, x0 - marg); y0 = Math.max(0, y0 - marg); x1 = Math.min(b - 1, x1 + marg); y1 = Math.min(h - 1, y1 + marg);
  const nb = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nb >= b - 2 && nh >= h - 2) return { data, typ };
  const u = document.createElement("canvas"); u.width = nb; u.height = nh;
  u.getContext("2d")!.drawImage(c, x0, y0, nb, nh, 0, 0, nb, nh);
  const url = u.toDataURL("image/png");
  return { data: url.slice(url.indexOf(",") + 1), typ: "image/png" };
}
const tom: DokUppgifter = { foretag: "", adress: "", postadress: "", epost: "", telefon: "", orgnr: "", ansvarig: "", revidering: "", loggaNamn: "", loggaTyp: "", loggaData: "" };

/** Läser projektets dokumentuppgifter och lägger dem i utskriftstemat. */
export async function laddaDokumentUppgifter(projektId: string, projekt: Projekt | null) {
  const [lista, sf] = await Promise.all([
    api<ProjektDokument[]>(`/api/projekt/${projektId}/dokument?typ=${TYP}`),
    hamtaSidfot(projektId).catch(() => null),
  ]);
  let u: Partial<DokUppgifter> = {};
  try { if (lista[0]?.data) u = JSON.parse(lista[0].data) as Partial<DokUppgifter>; } catch { /* trasig data */ }
  sattDokumentUppgifter({ projekt, uppgifter: u, status: sf?.sidfot.status ?? "", datum: sf?.sidfot.datum ?? "" });
  return { dok: lista[0] ?? null, uppgifter: { ...tom, ...u }, sidfot: sf };
}

type Props = { projektId: string; projekt: Projekt | null; lasläge: boolean; uppdaterad: number; visaMeddelande: (t: string) => void };

/**
 * Projektinformation: uppgifter som står i huvud och fot på alla utskrifter (utom driftkort och funktionstexter).
 * Handlingsstatus och datum delas med driftkortens sidfot. Tomt företagsfält = HECO:s uppgifter.
 */
export function DokumentUppgifter({ projektId, projekt, lasläge, uppdaterad, visaMeddelande }: Props) {
  const [u, setU] = useState<DokUppgifter>(tom);
  const [sf, setSf] = useState<{ dok: ProjektDokument | null; sidfot: Sidfot } | null>(null);
  const dok = useRef<ProjektDokument | null>(null);
  const [status, setStatus] = useState<"" | "osparat" | "sparar">("");
  const timer = useRef<number | undefined>(undefined);
  const ny = useRef<{ u: DokUppgifter; sf: Sidfot | null } | null>(null);
  const [bibliotek, setBibliotek] = useState<Logga[]>([]);
  useEffect(() => { hamtaLoggor().then((l) => setBibliotek(l.lista)).catch(() => setBibliotek([])); }, []);

  const valjFil = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(png|jpe?g|svg)$/i.test(f.name)) { visaMeddelande("Välj en PNG-, JPG- eller SVG-bild."); return; }
    if (f.size > 1024 * 1024) { visaMeddelande("Loggan får vara högst 1 MB."); return; }
    try {
      const l = await lasBild(f);
      const k = await beskar(l.data, f.type || l.typ);
      andra({ ...u, loggaNamn: l.namn, loggaTyp: k.typ, loggaData: k.data }, null);
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  useEffect(() => {
    if (status) return;
    laddaDokumentUppgifter(projektId, projekt).then((r) => { dok.current = r.dok; setU(r.uppgifter); setSf(r.sidfot); })
      .catch((e) => visaMeddelande(`Dokumentuppgifterna kunde inte hämtas: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projektId, uppdaterad]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const spara = async () => {
    const n = ny.current; if (!n) return;
    ny.current = null;
    setStatus("sparar");
    try {
      const data = JSON.stringify(n.u);
      dok.current = dok.current
        ? await api<ProjektDokument>(`/api/projekt/${projektId}/dokument/${dok.current.id}`, { method: "PUT", body: skicka({ data, version: dok.current.version }) })
        : await api<ProjektDokument>(`/api/projekt/${projektId}/dokument`, { method: "POST", body: skicka({ typ: TYP, namn: "Dokumentuppgifter", data }) });
      if (n.sf && sf) {
        const sd = JSON.stringify(n.sf);
        const d = sf.dok
          ? await api<ProjektDokument>(`/api/projekt/${projektId}/dokument/${sf.dok.id}`, { method: "PUT", body: skicka({ data: sd, version: sf.dok.version }) })
          : await api<ProjektDokument>(`/api/projekt/${projektId}/dokument`, { method: "POST", body: skicka({ typ: "driftkortsidfot", namn: "Sidfot för driftkort", data: sd }) });
        setSf({ dok: d, sidfot: n.sf });
      }
      sattDokumentUppgifter({ projekt, uppgifter: n.u, status: n.sf?.status ?? sf?.sidfot.status ?? "", datum: n.sf?.datum ?? sf?.sidfot.datum ?? "" });
      setStatus("");
    } catch (e) {
      setStatus("");
      visaMeddelande(`Kunde inte spara dokumentuppgifterna: ${(e as Error).message}. Uppdatera sidan och försök igen.`);
    }
  };

  const andra = (nu: DokUppgifter, nySf: Sidfot | null) => {
    setU(nu);
    if (nySf && sf) setSf({ ...sf, sidfot: nySf });
    ny.current = { u: nu, sf: nySf ?? ny.current?.sf ?? null };
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void spara(), 900);
  };

  const falt = (k: keyof DokUppgifter, etikett: string, typ = "text") => (
    <label className="riskfalt" key={k}>
      <span>{etikett}</span>
      <input type={typ} value={u[k]} readOnly={lasläge} placeholder={STANDARD_UPPGIFTER[k] || undefined}
        onChange={(e) => andra({ ...u, [k]: e.target.value }, null)} />
    </label>
  );
  const s = sf?.sidfot;

  return (
    <section className="panel dokumentuppgifter">
      <h2>Uppgifter på utskrifter <span className="dampad liten">{status === "sparar" ? "Sparar…" : status === "osparat" ? "Osparade ändringar" : ""}</span></h2>
      <p className="dampad liten">
        Står i huvudet och foten på alla utskrifter och PDF:er (utom driftkort och funktionstexter). Tomma företagsfält ger HECO:s uppgifter (grå text).
        Handling och datum är samma som i driftkortens sidfot.
      </p>
      <div className="riskhuvud">
        <label className="riskfalt">
          <span>Handling</span>
          <select value={s?.status ?? ""} disabled={lasläge || !s} onChange={(e) => s && andra(u, { ...s, status: e.target.value })}>
            <option value="">(ingen)</option>
            {[...new Set([...STATUSAR, s?.status ?? ""])].filter(Boolean).map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="riskfalt">
          <span>Datum</span>
          <input type="date" value={s?.datum ?? ""} readOnly={lasläge || !s} onChange={(e) => s && andra(u, { ...s, datum: e.target.value })} />
        </label>
        {falt("ansvarig", "Ansvarig (signatur)")}
        {falt("revidering", "Senast revidering", "date")}
      </div>
      <div className="projektlogga">
        <div className="loggaruta" title={u.loggaData ? u.loggaNamn : "HECO-loggan (standard)"}>
          <img alt="Logga på utskrifter" src={u.loggaData ? `data:${u.loggaTyp || "image/png"};base64,${u.loggaData}` : "/logga/heco-logga-svart.svg"} />
        </div>
        <div className="loggaval">
          <span className="falt-etikett">Logga på utskrifter{u.loggaData ? `: ${u.loggaNamn}` : " (HECO, standard)"}</span>
          {!lasläge && (
            <div className="knappgrupp">
              <label className="knapp">Ladda upp logga…
                <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" hidden onChange={(e) => { void valjFil(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {bibliotek.length > 0 && (
                <select aria-label="Välj ur loggbiblioteket" value="" onChange={(e) => {
                  const l = bibliotek.find((x) => x.id === e.target.value);
                  if (l) void beskar(l.data, l.typ).then((k) => andra({ ...u, loggaNamn: l.namn, loggaTyp: k.typ, loggaData: k.data }, null)).catch(() => andra({ ...u, loggaNamn: l.namn, loggaTyp: l.typ, loggaData: l.data }, null));
                }}>
                  <option value="">Välj ur loggbiblioteket…</option>
                  {bibliotek.map((l) => <option key={l.id} value={l.id}>{l.namn}</option>)}
                </select>
              )}
              {u.loggaData && <button type="button" className="knapp" onClick={() => andra({ ...u, loggaNamn: "", loggaTyp: "", loggaData: "" }, null)}>Använd HECO-loggan</button>}
            </div>
          )}
          <span className="dampad liten">Står i huvudet på alla utskrifter och PDF:er i projektet. PNG, JPG eller SVG, högst 1 MB.</span>
        </div>
      </div>
      <div className="riskhuvud">
        {falt("foretag", "Företag")}
        {falt("adress", "Adress")}
        {falt("postadress", "Postnummer och ort")}
        {falt("telefon", "Telefon")}
        {falt("epost", "E-post")}
        {falt("orgnr", "Organisationsnummer")}
      </div>
    </section>
  );
}
