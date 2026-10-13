import { useMemo, useState } from "react";
import { api, skicka } from "../../lib/api";
import type { Komponent } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

type Falt = { nyckel: keyof Komponent & string; rubrik: string };

type Props = {
  projektId: string;
  oppen: boolean;
  onStang: () => void;
  komponenter: Komponent[];
  falt: Falt[];
  onKlar: (antal: number) => void;
  visaMeddelande: (t: string) => void;
};

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sök och ersätt i komponenternas fält, med förhandsvisning av alla ändringar innan något sparas. */
export function SokErsattDialog({ projektId, oppen, onStang, komponenter, falt, onKlar, visaMeddelande }: Props) {
  const [sok, setSok] = useState("");
  const [ersatt, setErsatt] = useState("");
  const [vilket, setVilket] = useState("alla");
  const [versaler, setVersaler] = useState(false);
  const [helaCellen, setHelaCellen] = useState(false);
  const [arbetar, setArbetar] = useState<string | null>(null);

  const andringar = useMemo(() => {
    if (!sok) return [];
    const re = new RegExp(helaCellen ? `^${escRe(sok)}$` : escRe(sok), versaler ? "g" : "gi");
    const ut: { k: Komponent; f: Falt; fore: string; efter: string }[] = [];
    for (const k of komponenter)
      for (const f of falt) {
        if (vilket !== "alla" && f.nyckel !== vilket) continue;
        const fore = String(k[f.nyckel] ?? "");
        re.lastIndex = 0;
        if (!re.test(fore)) continue;
        re.lastIndex = 0;
        const efter = fore.replace(re, () => ersatt);
        if (efter !== fore) ut.push({ k, f, fore, efter });
      }
    return ut;
  }, [sok, ersatt, vilket, versaler, helaCellen, komponenter, falt]);

  const utfor = async () => {
    if (!andringar.length) return;
    if (!window.confirm(`Ersätta ${andringar.length} värden i ${new Set(andringar.map((a) => a.k.id)).size} komponenter? Ändringarna syns i ändringsloggen.`)) return;
    let klara = 0;
    const fel: string[] = [];
    // En komponent i taget (med senaste versionen), fälten i ordning.
    const perKomponent = new Map<string, typeof andringar>();
    andringar.forEach((a) => perKomponent.set(a.k.id, [...(perKomponent.get(a.k.id) ?? []), a]));
    for (const lista of perKomponent.values()) {
      let version = lista[0]!.k.version;
      for (const a of lista) {
        setArbetar(`Ersätter ${klara + 1} av ${andringar.length}…`);
        try {
          const ny = await api<Komponent>(`/api/projekt/${projektId}/komponenter/${a.k.id}`, {
            method: "PATCH", body: skicka({ falt: a.f.nyckel, varde: a.efter, version }),
          });
          version = ny.version;
          klara++;
        } catch (e) { fel.push(`${a.k.beteckning} (${a.f.rubrik}): ${(e as Error).message}`); }
      }
    }
    setArbetar(null);
    onKlar(klara);
    if (fel.length) window.alert(`${fel.length} värden kunde inte ändras:\n\n${fel.slice(0, 15).join("\n")}`);
    else { visaMeddelande(`${klara} värden ersatta.`); onStang(); }
  };

  return (
    <Dialog
      titel="Sök och ersätt i komponenter" oppen={oppen} bred onStang={() => { if (!arbetar) onStang(); }}
      fot={<>
        <span className="dampad">{arbetar ?? (sok ? `${andringar.length} träffar` : "")}</span>
        <button className="knapp" disabled={!!arbetar} onClick={onStang}>Stäng</button>
        <button className="knapp primar" disabled={!!arbetar || !andringar.length} onClick={() => void utfor()}>Ersätt {andringar.length || ""}</button>
      </>}
    >
      <div className="faltrad">
        <label>Sök efter <input type="text" value={sok} autoFocus onChange={(e) => setSok(e.target.value)} placeholder="t.ex. LB01_" /></label>
        <label>Ersätt med <input type="text" value={ersatt} onChange={(e) => setErsatt(e.target.value)} placeholder="t.ex. LB02_ (tomt tar bort texten)" /></label>
        <label>I fält
          <select value={vilket} onChange={(e) => setVilket(e.target.value)}>
            <option value="alla">Alla fält</option>
            {falt.map((f) => <option key={f.nyckel} value={f.nyckel}>{f.rubrik}</option>)}
          </select>
        </label>
      </div>
      <div className="faltrad">
        <label className="radio"><input type="checkbox" checked={versaler} onChange={(e) => setVersaler(e.target.checked)} /> Skilj på stora och små bokstäver</label>
        <label className="radio"><input type="checkbox" checked={helaCellen} onChange={(e) => setHelaCellen(e.target.checked)} /> Bara när hela fältet matchar</label>
      </div>
      {sok && (andringar.length === 0
        ? <p className="dampad">Inga träffar.</p>
        : (
          <div className="sokersatt-lista">
            <table className="formtabell">
              <thead><tr><th>Komponent</th><th>Fält</th><th>Före</th><th>Efter</th></tr></thead>
              <tbody>
                {andringar.slice(0, 200).map((a) => (
                  <tr key={a.k.id + a.f.nyckel}>
                    <td className="mono">{a.k.beteckning}</td><td>{a.f.rubrik}</td>
                    <td className="mono dampad">{a.fore}</td><td className="mono">{a.efter || <i className="dampad">(tomt)</i>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {andringar.length > 200 && <p className="dampad liten">… och {andringar.length - 200} till.</p>}
          </div>
        ))}
    </Dialog>
  );
}
