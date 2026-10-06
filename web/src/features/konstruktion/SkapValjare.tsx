import { api, skicka } from "../../lib/api";
import type { Skap } from "../../lib/typer";

type Props = {
  projektId: string;
  skap: Skap[] | null;
  valtId: string | null;
  onVal: (id: string | null) => void;
  /** Hämtar om skåplistan efter en ändring. */
  onUppdatera: () => Promise<Skap[]>;
  lasläge: boolean;
  visaMeddelande: (t: string) => void;
};

/** Väljer apparatskåp. Samma skåp och samma val gäller i Apparatskåp, Kraftberäkning och Modulbeläggning. */
export function SkapValjare({ projektId, skap, valtId, onVal, onUppdatera, lasläge, visaMeddelande }: Props) {
  const valt = skap?.find((s) => s.id === valtId);

  const nytt = async () => {
    const namn = window.prompt("Namn på det nya skåpet:", `AS${String((skap?.length ?? 0) + 1).padStart(2, "0")}`);
    if (namn === null) return;
    try {
      const s = await api<Skap>(`/api/projekt/${projektId}/skap`, { method: "POST", body: skicka({ namn }) });
      await onUppdatera();
      onVal(s.id);
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const bytNamn = async () => {
    if (!valt) return;
    const namn = window.prompt("Nytt namn på skåpet:", valt.namn);
    if (!namn?.trim()) return;
    try {
      await api(`/api/projekt/${projektId}/skap/${valt.id}`, {
        method: "PUT",
        body: skicka({ namn, beteckning: valt.beteckning, placering: valt.placering, beskrivning: valt.beskrivning, data: valt.data, version: valt.version }),
      });
      await onUppdatera();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const taBort = async () => {
    if (!valt) return;
    if (!window.confirm(`Ta bort apparatskåpet ${valt.namn}?\n\nDet tar bort skåpet i Apparatskåp, Kraftberäkning och Modulbeläggning. Det går inte att ångra.`)) return;
    try {
      await api(`/api/projekt/${projektId}/skap/${valt.id}`, { method: "DELETE" });
      const lista = await onUppdatera();
      onVal(lista[0]?.id ?? null);
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  return (
    <div className="skapvaljare">
      <label>Apparatskåp
        <select value={valtId ?? ""} onChange={(e) => onVal(e.target.value || null)} disabled={!skap?.length}>
          {!skap?.length && <option value="">Inga skåp än</option>}
          {skap?.map((s) => <option key={s.id} value={s.id}>{s.namn}{s.beteckning && s.beteckning !== s.namn ? ` (${s.beteckning})` : ""}</option>)}
        </select>
      </label>
      {!lasläge && <button className="knapp primar" onClick={() => void nytt()}>+ Nytt skåp</button>}
      {!lasläge && valt && <button className="knapp" onClick={() => void bytNamn()}>Byt namn</button>}
      {!lasläge && valt && <button className="knapp fara" onClick={() => void taBort()}>Ta bort skåp</button>}
    </div>
  );
}
