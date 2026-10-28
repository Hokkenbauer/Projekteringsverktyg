using System.Text.Json;
using System.Text.RegularExpressions;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.KomponentApi;

/// <summary>En I/O-punkt på en komponent, t.ex. DI DRIFT. Signalnamnet blir beteckningen + funktionen (LB01-TF01-DRIFT).</summary>
public sealed record Signal(string Id, string Typ, string Funktion, string Beskrivning);

/// <summary>
/// En komponents I/O-punkter. De sparas som JSON i Komponent.Signaler; fältet Signaltyp är en sammanfattning
/// ("2×DI, DU, AU, Modbus RTU") som listor, modulbeläggning och export läser som förut.
/// Tom Signaler = inte ändrad sedan I/O-punkterna infördes: punkterna tolkas då ur Signaltyp, med fasta id.
/// </summary>
public static partial class Signaler
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxAntal = 200;

    /// <summary>Typerna i sorteringsordning. Samma förkortningar som Ritbordets I/O-rader.</summary>
    public static readonly string[] Typer = ["DI", "DU", "AI", "AU", "Modbus RTU", "Modbus TCP", "M-bus", "SIOX", "BACnet", "KNX", "DALI"];

    /// <summary>Förslag på funktion per typ. Nya punkter får första förslaget som inte redan används på komponenten.</summary>
    public static readonly Dictionary<string, string[]> Funktioner = new()
    {
        ["DI"] = ["DRIFT", "LARM", "INDIKERING", "NIVÅ", "FLÖDE", "SÄKERHET"],
        ["DU"] = ["MANÖVER", "STOPP", "ÖPPNA", "STÄNG", "STEG2"],
        ["AI"] = ["MÄTVÄRDE", "ÅTERKOPPLING", "TEMP", "TRYCK", "FLÖDE"],
        ["AU"] = ["STYRSIGNAL", "VARVTAL", "BÖRVÄRDE"],
    };

    public static List<Signal> Las(Komponent k)
    {
        if (string.IsNullOrWhiteSpace(k.Signaler)) return Tolka(k.Signaltyp, k.Id.ToString("N")[..8]);
        try { return Rensa(JsonSerializer.Deserialize<List<Signal>>(k.Signaler, Json) ?? []); }
        catch (JsonException) { return Tolka(k.Signaltyp, k.Id.ToString("N")[..8]); }
    }

    /// <summary>Sparar punkterna på komponenten och uppdaterar sammanfattningen i Signaltyp.</summary>
    public static void Satt(Komponent k, List<Signal> lista)
    {
        lista = Rensa(lista);
        k.Signaler = JsonSerializer.Serialize(lista, Json);
        k.Signaltyp = Sammanfatta(lista);
    }

    public static List<Signal> LasJson(string json)
    {
        try { return Rensa(JsonSerializer.Deserialize<List<Signal>>(json, Json) ?? []); }
        catch (JsonException) { throw new ArgumentException("I/O-punkterna kunde inte läsas."); }
    }

    private static List<Signal> Rensa(List<Signal> lista)
    {
        var ids = new HashSet<string>();
        var ut = new List<Signal>();
        foreach (var s in lista.Take(MaxAntal))
        {
            if (s is null) continue;
            var typ = NormaliseraTyp(s.Typ ?? "") ?? (s.Typ ?? "").Trim();
            if (typ == "") continue;
            var id = string.IsNullOrWhiteSpace(s.Id) || !ids.Add(s.Id.Trim()) ? NyttId() : s.Id.Trim();
            ids.Add(id);
            ut.Add(new Signal(id, Kort(typ, 40), Kort((s.Funktion ?? "").Trim(), 60), Kort((s.Beskrivning ?? "").Trim(), 300)));
        }
        return ut;
    }

    private static string Kort(string s, int max) => s.Length > max ? s[..max] : s;
    private static string NyttId() => Guid.NewGuid().ToString("N")[..10];

    /// <summary>"2×DI, DU, AU, Modbus RTU". Tom lista = tom text.</summary>
    public static string Sammanfatta(IEnumerable<Signal> lista)
    {
        var grupper = lista.GroupBy(s => s.Typ)
            .OrderBy(g => Array.IndexOf(Typer, g.Key) is var i and >= 0 ? i : 999).ThenBy(g => g.Key);
        return string.Join(", ", grupper.Select(g => g.Count() > 1 ? $"{g.Count()}×{g.Key}" : g.Key));
    }

    /// <summary>
    /// Tolkar kortformer som "2DI DU AO RTU", "DI+DO", "2×DI, AU" eller "Modbus RTU".
    /// DO/AO skrivs som DU/AU. Text som inte känns igen blir en punkt med texten som typ.
    /// </summary>
    public static List<Signal> Tolka(string? text, string? idPrefix = null)
    {
        var ut = new List<Signal>();
        if (string.IsNullOrWhiteSpace(text)) return ut;
        var traffar = TypRegex().Matches(text.ToUpperInvariant());
        if (traffar.Count == 0)
        {
            ut.Add(new Signal(idPrefix is null ? NyttId() : $"{idPrefix}_0", Kort(text.Trim(), 40), "", ""));
            return ut;
        }
        foreach (Match m in traffar)
        {
            var antal = int.TryParse(m.Groups["antal"].Value, out var a) ? Math.Clamp(a, 1, 64) : 1;
            var typ = NormaliseraTyp(m.Groups["typ"].Value)!;
            for (var i = 0; i < antal && ut.Count < MaxAntal; i++)
                ut.Add(new Signal(idPrefix is null ? NyttId() : $"{idPrefix}_{ut.Count}", typ, NastaFunktion(typ, ut), ""));
        }
        return ut;
    }

    private static string NastaFunktion(string typ, List<Signal> befintliga)
    {
        if (!Funktioner.TryGetValue(typ, out var forslag)) return "";
        var anvanda = befintliga.Where(s => s.Typ == typ).Select(s => s.Funktion).ToHashSet();
        return forslag.FirstOrDefault(f => !anvanda.Contains(f)) ?? "";
    }

    public static string? NormaliseraTyp(string typ)
    {
        var t = Regex.Replace(typ.Trim().ToUpperInvariant(), @"[\s_-]+", " ");
        return t switch
        {
            "DI" => "DI",
            "DU" or "DO" => "DU",
            "AI" => "AI",
            "AU" or "AO" => "AU",
            "RTU" or "MODBUS RTU" or "MODBUS" => "Modbus RTU",
            "TCP" or "MODBUS TCP" => "Modbus TCP",
            "MBUS" or "M BUS" => "M-bus",
            "SIOX" => "SIOX",
            "BACNET" => "BACnet",
            "KNX" => "KNX",
            "DALI" => "DALI",
            _ => null,
        };
    }

    [GeneratedRegex(@"(?<![A-ZÅÄÖ])(?:(?<antal>\d{1,2})\s*[X×*]?\s*)?(?<typ>MODBUS[\s_-]*RTU|MODBUS[\s_-]*TCP|MODBUS|M[\s_-]?BUS|SIOX|BACNET|KNX|DALI|RTU|TCP|DI|DO|DU|AI|AO|AU)(?![A-ZÅÄÖ])")]
    private static partial Regex TypRegex();
}
