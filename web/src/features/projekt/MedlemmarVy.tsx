import { useEffect, useState } from "react";
import { api, skicka } from "../../lib/api";
import { ROLLER, rollNamn, type AnvandarInfo, type Medlem, type Rattigheter } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

type Props = { projektId: string; rattigheter: Rattigheter; visaMeddelande: (t: string) => void };

type Inbjudan = {
  id: string; epost: string; namn: string; roll: string; projekt: { id: string; namn: string }[];
  status: string; meddelande: string; skapad: string; skapadAv: string; accepterad: string | null;
};
type InbjudanSvar = { inbjudan: Inbjudan; skickad: boolean; meddelande: string };

export function MedlemmarVy({ projektId, rattigheter, visaMeddelande }: Props) {
  const [medlemmar, setMedlemmar] = useState<Medlem[] | null>(null);
  const [alla, setAlla] = useState<AnvandarInfo[]>([]);
  const [allaInbjudningar, setAllaInbjudningar] = useState<Inbjudan[]>([]);
  const [vald, setVald] = useState("");
  const [dialog, setDialog] = useState(false);
  const [ny, setNy] = useState({ epost: "", namn: "", roll: "Lasare" });
  const [skickar, setSkickar] = useState(false);
  const [svar, setSvar] = useState<InbjudanSvar | null>(null);
  const kanHantera = rattigheter.hanteraMedlemmar;
  // Admin får bjuda in alla roller utom Admin, projektledare bara Läsare och Tekniker.
  const roller = ROLLER.filter((r) => r.id !== "Admin" && (rattigheter.hanteraAnvandare || r.id === "Lasare" || r.id === "Tekniker"));

  const hamta = () => api<Medlem[]>(`/api/projekt/${projektId}/medlemmar`).then(setMedlemmar).catch((e) => visaMeddelande((e as Error).message));
  // Alla väntande inbjudningar (även i andra projekt), så att inbjudna personer kan läggas till här med ett klick.
  const hamtaInbjudningar = () => api<Inbjudan[]>("/api/inbjudningar")
    .then((l) => setAllaInbjudningar(l.filter((i) => i.status === "Vantar"))).catch(() => setAllaInbjudningar([]));
  const inbjudningar = allaInbjudningar.filter((i) => i.projekt.some((p) => p.id === projektId));
  useEffect(() => {
    void hamta();
    if (kanHantera) {
      api<AnvandarInfo[]>("/api/anvandare").then(setAlla).catch(() => setAlla([]));
      void hamtaInbjudningar();
    }
  }, [projektId, kanHantera]);

  const laggTill = async () => {
    if (!vald) return;
    try {
      if (vald.startsWith("inb:")) {
        await api(`/api/inbjudningar/${vald.slice(4)}/projekt/${projektId}`, { method: "POST" });
        setVald("");
        await hamtaInbjudningar();
        return;
      }
      await api(`/api/projekt/${projektId}/medlemmar`, { method: "POST", body: skicka({ anvandarId: vald }) });
      setVald("");
      await hamta();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const taBort = async (m: Medlem) => {
    try {
      await api(`/api/projekt/${projektId}/medlemmar/${encodeURIComponent(m.anvandarId)}`, { method: "DELETE" });
      await hamta();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const oppnaInbjudan = () => { setNy({ epost: "", namn: "", roll: "Lasare" }); setSvar(null); setDialog(true); };

  const bjudIn = async () => {
    setSkickar(true);
    try {
      const s = await api<InbjudanSvar>("/api/inbjudningar", {
        method: "POST", body: skicka({ epost: ny.epost, namn: ny.namn, roll: ny.roll, projektIds: [projektId] }),
      });
      setSvar(s);
      await Promise.all([hamta(), hamtaInbjudningar()]);
    } catch (e) { visaMeddelande((e as Error).message); }
    setSkickar(false);
  };

  const skickaIgen = async (i: Inbjudan) => {
    try {
      const s = await api<InbjudanSvar>(`/api/inbjudningar/${i.id}/skicka-igen`, { method: "POST" });
      visaMeddelande(s.skickad ? `Inbjudan till ${i.epost} skickades igen.` : s.meddelande);
      await hamtaInbjudningar();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const aterkalla = async (i: Inbjudan) => {
    try {
      await api(`/api/inbjudningar/${i.id}/projekt/${projektId}`, { method: "DELETE" });
      visaMeddelande(i.projekt.length > 1 ? `${i.epost} är borttagen från projektet (inbjudan gäller fortfarande ${i.projekt.length - 1} andra projekt).` : `Inbjudan till ${i.epost} är borttagen.`);
      await hamtaInbjudningar();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const ejMedlemmar = alla.filter((a) => !medlemmar?.some((m) => m.anvandarId === a.id));
  const andraInbjudna = allaInbjudningar.filter((i) => !i.projekt.some((p) => p.id === projektId));
  const kandaAdresser = [...new Set([...alla.map((a) => a.epost), ...allaInbjudningar.map((i) => i.epost)].filter(Boolean))].sort();
  const giltig = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(ny.epost.trim());

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <div className="rubrikrad">
        <h1>Medlemmar</h1>
        {kanHantera && <div className="knappar"><button className="knapp primar" onClick={oppnaInbjudan}>Bjud in extern deltagare</button></div>}
      </div>
      <p className="ingress">
        Tekniker och läsare ser bara projekt där de är medlemmar. Admin, projektledare och system ser alla projekt.
        Kollegor och tidigare inbjudna väljer du i listan nedan. Nya personer utanför HECO bjuder du in med e-postadressen:
        de får ett mejl från Microsoft och kommer in i sina projekt när de loggar in första gången.
      </p>
      {kanHantera && (
        <div className="filterrad">
          <select aria-label="Välj person" value={vald} onChange={(e) => setVald(e.target.value)}>
            <option value="">Välj person att lägga till…</option>
            {ejMedlemmar.length > 0 && (
              <optgroup label="Användare">
                {ejMedlemmar.map((a) => <option key={a.id} value={a.id}>{a.namn}{a.epost ? ` – ${a.epost}` : ""} ({rollNamn(a.roll)})</option>)}
              </optgroup>
            )}
            {andraInbjudna.length > 0 && (
              <optgroup label="Inbjudna som inte loggat in än">
                {andraInbjudna.map((i) => <option key={i.id} value={`inb:${i.id}`}>{i.namn ? `${i.namn} – ` : ""}{i.epost} ({rollNamn(i.roll)})</option>)}
              </optgroup>
            )}
          </select>
          <button className="knapp" disabled={!vald} onClick={laggTill}>Lägg till i projektet</button>
        </div>
      )}
      <section className="panel">
        {medlemmar === null ? <p className="dampad">Hämtar…</p> : medlemmar.length === 0 ? <p className="dampad">Inga medlemmar än.</p> : (
          <table className="enkel">
            <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th>Tillagd</th>{kanHantera && <th />}</tr></thead>
            <tbody>
              {medlemmar.map((m) => (
                <tr key={m.anvandarId}>
                  <td>{m.namn}</td>
                  <td className="mono">{m.epost}</td>
                  <td>{rollNamn(m.roll)}</td>
                  <td className="dampad">{new Date(m.tillagd).toLocaleDateString("sv-SE")} av {m.tillagdAv}</td>
                  {kanHantera && <td><button className="knapp fara" onClick={() => taBort(m)}>Ta bort</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {kanHantera && inbjudningar.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>Väntande inbjudningar</h2>
          <p className="dampad liten" style={{ margin: "0 0 8px" }}>Personerna kommer in i projektet automatiskt när de loggar in första gången.</p>
          <table className="enkel">
            <thead><tr><th>E-post</th><th>Namn</th><th>Roll</th><th>Inbjuden</th><th>Status från Microsoft</th><th /></tr></thead>
            <tbody>
              {inbjudningar.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.epost}</td>
                  <td>{i.namn}</td>
                  <td>{rollNamn(i.roll)}</td>
                  <td className="dampad">{new Date(i.skapad).toLocaleDateString("sv-SE")} av {i.skapadAv}</td>
                  <td className="dampad liten">{i.meddelande}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="knapp" onClick={() => void skickaIgen(i)}>Skicka igen</button>{" "}
                    <button className="knapp fara" onClick={() => void aterkalla(i)}>Ta bort</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Dialog
        titel="Bjud in extern deltagare" oppen={dialog} onStang={() => setDialog(false)}
        fot={svar ? <button className="knapp primar" onClick={() => setDialog(false)}>Klar</button> : <>
          <button className="knapp" onClick={() => setDialog(false)}>Avbryt</button>
          <button className="knapp primar" disabled={!giltig || skickar} onClick={() => void bjudIn()}>{skickar ? "Skickar…" : "Skicka inbjudan"}</button>
        </>}
      >
        {svar ? (
          <div className="inbjudan-svar">
            <p><b>{svar.skickad ? `Inbjudan skickad till ${svar.inbjudan.epost}.` : svar.inbjudan.status === "Accepterad" ? "Klart." : "Inbjudan är sparad, men inget mejl skickades."}</b></p>
            <p>{svar.meddelande}</p>
            {!svar.skickad && svar.inbjudan.status === "Vantar" && (
              <p className="dampad liten">
                Personen kommer ändå in i projektet med rätt roll när hen loggar in. Tills behörigheten i Microsoft är på plats kan en
                administratör bjuda in personen som gäst i Microsoft Entra (Användare → Bjud in extern användare), och sedan trycka Skicka igen här.
              </p>
            )}
          </div>
        ) : (
          <div className="kortformular">
            <label>E-postadress
              <input type="email" autoFocus value={ny.epost} placeholder="namn@foretaget.se" list="kanda-adresser"
                onChange={(e) => {
                  const v = e.target.value;
                  const kand = alla.find((a) => a.epost.toLowerCase() === v.trim().toLowerCase())?.namn
                    ?? allaInbjudningar.find((i) => i.epost === v.trim().toLowerCase())?.namn;
                  setNy({ ...ny, epost: v, namn: kand && !ny.namn ? kand : ny.namn });
                }} />
              <datalist id="kanda-adresser">{kandaAdresser.map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            <label>Namn
              <input type="text" value={ny.namn} placeholder="Förnamn Efternamn" onChange={(e) => setNy({ ...ny, namn: e.target.value })} />
            </label>
            <label>Roll
              <select value={ny.roll} onChange={(e) => setNy({ ...ny, roll: e.target.value })}>
                {roller.map((r) => <option key={r.id} value={r.id}>{r.namn}</option>)}
              </select>
            </label>
            <p className="dampad liten">
              Läsare kan se men inte ändra. Personen får ett mejl från Microsoft, accepterar och loggar in med sitt eget jobbkonto
              (har hen inte Microsoft 365 skickas en engångskod till e-posten). Inbjudan gäller det här projektet. Alla inbjudna sparas och finns sedan i listan Välj person i alla projekt.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
