import { useEffect, useRef, useState } from "react";
import type { Anteckningar } from "../../lib/typer";

type Props = {
  anteckningar: Anteckningar | null;
  onSpara: (text: string) => Promise<void>;
  lasläge?: boolean;
};

const tid = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "";

/** Fritt textfält, ungefär som Notepad++. Sparas automatiskt en stund efter att man slutat skriva. */
export function AnteckningarVy({ anteckningar, onSpara, lasläge = false }: Props) {
  const [text, setText] = useState(anteckningar?.text ?? "");
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar" | "fel">("sparat");
  const senastSparat = useRef(anteckningar?.text ?? "");
  const timer = useRef<number | undefined>(undefined);

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
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void spara(varde), 1200);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <div className="brodsmula">Att göra</div>
      <h1>Anteckningar</h1>
      <p className="ingress">Fritt textfält för projektet. Texten sparas automatiskt medan du skriver.</p>
      <textarea
        className="anteckningar"
        aria-label="Anteckningar"
        spellCheck
        readOnly={lasläge}
        value={text}
        onChange={(e) => andra(e.target.value)}
        onBlur={() => { if (status === "osparat") { window.clearTimeout(timer.current); void spara(text); } }}
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
