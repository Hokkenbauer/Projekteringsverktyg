import { useEffect, useMemo, useState } from "react";
import { api, skicka } from "../../lib/api";
import { Dialog } from "../../shell/Dialog";

export type KomponentMall = { id: string; namn: string; rader: Record<string, string>[]; andrad: string; andradAv: string };

type Props = {
  projektId: string;
  oppen: boolean;
  onStang: () => void;
  kanHanteraMallar: boolean;
  onKlar: (antal: number) => void;
  visaMeddelande: (t: string) => void;
};

const KOLUMNER: [string, string][] = [
  ["beteckning", "Beteckning"], ["system", "System"], ["komponenttyp", "Komponenttyp"], ["signaltyp", "Signal"],
  ["beskrivning", "Beskrivning"], ["anslutsTill", "Ansluts till"], ["ovrigt", "Övrigt"],
];

/** Lägg till komponenter från en mall. "xx" i mallen byts mot det nummer man anger, t.ex. LBxx → LB01. */
export function KomponentMallDialog({ projektId, oppen, onStang, kanHanteraMallar, onKlar, visaMeddelande }: Props) {
  const [mallar, setMallar] = useState<KomponentMall[] | null>(null);
  const [vald, setVald] = useState<string>("");
  const [sok, setSok] = useState("");
  const [xx, setXx] = useState("");
  const [arbetar, setArbetar] = useState(false);

  const hamta = () => api<KomponentMall[]>("/api/komponentmallar").then((m) => { setMallar(m); setVald((v) => v || m[0]?.id || ""); })
    .catch((e) => visaMeddelande((e as Error).message));
  useEffect(() => { if (oppen) void hamta(); }, [oppen]);

  const mall = mallar?.find((m) => m.id === vald);
  const synliga = (mallar ?? []).filter((m) => m.namn.toLowerCase().includes(sok.toLowerCase()));
  const harXx = useMemo(() => !!mall?.rader.some((r) => Object.values(r).some((v) => /xx/i.test(v))), [mall]);
  const visa = (v: string | undefined) => (xx.trim() ? (v ?? "").replace(/xx/gi, xx.trim()) : v ?? "");

  const laggTill = async () => {
    if (!mall) return;
    setArbetar(true);
    try {
      const svar = await api<{ antal: number }>(`/api/projekt/${projektId}/komponenter/fran-mall`, {
        method: "POST", body: skicka({ mallId: mall.id, ersattXx: xx.trim() || null }),
      });
      onKlar(svar.antal);
      onStang();
    } catch (e) {
      visaMeddelande(`Mallen kunde inte läggas till: ${(e as Error).message}`);
    } finally {
      setArbetar(false);
    }
  };

  const taBort = async () => {
    if (!mall || !window.confirm(`Ta bort mallen ${mall.namn}? Den försvinner för alla projekt.`)) return;
    try {
      await api(`/api/komponentmallar/${mall.id}`, { method: "DELETE" });
      setVald("");
      await hamta();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  return (
    <Dialog
      titel="Lägg till komponenter från mall" oppen={oppen} onStang={onStang} bred
      fot={<>
        <span className="dampad">{mall ? `${mall.rader.length} komponenter läggs till` : ""}</span>
        {kanHanteraMallar && mall && <button className="knapp fara" onClick={taBort}>Ta bort mallen</button>}
        <button className="knapp" onClick={onStang}>Avbryt</button>
        <button className="knapp primar" disabled={!mall || arbetar || (harXx && !xx.trim())} onClick={laggTill}>
          {arbetar ? "Lägger till…" : "Lägg till"}
        </button>
      </>}
    >
      <div className="mallyta">
        <div>
          <input className="sok" type="search" placeholder="Sök mall" value={sok} onChange={(e) => setSok(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <div className="malllista">
            {mallar === null && <span className="dampad">Hämtar…</span>}
            {synliga.map((m) => (
              <button key={m.id} className={m.id === vald ? "aktiv" : ""} onClick={() => setVald(m.id)}>
                {m.namn}<small>{m.rader.length}</small>
              </button>
            ))}
            {mallar && synliga.length === 0 && <span className="dampad">Inga mallar.</span>}
          </div>
        </div>
        <div>
          {mall && (
            <>
              <div className="faltrad">
                {harXx && (
                  <label>Ersätt <b>xx</b> med
                    <input type="text" value={xx} onChange={(e) => setXx(e.target.value)} placeholder="t.ex. 01" size={6} autoFocus />
                  </label>
                )}
                <span className="dampad">Sparad av {mall.andradAv}</span>
              </div>
              <div className="forhands">
                <table className="enkel tat">
                  <thead><tr>{KOLUMNER.map(([, r]) => <th key={r}>{r}</th>)}</tr></thead>
                  <tbody>
                    {mall.rader.map((r, i) => (
                      <tr key={i}>{KOLUMNER.map(([k]) => <td key={k} className={k === "beteckning" || k === "anslutsTill" ? "mono" : undefined}>{visa(r[k])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
