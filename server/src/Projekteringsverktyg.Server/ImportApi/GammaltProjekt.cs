using System.Globalization;
using System.Text.Json;
using System.Xml.Linq;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.ImportApi;

/// <summary>Allt som skapas från en projektfil (.projxml) från ProjektVerktyg 2.2.</summary>
public sealed class ImportResultat
{
    public required Projekt Projekt { get; init; }
    public List<Komponent> Komponenter { get; } = [];
    public List<ListRad> ListRader { get; } = [];
    public List<ProjektText> Texter { get; } = [];
    public List<AttGoraPost> AttGora { get; } = [];
    public List<Kontroll> Kontroller { get; } = [];
    public List<Skap> Skap { get; } = [];
    public List<ProjektDokument> Dokument { get; } = [];
    public List<StatusUppgift> Status { get; } = [];
    public List<AndringsloggPost> Logg { get; } = [];
    /// <summary>Vad som importerades och vad som inte gick, i klartext.</summary>
    public List<string> Rapport { get; } = [];
    public List<string> Varningar { get; } = [];
}

/// <summary>
/// Läser en projektfil från dagens program (ProjektVerktyg 2.2, XML med rot ProjektFil) och bygger
/// motsvarande projekt i den nya appen. Komponenterna får nya Id; listor, modulbeläggning och Modbus
/// pekar om till dem. Inget sparas här, det gör anroparen i en och samma transaktion.
/// </summary>
public static class GammaltProjekt
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Uppgifterna i Projekt Status från dagens program (DATA\projektstatus.xml): Id → (rubrik, text).</summary>
    private static readonly Dictionary<string, (string Rubrik, string Text)> StatusUppgifter = new(StringComparer.OrdinalIgnoreCase)
    {
        ["d89fe047a2ec4abf86b13323f8d2cafb"] = ("Förprojektering", "Samla underlag"),
        ["96258d89efa3445299c55846692b3e63"] = ("Förprojektering", "Läsa in kravställningar"),
        ["2195ebe5adfa43b1a37eafde2587737b"] = ("Förprojektering", "Läsa in kundkrav"),
        ["83f9cc260fca4a8988f2cfbfbfc4bf89"] = ("Projektering", "Sammanställa uppgifter"),
        ["5187ba0909644791aa29ccd77ecbea02"] = ("Skåpskonstruktion", "Signalhantering"),
        ["77a7a40d2b13491d970bed44ea5162cf"] = ("Skåpskonstruktion", "Kundstandard"),
    };

    private static readonly string[] SkapFarger =
    [
        "DI", "DO", "AI", "AO", "FrammandeSpanning", "230VManover", "L1", "L2", "L3", "Neutralledare", "400V", "JordPE",
        "24VDCPlus", "24VDCMinus", "24VACG", "24VACG0", "BussKommunikation",
    ];

    public static ImportResultat Las(XDocument xml, string avNamn, IReadOnlyDictionary<Guid, string> statusRubriker, string tekniskBeskrivningKatalog)
    {
        var rot = xml.Root ?? throw new InvalidDataException("Filen är tom.");
        if (rot.Name.LocalName != "ProjektFil")
            throw new InvalidDataException("Filen är inte en projektfil från ProjektVerktyg (.projxml).");

        var meta = rot.Element("Metadata");
        var namn = T(meta, "Projektnamn");
        var p = new Projekt
        {
            Namn = namn == "" ? "Importerat projekt" : namn,
            Nummer = T(meta, "Projektnummer"),
            Kund = T(meta, "Kund"),
            Ansvarig = T(meta, "Ansvarig") is { Length: > 0 } a ? a : avNamn,
            SkapadAv = avNamn,
            Anteckningar = T(rot, "Anteckningar"),
        };
        var r = new ImportResultat { Projekt = p };
        var nu = DateTimeOffset.UtcNow;

        // ---- Komponenter (nya Id, gamla Id → nya) ----
        var idKarta = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var k in Rader(rot, "Komponenter", "Komponent"))
        {
            var ny = new Komponent
            {
                ProjektId = p.Id,
                System = T(k, "System"), Beteckning = T(k, "Beteckning"), Komponenttyp = T(k, "Komponenttyp"),
                Signaltyp = T(k, "Signaltyp"), Beskrivning = T(k, "Beskrivning"), AnslutsTill = T(k, "AnslutsTill"),
                Kabeltyp = T(k, "Kabeltyp"), Placering = T(k, "Placering"), Ovrigt = T(k, "Ovrigt"),
                Produkttyp = T(k, "Produkttyp"), Produkt = T(k, "Produkt"), Monteringsanvisning = T(k, "Monteringsanvisning"),
                AndradAv = avNamn,
            };
            var gammalt = (string?)k.Attribute("Id") ?? "";
            if (gammalt != "") idKarta[gammalt] = ny.Id;
            r.Komponenter.Add(ny);
        }
        if (r.Komponenter.Count > 0) r.Rapport.Add($"{r.Komponenter.Count} komponenter");
        var perBeteckning = r.Komponenter.Where(k => k.Beteckning != "")
            .GroupBy(k => k.Beteckning.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        Guid? Komp(string? gammaltId) => gammaltId is not null && idKarta.TryGetValue(gammaltId, out var id) ? id : null;

        // ---- Listor kopplade till komponenterna ----
        var ordning = 0;
        void Kopplad(string lista, string element, Func<XElement, Dictionary<string, string>> data, string rubrik)
        {
            var antal = 0;
            foreach (var rad in Rader(rot, element, "Rad"))
            {
                var kid = Komp((string?)rad.Attribute("KomponentId"));
                if (kid is null) continue;
                var d = Rensa(data(rad));
                if (d.Count == 0) continue;
                r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = lista, KomponentId = kid, Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
                antal++;
            }
            if (antal > 0) r.Rapport.Add($"{rubrik}: {antal} rader");
        }

        Kopplad("skyltlista", "Skyltlista", x => new()
        {
            ["textfarg"] = T(x, "Textfarg"), ["skyltfarg"] = T(x, "Skyltfarg"), ["montage"] = T(x, "Montage"), ["ovrigt"] = T(x, "Ovrigt"),
        }, "Skyltlista");
        Kopplad("installationslista", "Installationslista", x => new()
        {
            ["langd"] = T(x, "LangdMeter"), ["information"] = T(x, "Information"),
            ["utdragen"] = Kryss(x, "Utdragen"), ["utdragenDatum"] = Datum(x, "UtdragenDatum"), ["utdragenSign"] = T(x, "UtdragenSign"),
            ["ansluten"] = Kryss(x, "Ansluten"), ["anslutenDatum"] = Datum(x, "AnslutenDatum"), ["anslutenSign"] = T(x, "AnslutenSign"),
            ["markning"] = Kryss(x, "Markning"), ["markningDatum"] = Datum(x, "MarkningDatum"), ["markningSign"] = T(x, "MarkningSign"),
        }, "Installationslista");
        Kopplad("egenkontroll", "Egenkontroll", x => new()
        {
            ["kontrollerad"] = Kryss(x, "Kontrollerad"), ["datum"] = Datum(x, "KontrolleradDatum"), ["sign"] = T(x, "Sign"),
            ["anmarkning"] = T(x, "Anmarkning"), ["ansvarig"] = T(x, "Ansvarig"),
        }, "Egenkontroll");
        Kopplad("brandspjall", "Brandspjallstabell", x => new()
        {
            ["betjanar"] = T(x, "Betjanar"), ["lufttyp"] = T(x, "Lufttyp"), ["rokgasevak"] = Kryss(x, "Rokgasevak"), ["ovrigt"] = T(x, "Ovrigt"),
        }, "Brandspjällstabell");

        // ---- Fria listor ----
        void Fri(string lista, string element, Func<XElement, Dictionary<string, string>> data, string rubrik, string radElement = "Rad")
        {
            var antal = 0;
            foreach (var rad in Rader(rot, element, radElement))
            {
                var d = Rensa(data(rad));
                if (d.Count == 0) continue;
                r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = lista, Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
                antal++;
            }
            if (antal > 0) r.Rapport.Add($"{rubrik}: {antal} rader");
        }

        Fri("anmarkningar", "Anmarkningar", x => new()
        {
            ["anmarkning"] = T(x, "Anmarkning"), ["ansvarig"] = T(x, "AnsvarigEntreprenor"), ["tillhor"] = T(x, "Tillhor"),
            ["atgardad"] = Kryss(x, "Atgardad"), ["datum"] = Datum(x, "DatumForAtgard"), ["sign"] = T(x, "Sign"),
        }, "Anmärkningsbilaga");
        Fri("iplista", "IpLista", x => new()
        {
            ["enhet"] = T(x, "Enhet"), ["ip"] = T(x, "IpAdress"), ["natmask"] = T(x, "Natmask"), ["gateway"] = T(x, "Gateway"),
            ["dns1"] = T(x, "Dns1"), ["dns2"] = T(x, "Dns2"), ["portar"] = T(x, "Portar"), ["mac"] = T(x, "MacId"),
            ["lanport"] = T(x, "LanPort"), ["ansluterTill"] = T(x, "AnsluterTill"), ["ovrigt"] = T(x, "Ovrigt"),
        }, "IP-lista");
        Fri("matplan", "Matplan", x => new()
        {
            ["matare"] = Koppling(T(x, "Matarbeteckning"), perBeteckning), ["medie"] = T(x, "Medie"), ["betjanar"] = T(x, "Betjanar"), ["fabrikat"] = T(x, "FabrikatTyp"),
            ["sekundarId"] = T(x, "SekundarId"), ["matarstallning"] = T(x, "MatarstallningVidKontroll"), ["ovrigt"] = T(x, "Ovrigt"),
            ["kontrollerad"] = Kryss(x, "Kontrollerad"), ["datum"] = Datum(x, "DatumForKontroll"), ["sign"] = T(x, "Sign"),
        }, "Mätplan");
        Fri("signaturlista", "Signaturlista", x => new()
        {
            ["signatur"] = T(x, "Signatur"), ["fornamn"] = T(x, "Fornamn"), ["efternamn"] = T(x, "Efternamn"), ["roll"] = T(x, "Roll"),
            ["foretag"] = T(x, "Foretag"), ["epost"] = T(x, "Epost"), ["telefon"] = T(x, "Telefon"),
        }, "Signaturlista");
        Fri("anlaggningsinstallningar", "Installningar", x => new()
        {
            ["komponent"] = T(x, "KomponentBeteckning"), ["typ"] = T(x, "TypAvInstallning"), ["installning"] = T(x, "Installning"),
            ["beskrivning"] = T(x, "Beskrivning"), ["ovrigt"] = T(x, "Ovrigt"),
        }, "Anläggningsinställningar");
        Fri("kravstallning", "Kravstallning", x => new()
        {
            ["krav"] = T(x, "Kravstallning"), ["kalla"] = T(x, "Kalla"), ["intern"] = T(x, "InternInfo"),
            ["hanterad"] = Kryss(x, "Hanterad"), ["datum"] = DatumText(T(x, "Datum")), ["sign"] = T(x, "Sign"),
        }, "Listad kravställning");
        Fri("planerade", "PlaneradeTillfallen", x => new()
        {
            ["vecka"] = T(x, "Vecka"), ["datum"] = DatumText(T(x, "Datum")), ["gjord"] = Kryss(x, "Gjord"),
        }, "Planerade tillfällen");
        Fri("kalkylmangder", "Kalkylmangder", x => new() { ["produkt"] = T(x, "Produkt"), ["mangd"] = T(x, "KalkyleradMangd") }, "Kalkylmängder");
        Fri("modbus", "Modbus", x => new()
        {
            ["beteckning"] = Koppling(T(x, "Beteckning"), perBeteckning), ["id"] = T(x, "Id"), ["slinga"] = T(x, "Slinga"),
            ["port"] = T(x, "Port"), ["ip"] = T(x, "IPAdress"), ["baudrate"] = T(x, "Baudrate"), ["paritet"] = T(x, "Paritet"),
            ["stopbit"] = T(x, "Stopbit"), ["ovrigt"] = T(x, "Ovrigt"),
            ["kontrollerad"] = Kryss(x, "Kontrollerad"), ["datum"] = DatumText(T(x, "Datum")), ["sign"] = T(x, "Sign"),
        }, "Modbus");

        // Riskbedömning: Arbetsmiljö hör till produktionen, övrigt (t.ex. Enligt PBL) till projekteringen.
        var risker = 0;
        foreach (var x in Rader(rot, "Riskbedomning", "Rad"))
        {
            var typ = T(x, "TypAvRisk");
            var d = Rensa(new()
            {
                ["arbetsmoment"] = typ, ["risk"] = T(x, "UpptagenRisk"), ["sannolikhet"] = T(x, "Sannolikhet"),
                ["konsekvens"] = T(x, "Konsekvens"), ["atgard"] = T(x, "Atgard"), ["ansvarig"] = T(x, "Ansvarig"),
            });
            if (!d.ContainsKey("risk") && !d.ContainsKey("atgard")) continue;
            var lista = typ.Contains("arbetsmilj", StringComparison.OrdinalIgnoreCase) ? "risk-produktion" : "risk-projektering";
            r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = lista, Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
            risker++;
        }
        if (risker > 0) r.Rapport.Add($"Riskbedömning: {risker} risker (Arbetsmiljö under Riskanalys produktion, övriga under Riskanalys projektering)");
        var riskHuvud = Rensa(new() { ["objekt"] = T(rot, "RiskbedomningObjekt"), ["datum"] = DatumText(T(rot, "RiskbedomningDatum")), ["handlaggare"] = T(rot, "RiskbedomningHandlaggare") });
        if (riskHuvud.Count > 0)
            foreach (var nyckel in new[] { "risk-projektering", "risk-produktion" })
                r.Texter.Add(new ProjektText { ProjektId = p.Id, Nyckel = nyckel, Text = JsonSerializer.Serialize(riskHuvud, Json), Andrad = nu, AndradAv = avNamn });

        // ---- Texter ----
        void Text(string nyckel, string text, string rubrik)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            r.Texter.Add(new ProjektText { ProjektId = p.Id, Nyckel = nyckel, Text = text, Andrad = nu, AndradAv = avNamn });
            r.Rapport.Add(rubrik);
        }
        Text("projektinformation", T(rot, "Projektinformation"), "Projektinformation");
        Text("serviceinformation", T(rot, "Serviceinformation"), "Serviceinformation");
        if (p.Anteckningar != "") { p.AnteckningarAndrad = nu; r.Rapport.Add("Anteckningar"); }

        // ---- Att göra ----
        var nr = 0;
        foreach (var x in Rader(rot, "AttGoraLista", "Rad"))
        {
            var t = T(x, "Text");
            if (t == "") continue;
            r.AttGora.Add(new AttGoraPost { ProjektId = p.Id, Text = t, Ordning = ++nr, AndradAv = avNamn });
        }
        if (nr > 0) r.Rapport.Add($"Att göra: {nr} rader");

        // ---- Projekt Status ----
        var rubrikPerNamn = statusRubriker.ToDictionary(x => x.Value, x => x.Key, StringComparer.OrdinalIgnoreCase);
        var okandaStatus = 0;
        foreach (var x in Rader(rot, "ProjektStatus", "Rad"))
        {
            var id = (string?)x.Attribute("UppgiftId") ?? "";
            if (!StatusUppgifter.TryGetValue(id, out var u) || !rubrikPerNamn.TryGetValue(u.Rubrik, out var rubrikId)) { okandaStatus++; continue; }
            var klar = B(x, "Klart");
            r.Status.Add(new StatusUppgift
            {
                ProjektId = p.Id, RubrikId = rubrikId, Text = u.Text, Ordning = r.Status.Count + 1, Klar = klar,
                Kommentar = T(x, "Kommentar"), UtfordAv = T(x, "UtfordAv"), KlarDatum = klar ? nu : null, AndradAv = avNamn,
            });
        }
        if (r.Status.Count > 0) r.Rapport.Add($"Projekt Status: {r.Status.Count} uppgifter");
        if (okandaStatus > 0) r.Varningar.Add($"Projekt Status: {okandaStatus} uppgifter fanns inte i grundkatalogen och lades inte in. Lägg till dem under Projekt Status vid behov.");

        // ---- Kontroller ----
        var kontrollOrdning = 0;
        void Kontroller(string element, string typ, string rubrik)
        {
            var antal = 0;
            foreach (var k in Rader(rot, element, "Kontroll"))
            {
                var kontroll = new Kontroll
                {
                    ProjektId = p.Id, Typ = typ, Namn = (string?)k.Attribute("Namn") is { Length: > 0 } n ? n : "Kontroll",
                    MallNamn = (string?)k.Attribute("MallNamn") ?? "", Beskrivning = T(k, "Beskrivning"), Ordning = ++kontrollOrdning, AndradAv = avNamn,
                };
                r.Kontroller.Add(kontroll);
                foreach (var rad in Rader(k, "Rader", "Rad"))
                {
                    var d = Rensa(new()
                    {
                        ["kontrollpunkt"] = T(rad, "Kontrollpunkt"), ["kontrollerad"] = Kryss(rad, "Kontrollerad"),
                        ["datum"] = Datum(rad, "DatumForKontroll"), ["sign"] = T(rad, "Sign"), ["ovrigt"] = T(rad, "Ovrigt"),
                    });
                    if (d.Count == 0) continue;
                    r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = $"kontroll-{kontroll.Id}", Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
                }
                antal++;
            }
            if (antal > 0) r.Rapport.Add($"{rubrik}: {antal} st");
        }
        Kontroller("Kontroller", "projekt", "Projektspecifika kontroller");
        Kontroller("ProjekteringsKontroller", "projektering", "Projekteringsegenkontroller");
        Kontroller("ServiceKontroller", "service", "Kontroller (service)");

        // ---- Apparatskåp, Kraftberäkning och Modulbeläggning (samma skåp, ihop via namnet) ----
        Skap SkapFor(string skapNamn)
        {
            var s = r.Skap.FirstOrDefault(x => string.Equals(x.Namn, skapNamn, StringComparison.OrdinalIgnoreCase));
            if (s is not null) return s;
            s = new Skap { ProjektId = p.Id, Namn = skapNamn == "" ? $"Skåp {r.Skap.Count + 1}" : skapNamn, Ordning = r.Skap.Count + 1, AndradAv = avNamn };
            r.Skap.Add(s);
            return s;
        }
        foreach (var x in Rader(rot, "Apparatskap", "Skap"))
        {
            var s = SkapFor(T(x, "Namn"));
            s.Beteckning = T(x, "Beteckning"); s.Placering = T(x, "Placering"); s.Beskrivning = T(x, "Beskrivning");
            var komp = new Dictionary<string, object>();
            foreach (var k in Rader(x, "Komponenter", "Komponent"))
            {
                var kn = (string?)k.Attribute("Namn") ?? "";
                if (kn != "") komp[kn] = new { vald = B(k, "Vald"), info = T(k, "Information") };
            }
            s.Data = JsonSerializer.Serialize(new
            {
                farger = SkapFarger.Where(f => T(x, "Farg" + f) != "").ToDictionary(f => f, f => T(x, "Farg" + f)),
                komponenter = komp,
                spec = new Dictionary<string, string>
                {
                    ["matt"] = T(x, "Apparatskapsmatt"), ["ansluts"] = T(x, "AnslutsOvanUnderifran"), ["kapsling"] = T(x, "Kapslingsklass"),
                    ["dorrar"] = T(x, "DorrarEnkelDubbel"), ["material"] = T(x, "MaterialPaApparatskap"),
                },
                ovrigt = T(x, "OvrigInformation"),
            }, Json);
        }
        foreach (var x in Rader(rot, "Kraftberakning", "Skap"))
        {
            var s = SkapFor(T(x, "Namn"));
            foreach (var rad in Rader(x, "Rader", "Rad"))
            {
                var d = Rensa(new()
                {
                    ["beteckning"] = Koppling(T(rad, "Beteckning"), perBeteckning), ["komponent"] = T(rad, "Komponent"),
                    ["l1"] = Tal(rad, "L1"), ["l2"] = Tal(rad, "L2"), ["l3"] = Tal(rad, "L3"), ["information"] = T(rad, "Information"),
                });
                if (d.Count == 0) continue;
                r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = $"kraft-{s.Id}", Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
            }
        }
        foreach (var x in Rader(rot, "Modulbelaggning", "Skap"))
        {
            var s = SkapFor(T(x, "Namn"));
            var kort = Rader(x, "Kort", "Kort").Select(k => new
            {
                id = Guid.NewGuid().ToString("N")[..8],
                beskrivning = T(k, "Beskrivning"),
                antalKanaler = (int)Num(T(k, "AntalKanaler")),
                farg = T(k, "Farg") is { Length: > 0 } f ? f : "#FFFFFF",
                breddMm = Num(T(k, "BreddMm")),
                stromMa = Num(T(k, "StromMa")),
                kanaler = Rader(k, "Kanaler", "Kanal").Select(c => new
                {
                    komponentId = Komp(T(c, "KomponentId"))?.ToString()
                        ?? (T(c, "Beteckning") is { Length: > 0 } b && perBeteckning.TryGetValue(b, out var bid) ? bid.ToString() : null),
                    information = T(c, "Information"),
                }).ToList(),
            }).ToList();
            s.Moduler = JsonSerializer.Serialize(new { cpu1 = T(x, "Cpu1Beskrivning"), kort }, Json);
        }
        if (r.Skap.Count > 0) r.Rapport.Add($"Apparatskåp, Kraftberäkning och Modulbeläggning: {r.Skap.Count} skåp ({string.Join(", ", r.Skap.Select(s => s.Namn))})");

        // ---- Modbus RTU: enheterna blir gateways/slingor, lasterna enheter i Modbus ----
        var gateways = 0;
        foreach (var e in Rader(rot, "ModbusRTU", "Enhet"))
        {
            var gw = T(e, "Namn");
            r.ListRader.Add(new ListRad
            {
                ProjektId = p.Id, Lista = "modbusrtu", Ordning = ++ordning, AndradAv = avNamn,
                Data = JsonSerializer.Serialize(Rensa(new()
                {
                    ["namn"] = gw, ["placering"] = T(e, "Placering"), ["betjanar"] = T(e, "Betjanar"), ["ip"] = T(e, "IPAdress"), ["port"] = T(e, "Port"),
                }), Json),
            });
            gateways++;
            foreach (var l in Rader(e, "Laster", "Last"))
            {
                var kid = Komp(T(l, "KomponentId"));
                var d = Rensa(new()
                {
                    ["beteckning"] = kid?.ToString() ?? Koppling(T(l, "Beteckning"), perBeteckning),
                    ["id"] = T(l, "Id"), ["slinga"] = gw,
                    ["ovrigt"] = kid is null ? string.Join(" ", new[] { T(l, "Komponenttyp"), T(l, "Beskrivning") }.Where(v => v != "")) : "",
                });
                r.ListRader.Add(new ListRad { ProjektId = p.Id, Lista = "modbus", Data = JsonSerializer.Serialize(d, Json), Ordning = ++ordning, AndradAv = avNamn });
            }
        }
        if (gateways > 0) r.Rapport.Add($"Modbus RTU: {gateways} gateways/slingor med sina enheter");

        // ---- Projekteringsintyg ----
        if (rot.Element("Projekteringsintyg") is { } pi)
        {
            var intyg = new
            {
                objekt = T(pi, "Objekt") is { Length: > 0 } o ? o : p.Namn,
                slutkund = T(pi, "Slutkund") is { Length: > 0 } sk ? sk : p.Kund,
                bestallare = T(pi, "Bestallare"), projekteringsledare = T(pi, "Projekteringsledare"), projektor = T(pi, "Projektor"),
                projektnummer = T(pi, "Projektnummer") is { Length: > 0 } pn ? pn : p.Nummer,
                omfattning = T(pi, "Omfattning"),
                handlingar = Rader(pi, "UpprattadeHandlingar", null).Select(h => new
                {
                    handling = T(h, "Handling"), beskrivning = T(h, "Beskrivning"), datum = DatumText(T(h, "Datum")),
                    signProjektor = T(h, "SignProjektor"), signProjekteringsledare = T(h, "SignProjekteringsledare"),
                }).ToList(),
                anvisningar = Rader(pi, "AnvisningarForProjektering", null).Select(h => new
                {
                    dokument = T(h, "Dokument"), typ = T(h, "TypAvDokument"), daterad = DatumText(T(h, "Daterad")),
                }).ToList(),
                avsteg = T(pi, "Avsteg"), riskanalysUtford = T(pi, "RiskanalysUtfordDatumSignatur"),
                ingaRisker = B(pi, "IngaRiskerUppdagade"), riskerUppdagade = B(pi, "RiskerUppdagade"),
                materialEntreprenor = B(pi, "MaterialvalEntreprenorensAnsvar"), materialIntygat = B(pi, "MaterialvalIntygat"),
                ortDatum = T(pi, "OrtDatum"), signatur = T(pi, "Signatur"),
            };
            var ifyllt = intyg.handlingar.Count > 0 || intyg.anvisningar.Count > 0 || intyg.omfattning != "" || intyg.avsteg != ""
                || intyg.bestallare != "" || intyg.projekteringsledare != "" || intyg.projektor != "" || intyg.signatur != "";
            if (ifyllt)
            {
                r.Texter.Add(new ProjektText { ProjektId = p.Id, Nyckel = "projekteringsintyg", Text = JsonSerializer.Serialize(intyg, Json), Andrad = nu, AndradAv = avNamn });
                r.Rapport.Add("Projekteringsintyg");
            }
        }

        // ---- Teknisk beskrivning: svaren knyts till frågans text i dagens katalog ----
        var tb = TekniskBeskrivning(rot, tekniskBeskrivningKatalog, out var tbAntal);
        if (tbAntal > 0)
        {
            r.Texter.Add(new ProjektText { ProjektId = p.Id, Nyckel = "teknisk-beskrivning", Text = tb, Andrad = nu, AndradAv = avNamn });
            r.Rapport.Add($"Teknisk beskrivning: {tbAntal} svar");
        }

        // ---- Dokument: funktionstexter, servicerapporter, anslutningsinformation ----
        var ft = 0;
        foreach (var x in Rader(rot, "Funktionstexter", "Funktionstext"))
            r.Dokument.Add(new ProjektDokument
            {
                ProjektId = p.Id, Typ = "funktionstext", Namn = (string?)x.Attribute("Namn") is { Length: > 0 } fn ? fn : $"Funktionstext {ft + 1}",
                Data = T(x, "Text"), Ordning = ++ft, AndradAv = avNamn,
            });
        if (ft > 0) r.Rapport.Add($"Funktionstexter: {ft} st");

        var sr = 0;
        foreach (var x in Rader(rot, "Servicerapporter", "Rapport"))
        {
            var data = new
            {
                datum = DatumText(T(x, "Datum")), tidAnkomst = T(x, "TidAnkomst"), tidAvresa = T(x, "TidAvresa"), tekniker = T(x, "Tekniker"),
                serviceTyp = T(x, "ServiceTyp"), nastaBesok = DatumText(T(x, "NastaPlaneradeBesok")), kund = T(x, "Kund"), kontakt = T(x, "Kontakt"),
                fastighet = T(x, "Fastighetsbeteckning"), adress = T(x, "Adress"), anlaggning = T(x, "Anlaggning"), ordernr = T(x, "Ordernr"),
                arbete = T(x, "ArbeteBeskrivning"),
                atgarder = Rader(x, "Atgarder", null).Select(a => new { beskrivning = T(a, "Beskrivning"), status = T(a, "Status") }).ToList(),
                anmarkningar = T(x, "Anmarkningar"), rekommendationer = T(x, "Rekommendationer"), material = T(x, "Material"),
                signTekniker = T(x, "SignTekniker"), signKund = T(x, "SignKund"),
            };
            r.Dokument.Add(new ProjektDokument
            {
                ProjektId = p.Id, Typ = "servicerapport", Namn = T(x, "RapportNummer") is { Length: > 0 } rn ? rn : $"SR-{sr + 1:000}",
                Data = JsonSerializer.Serialize(data, Json), Ordning = ++sr, AndradAv = avNamn,
            });
        }
        if (sr > 0) r.Rapport.Add($"Servicerapporter: {sr} st");

        var ai = 0;
        foreach (var x in Rader(rot, "Anslutningsinformation", "Enhet"))
        {
            var data = new
            {
                adress = T(x, "Adress"), beskrivning = T(x, "Beskrivning"),
                konton = Rader(x, "Anvandare", null).Select(a => new { anvandarnamn = T(a, "Anvandarnamn"), losenord = T(a, "Losenord"), kommentar = T(a, "Kommentar") }).ToList(),
            };
            r.Dokument.Add(new ProjektDokument
            {
                ProjektId = p.Id, Typ = "anslutning", Namn = T(x, "Namn") is { Length: > 0 } an ? an : $"Enhet {ai + 1}",
                Data = JsonSerializer.Serialize(data, Json), Ordning = ++ai, AndradAv = avNamn,
            });
        }
        if (ai > 0) r.Rapport.Add($"Anslutningsinformation: {ai} enheter");

        // ---- Ändringsloggen från dagens program följer med som historik ----
        foreach (var x in Rader(rot, "Andringslogg", "Rad"))
        {
            var handelse = T(x, "Handelse");
            if (handelse == "") continue;
            var tid = DateTimeOffset.TryParse(T(x, "Tidpunkt"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : nu;
            r.Logg.Add(new AndringsloggPost
            {
                ProjektId = p.Id, Tidpunkt = tid.ToUniversalTime(), AnvandarId = "gamla-programmet",
                AnvandarNamn = T(x, "Anvandare") is { Length: > 0 } an ? an : "Dagens program",
                Entitet = "Import", EntitetId = p.Id, Beskrivning = $"{handelse} (i dagens program)",
            });
        }
        if (r.Logg.Count > 0) r.Rapport.Add($"Ändringslogg från dagens program: {r.Logg.Count} händelser");

        // ---- Sådant som inte följer med ----
        if (Rader(rot, "Byggvarubedomning", "Rad").Any(x => B(x, "Vald")))
            r.Varningar.Add("Byggvarubedömning: valen pekar på dagens byggvarukatalog och kunde inte flyttas. Hämta varorna från byggvarudatabasen i stället.");
        if (rot.Element("Komponenter")?.Elements("Komponent").Any(k => T(k, "Fargmarkering") != "") == true)
            r.Varningar.Add("Färgmarkeringen på komponenterna finns inte i nya appen och följde inte med.");
        if (T(rot, "KundloggaFilnamn") != "")
            r.Varningar.Add($"Kundloggan ({T(rot, "KundloggaFilnamn")}) följer inte med. Ladda upp den under Projektfiler om den behövs.");
        return r;
    }

    private static string TekniskBeskrivning(XElement rot, string katalogJson, out int antal)
    {
        antal = 0;
        var fragor = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        var ordning = new List<string>();
        try
        {
            using var d = JsonDocument.Parse(katalogJson);
            foreach (var k in d.RootElement.GetProperty("kategorier").EnumerateArray())
            {
                var kid = k.GetProperty("id").GetString() ?? "";
                fragor[kid] = k.GetProperty("fragor").EnumerateArray().Select(f => f.GetString() ?? "").ToList();
                ordning.Add(kid);
            }
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { return ""; }

        var kategorier = new Dictionary<string, object>();
        var index = -1;
        foreach (var s in Rader(rot, "TekniskBeskrivning", "Svar"))
        {
            index++;
            var id = T(s, "KategoriId");
            // Katalogen kan ha fått nya Id på en annan dator; då matchas kategorierna i ordning.
            if (!fragor.ContainsKey(id) && index < ordning.Count) id = ordning[index];
            if (!fragor.TryGetValue(id, out var f)) continue;
            var svar = new Dictionary<string, string>();
            var i = 0;
            foreach (var rad in Rader(s, "Svar", "Rad"))
            {
                var v = (rad.Value ?? "").Trim();
                if (i < f.Count && v != "") { svar[f[i]] = v; antal++; }
                i++;
            }
            kategorier[id] = new { med = B(s, "Ibockad", true), svar };
        }
        return JsonSerializer.Serialize(new { kategorier }, Json);
    }

    // ---- Hjälpare ----
    private static IEnumerable<XElement> Rader(XElement? e, string lista, string? rad) =>
        e?.Element(lista) is { } l ? (rad is null ? l.Elements() : l.Elements(rad)) : [];

    private static string T(XElement? e, string namn)
    {
        var x = e?.Element(namn);
        if (x is null || (string?)x.Attribute(XName.Get("nil", "http://www.w3.org/2001/XMLSchema-instance")) == "true") return "";
        return x.Value.Replace("\r\n", "\n").Trim();
    }

    private static bool B(XElement? e, string namn, bool standard = false) =>
        T(e, namn) is var v && v != "" ? string.Equals(v, "true", StringComparison.OrdinalIgnoreCase) : standard;

    private static string Kryss(XElement e, string namn) => B(e, namn) ? "true" : "";

    private static string Datum(XElement e, string namn) => DatumText(T(e, namn));

    /// <summary>"2026-09-14T00:00:00" → "2026-09-14". Annat lämnas som det är.
    /// Ett tomt datum i det gamla programmet sparas som 0001-01-01 – det blir tomt här, så att utskriften har en tom ruta att fylla i för hand.</summary>
    internal static string DatumText(string v) =>
        v.Length >= 10 && DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? (d.Year < 1900 ? "" : d.ToString("yyyy-MM-dd")) : v;

    private static double Num(string v) =>
        double.TryParse(v.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;

    private static string Tal(XElement e, string namn) => T(e, namn) is var v && v != "" ? Num(v).ToString(CultureInfo.InvariantCulture) : "";

    private static string Koppling(string beteckning, Dictionary<string, Guid> perBeteckning) =>
        beteckning != "" && perBeteckning.TryGetValue(beteckning.Trim(), out var id) ? id.ToString() : beteckning;

    private static Dictionary<string, string> Rensa(Dictionary<string, string> d) =>
        d.Where(x => !string.IsNullOrEmpty(x.Value)).ToDictionary(x => x.Key, x => x.Value);
}
