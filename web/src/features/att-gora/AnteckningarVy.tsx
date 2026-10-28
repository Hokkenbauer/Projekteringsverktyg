import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFordrojdSparning } from "../../lib/sparning";
import type { Anteckningar } from "../../lib/typer";

type Props = {
  anteckningar: Anteckningar | null;
  onSpara: (text: string) => Promise<void>;
  lasläge?: boolean;
  grupp?: string;
  rubrik?: string;
  ingress?: string;
  onSkrivUt?: (text: string) => void;
  onPopUt?: () => void;
  /** Bryt långa rader automatiskt. Att göra-anteckningarna bryts inte (rullas i sidled i stället). */
  radbryt?: boolean;
  /** Innehåll mellan ingressen och textfältet (t.ex. uppgifter på utskrifter i Projektinformation). */
  fore?: ReactNode;
};

const tid = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "";

/** Fritt textfält, ungefär som Notepad++. Sparas automatiskt en stund efter att man slutat skriva. */
export function AnteckningarVy({
  anteckningar, onSpara, lasläge = false, grupp = "Att göra", rubrik = "Anteckningar",
  ingress = "Fritt textfält för projektet. Texten sparas automatiskt medan du skriver.", onSkrivUt, onPopUt,
  radbryt = grupp !== "Att göra", fore,
}: Props) {
  const [text, setText] = useState(anteckningar?.text ?? "");
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar" | "fel">("sparat");
  const senastSparat = useRef(anteckningar?.text ?? "");
  const sparning = useFordrojdSparning();

  // Ändringar från andra slår igenom så länge man inte själv har osparad text.
  useEffect(() => {
    const ny = anteckningar?.text ?? "";
    if (status === "sparat" && ny !== text) {
      setText(ny);
      senastSparat.current = ny;
    }
  }, [anteckningar?.text]);

  const spara = async (varde: string) => {
    setStatus("sparar");
    try {
      await onSpara(varde);
      senastSparat.current = varde;
      setStatus((s) => (s === "sparar" ? "sparat" : s));
    } catch {
      setStatus("fel");
    }
  };

  const andra = (varde: string) => {
    setText(varde);
    setStatus("osparat");
    sparning.planera(() => spara(varde), 1200);
  };

  // Det som inte hunnit sparas när vyn stängs (t.ex. byte av flik i pop-ut-fönstret) sparas av useFordrojdSparning.

  return (
    <>
      <div className="brodsmula">{grupp}</div>
      <div className="rubrikrad">
        <h1>{rubrik}</h1>
        <div className="knappar">
          {onPopUt && <button className="knapp" onClick={onPopUt} title="Öppna Att göra och Anteckningar i ett eget fönster som följer med mellan flikarna">⧉ Pop-ut</button>}
          {onSkrivUt && <button className="knapp" onClick={() => onSkrivUt(text)}>Skriv ut / PDF</button>}
        </div>
      </div>
      <p className="ingress">{ingress}</p>
      {fore}
      <textarea
        className={`anteckningar${radbryt ? "" : " utan-radbryt"}`}
        wrap={radbryt ? "soft" : "off"}
        aria-label={rubrik}
        spellCheck
        readOnly={lasläge}
        value={text}
        onChange={(e) => andra(e.target.value)}
        onBlur={() => { if (status === "osparat") void sparning.nu(); }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = t;
            const ny = text.slice(0, a) + "\t" + text.slice(b);
            andra(ny);
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 1; });
          }
        }}
      />
      <p className="sparstatus" role="status">
        {status === "sparar" && "Sparar…"}
        {status === "osparat" && "Osparade ändringar"}
        {status === "fel" && "Kunde inte spara. Försöker igen när du skriver."}
        {status === "sparat" && anteckningar?.andrad && `Sparat ${tid(anteckningar.andrad)} av ${anteckningar.andradAv}`}
      </p>
    </>
  );
}
