using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.ListApi;

/// <summary>
/// En kolumn i en lista.
/// Typ: text, val (lista med alternativ), kryss, datum, komponent (läses från komponenten, ändras inte här),
/// lopnr (löpnummer räknat från ordningen).
/// </summary>
public sealed record KolumnDef(
    string Nyckel,
    string Rubrik,
    string Typ = "text",
    string[]? Val = null,
    string? KomponentFalt = null,
    string? Standard = null,
    bool Mono = false,
    int? Bredd = null,
    /// <summary>För kryss: fält som får dagens datum när rutan bockas i.</summary>
    string? SatterDatum = null,
    /// <summary>För kryss: fält som får användarens signatur när rutan bockas i.</summary>
    string? SatterSign = null,
    /// <summary>Kolumnen tar allt utrymme som blir över (t.ex. Anmärkning).</summary>
    bool Fyll = false,
    /// <summary>För typ produkt: kolumnerna som multipliceras (t.ex. sannolikhet × konsekvens).</summary>
    string[]? Faktorer = null)
{
    public bool Redigerbar => Typ is "text" or "val" or "kryss" or "datum";

    /// <summary>Räknat värde för typ produkt; tomt om någon faktor saknas eller inte är ett tal.</summary>
    public string Berakna(IReadOnlyDictionary<string, string> data)
    {
        if (Typ != "produkt" || Faktorer is null) return "";
        var resultat = 1m;
        foreach (var f in Faktorer)
        {
            if (!decimal.TryParse(data.GetValueOrDefault(f, "").Replace(',', '.'), System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture, out var v)) return "";
            resultat *= v;
        }
        return resultat.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// Beskrivning av en lista. Kopplad = en rad per komponent i Komponenter (eventuellt filtrerat på komponenttyp).
/// </summary>
public sealed record ListDef(
    string Id,
    string Namn,
    string Grupp,
    string Ingress,
    bool Kopplad,
    IReadOnlyList<KolumnDef> Kolumner,
    string[]? KomponenttypInnehaller = null,
    string[]? ExportKolumner = null,
    /// <summary>Visa och exportera komponentens fält med - i stället för _ (skyltar).</summary>
    bool Bindestreck = false)
{
    public KolumnDef? Kolumn(string nyckel) => Kolumner.FirstOrDefault(k => k.Nyckel == nyckel);
}

public static class Listdefinitioner
{
    private static string[] Kat(string namn) => Grundkataloger.Hamta(namn);

    private static ListDef Risk(string id, string namn, string ingress) => new(id, namn, "Projektering", ingress,
        Kopplad: false,
        Kolumner:
        [
            new("pos", "Pos.", "lopnr"),
            new("arbetsmoment", "Arbetsmoment", Bredd: 180),
            new("risk", "Risk (förklaring)", Bredd: 320, Fyll: true),
            new("sannolikhet", "Sannolikhet", "val", ["1", "2", "3"], Bredd: 90),
            new("konsekvens", "Konsekvens", "val", ["1", "2", "3"], Bredd: 90),
            new("riskvarde", "Riskvärde", "produkt", Mono: true, Bredd: 96, Faktorer: ["sannolikhet", "konsekvens"]),
            new("atgard", "Åtgärd", Bredd: 260),
            new("ansvarig", "Ansvarig", "val", Kat("RiskbedomningAnsvarig")),
        ]);

    private static KolumnDef K(string falt, string rubrik, bool mono = false, int? bredd = null) =>
        new(falt, rubrik, "komponent", KomponentFalt: falt, Mono: mono, Bredd: bredd);

    public static readonly IReadOnlyList<ListDef> Alla =
    [
        // ---------------- Komponenter & Listor (kopplade till komponenterna) ----------------
        new("skyltlista", "Skyltlista", "Komponenter & Listor",
            "En skylt per komponent. Komponentnamn, typ och var den är ansluten hämtas från Komponenter. Exporten innehåller de tre skyltraderna.",
            Kopplad: true,
            Kolumner:
            [
                K("beteckning", "Komponentnamn", mono: true),
                K("komponenttyp", "Komponenttyp"),
                K("anslutsTill", "Ansluten från", mono: true),
                new("textfarg", "Textfärg", "val", Kat("SkyltlistaTextfarg"), Standard: "Svart"),
                new("skyltfarg", "Skyltfärg", "val", Kat("SkyltlistaSkyltfarg"), Standard: "Vit"),
                new("montage", "Montage", "val", Kat("SkyltlistaMontage"), Standard: "2 hål + tejp"),
                new("ovrigt", "Övrigt"),
            ],
            ExportKolumner: ["beteckning", "komponenttyp", "anslutsTill"],
            Bindestreck: true),

        new("installationslista", "Installationslista", "Komponenter & Listor",
            "Kabel och installationsstatus per komponent. Bocka i Utdragen, Ansluten och Märkning så fylls datum och signatur i.",
            Kopplad: true,
            Kolumner:
            [
                K("beteckning", "Beteckning", mono: true),
                K("beskrivning", "Beskrivning", bredd: 180),
                K("signaltyp", "Signaltyp"),
                K("kabeltyp", "Kabeltyp"),
                new("langd", "Längd (m)", Mono: true),
                K("anslutsTill", "Från", mono: true),
                K("komponenttyp", "Till"),
                K("placering", "Placering"),
                new("information", "Övrig information", Bredd: 180),
                new("utdragen", "Utdragen", "kryss", SatterDatum: "utdragenDatum", SatterSign: "utdragenSign"),
                new("utdragenDatum", "Datum", "datum"),
                new("utdragenSign", "Sign.", Mono: true, Bredd: 52),
                new("ansluten", "Ansluten", "kryss", SatterDatum: "anslutenDatum", SatterSign: "anslutenSign"),
                new("anslutenDatum", "Datum", "datum"),
                new("anslutenSign", "Sign.", Mono: true, Bredd: 52),
                new("markning", "Märkning", "kryss", SatterDatum: "markningDatum", SatterSign: "markningSign"),
                new("markningDatum", "Datum", "datum"),
                new("markningSign", "Sign.", Mono: true, Bredd: 52),
            ]),

        new("signallista", "Signallista (I/O)", "Komponenter & Listor",
            "Summeras från Komponenter. Ändra signaltyp och anslutning i Komponenter.",
            Kopplad: true,
            Kolumner:
            [
                K("beteckning", "Beteckning", mono: true),
                K("komponenttyp", "Komponenttyp"),
                K("signaltyp", "Signaltyp"),
                K("anslutsTill", "Ansluts till", mono: true),
                K("beskrivning", "Beskrivning", bredd: 220),
            ]),

        new("brandspjall", "Brandspjällstabell", "Komponenter & Listor",
            "Visar komponenter vars komponenttyp innehåller \"spjäll\" och \"brand\". Uppgifterna hör till komponenten.",
            Kopplad: true,
            KomponenttypInnehaller: ["brand"],
            Kolumner:
            [
                K("beteckning", "Beteckning", mono: true),
                K("placering", "Placering"),
                new("betjanar", "Betjänar"),
                new("lufttyp", "Lufttyp", "val", Kat("BrandspjallLufttyp")),
                new("funktion", "Funktion", "val", ["Stängs vid brandlarm", "Stängs vid rökdetektion", "Motioneras var 48:e timme"]),
                new("rokgasevak", "Rökgasevakuering", "kryss"),
                new("ovrigt", "Övrigt"),
            ]),

        // ---------------- Driftsättning ----------------
        new("egenkontroll", "Egenkontroll", "Driftsättning",
            "En kontrollpunkt per komponent. Bocka i Kontrollerad så fylls datum och signatur i.",
            Kopplad: true,
            Kolumner:
            [
                K("beteckning", "Beteckning", mono: true),
                K("beskrivning", "Beskrivning", bredd: 180),
                K("komponenttyp", "Komponenttyp"),
                K("placering", "Placering"),
                new("kontrollerad", "Kontrollerad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
                new("datum", "Datum", "datum"),
                new("sign", "Sign.", Mono: true, Bredd: 52),
                new("anmarkning", "Anmärkning", Bredd: 200),
                new("ansvarig", "Ansvarig", "val", Kat("EgenkontrollAnsvarig")),
            ]),

        new("anmarkningar", "Anmärkningsbilaga", "Driftsättning",
            "Fria anmärkningar, till exempel \"Dåligt målat i teknikrum\" eller \"Saknas filter i aggregat\". Nr räknas alltid sammanhängande.",
            Kopplad: false,
            Kolumner:
            [
                new("nr", "Nr", "lopnr"),
                new("anmarkning", "Anmärkning", Bredd: 420, Fyll: true),
                new("ansvarig", "Ansvarig entreprenör", "val", Kat("AnsvarigEntreprenor")),
                new("tillhor", "Tillhör"),
                new("atgardad", "Åtgärdad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
                new("datum", "Datum för åtgärd", "datum"),
                new("sign", "Sign.", Mono: true, Bredd: 52),
            ]),

        new("iplista", "IP-lista", "Driftsättning",
            "Nätverksenheter i projektet. Dubbla IP-adresser markeras i rött.",
            Kopplad: false,
            Kolumner:
            [
                new("enhet", "Enhet", Bredd: 180),
                new("ip", "IP-adress", Mono: true),
                new("natmask", "Nätmask", Mono: true, Standard: "255.255.255.0"),
                new("gateway", "Gateway", Mono: true),
                new("dns1", "DNS 1", Mono: true),
                new("dns2", "DNS 2", Mono: true),
                new("portar", "Portar", Mono: true),
                new("mac", "MAC-ID", Mono: true),
                new("lanport", "LAN-port"),
                new("ansluterTill", "Ansluter till"),
                new("ovrigt", "Övrigt"),
            ]),

        new("matplan", "Mätplan", "Driftsättning",
            "Projektets mätare och kontroll av dem.",
            Kopplad: false,
            Kolumner:
            [
                new("matare", "Mätarbeteckning", Mono: true),
                new("medie", "Medie", "val", Kat("Medie")),
                new("betjanar", "Betjänar"),
                new("fabrikat", "Fabrikat/Typ", "val", Kat("FabrikatTyp")),
                new("sekundarId", "Sekundär-ID", Mono: true),
                new("matarstallning", "Mätarställning vid kontroll", Mono: true),
                new("ovrigt", "Övrigt"),
                new("kontrollerad", "Kontrollerad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
                new("datum", "Datum för kontroll", "datum"),
                new("sign", "Sign.", Mono: true, Bredd: 52),
            ]),

        // ---------------- Konstruktion ----------------
        new("modbus", "Modbus", "Konstruktion",
            "Modbus-enheter och kommunikationsinställningar. Koppling till gateway per slinga kommer när Modbus och Modbus RTU slås ihop.",
            Kopplad: false,
            Kolumner:
            [
                new("beteckning", "Beteckning", Mono: true),
                new("id", "ID", Mono: true),
                new("slinga", "Slinga"),
                new("port", "Port", "val", Kat("ModbusPort")),
                new("ip", "IP-adress", Mono: true),
                new("baudrate", "Baudrate", "val", Kat("ModbusBaudrate"), Standard: "9600"),
                new("paritet", "Paritet", "val", Kat("ModbusParitet"), Standard: "Even"),
                new("stopbit", "Stopbit", "val", Kat("ModbusStopbit"), Standard: "1"),
                new("ovrigt", "Övrigt"),
                new("kontrollerad", "Kontrollerad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
                new("datum", "Datum", "datum"),
                new("sign", "Sign.", Mono: true, Bredd: 52),
            ]),

        // ---------------- Projektering ----------------
        new("kravstallning", "Listad kravställning", "Projektering",
            "Samla projektets kravställningar kortfattat. Bocka i Hanterad när kravet är omhändertaget.",
            Kopplad: false,
            Kolumner:
            [
                new("krav", "Kravställning", Bredd: 340),
                new("kalla", "Källa", "val", Kat("KravstallningKalla")),
                new("intern", "Intern info", Bredd: 200),
                new("hanterad", "Hanterad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
                new("datum", "Datum", "datum"),
                new("sign", "Sign.", Mono: true, Bredd: 52),
            ]),

        Risk("risk-projektering", "Riskanalys projektering",
            "Risker i projekteringen. Riskvärde = sannolikhet × konsekvens (1–3). 1–2 låg, 3–4 medel, 6–9 hög."),
        Risk("risk-produktion", "Riskanalys produktion",
            "Risker i produktionen, t.ex. lyft, arbete på stege eller nära spänning. Riskvärde = sannolikhet × konsekvens (1–3)."),

        // ---------------- Dokumentation ----------------
        new("signaturlista", "Signaturlista", "Dokumentation",
            "Personer som är delaktiga i projektet. Skriv ut listan, signera för hand och spara den inskannade versionen under Projektfiler → Signerade dokument.",
            Kopplad: false,
            Kolumner:
            [
                new("signatur", "Signatur", Mono: true),
                new("fornamn", "Förnamn"),
                new("efternamn", "Efternamn"),
                new("roll", "Roll"),
                new("foretag", "Företag"),
                new("epost", "E-post"),
                new("telefon", "Telefon", Mono: true),
                new("underskrift", "Underskrift", Bredd: 200),
            ]),

        new("anlaggningsinstallningar", "Anläggningsinställningar", "Dokumentation",
            "Använd denna flik då du ska påverka en driftsatt anläggning och måste spara undan befintliga inställningar.",
            Kopplad: false,
            Kolumner:
            [
                new("komponent", "Komponent/Beteckning", Mono: true),
                new("typ", "Typ av inställning", "val", Kat("TypAvInstallning")),
                new("installning", "Inställning", Mono: true),
                new("beskrivning", "Beskrivning", Bredd: 220),
                new("ovrigt", "Övrigt"),
            ]),

        // ---------------- Service ----------------
        new("planerade", "Planerade tillfällen", "Service",
            "Planerade servicebesök.",
            Kopplad: false,
            Kolumner:
            [
                new("nr", "Besök nr", "lopnr"),
                new("vecka", "Vecka", Mono: true),
                new("datum", "Datum", "datum"),
                new("gjord", "Gjord", "kryss"),
            ]),
    ];

    /// <summary>Mall för kontroller (Projektspecifika kontroller, Projekteringsegenkontroll, Kontroller under Service).
    /// Varje kontroll i ett projekt är en egen lista med id "kontroll-{Guid}".</summary>
    public static readonly ListDef Kontroll = new("kontroll", "Kontroll", "Kontroller",
        "Bocka i Kontrollerad så fylls datum och signatur i.",
        Kopplad: false,
        Kolumner:
        [
            new("kontrollpunkt", "Kontrollpunkt", Bredd: 420, Fyll: true),
            new("kontrollerad", "Kontrollerad", "kryss", SatterDatum: "datum", SatterSign: "sign"),
            new("datum", "Datum", "datum"),
            new("sign", "Sign.", Mono: true, Bredd: 52),
            new("ovrigt", "Övrigt", Bredd: 220),
        ]);

    public const string KontrollPrefix = "kontroll-";

    /// <summary>Kraftberäkning per apparatskåp (lista "kraft-{skåpets Id}").</summary>
    public static readonly ListDef Kraft = new("kraft", "Kraftberäkning", "Konstruktion",
        "Strömmen per fas för det som matas från skåpet. Summan per fas räknas ut längst ned.",
        Kopplad: false,
        Kolumner:
        [
            new("beteckning", "Beteckning", Mono: true, Bredd: 140),
            new("komponent", "Komponent", Bredd: 180),
            new("l1", "L1 (A)", Mono: true, Bredd: 80),
            new("l2", "L2 (A)", Mono: true, Bredd: 80),
            new("l3", "L3 (A)", Mono: true, Bredd: 80),
            new("information", "Information", Bredd: 260, Fyll: true),
        ]);

    public const string KraftPrefix = "kraft-";

    public static ListDef? Hitta(string id)
    {
        if (id.StartsWith(KontrollPrefix, StringComparison.Ordinal) && Guid.TryParse(id[KontrollPrefix.Length..], out _))
            return Kontroll with { Id = id };
        if (id.StartsWith(KraftPrefix, StringComparison.Ordinal) && Guid.TryParse(id[KraftPrefix.Length..], out _))
            return Kraft with { Id = id };
        return Alla.FirstOrDefault(d => d.Id == id);
    }

    /// <summary>Om en komponent hör till listan (för listor som bara visar vissa komponenttyper).</summary>
    public static bool Omfattar(ListDef def, string komponenttyp) =>
        def.KomponenttypInnehaller is null
        || def.KomponenttypInnehaller.All(o => komponenttyp.Contains(o, StringComparison.OrdinalIgnoreCase));
}
