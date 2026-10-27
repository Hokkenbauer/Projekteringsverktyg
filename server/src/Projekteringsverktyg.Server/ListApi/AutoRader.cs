using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.ListApi;

/// <summary>
/// Listor som själva hämtar sina rader från Komponenter: Kraftberäkning (laster som är anslutna till skåpet)
/// och Mätplan (mätare). Raden pekar på komponenten (KomponentId och kopplingskolumnen); beteckning, typ m.m.
/// läses alltid från komponenten. En hämtad rad som tas bort döljs i stället, så att den inte kommer tillbaka.
/// </summary>
public static partial class AutoRader
{
    public const string Dold = "_dold";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Sista delen av beteckningen: "LB01-TF01" → "TF01", "VS01_P1" → "P1".</summary>
    public static string SistaDel(string beteckning)
    {
        var t = beteckning.Trim();
        var i = t.LastIndexOfAny(['-', '_', ' ', '.', ':']);
        return (i >= 0 ? t[(i + 1)..] : t).ToUpperInvariant();
    }

    // Pumpar och fläktar: P01, PU01, PV601, P201, PV201, TF01, FF01.
    [GeneratedRegex(@"^(P|PU|PV|TF|FF)\d", RegexOptions.CultureInvariant)]
    private static partial Regex LastNamn();

    /// <summary>Komponenttyper som är laster, och ord som betyder att det bara är en givare/vakt på lasten.</summary>
    private static readonly string[] LastTyper = ["pump", "fläkt", "kompressor", "elbatteri", "elvärm", "värmekabel"];
    private static readonly string[] InteLast = ["vakt", "givare", "spjäll", "ställdon", "larm", "indikering", "brytare", "kontakt"];

    /// <summary>Om komponenten är en last som ska med i kraftberäkningen (pump, fläkt m.m.).</summary>
    public static bool ArLast(Komponent k) =>
        !InteLast.Any(t => k.Komponenttyp.Contains(t, StringComparison.OrdinalIgnoreCase))
        && (LastNamn().IsMatch(SistaDel(k.Beteckning))
            || LastTyper.Any(t => k.Komponenttyp.Contains(t, StringComparison.OrdinalIgnoreCase)));

    // Mätare: ME, MQ, MF (energi-, värmemängds- och flödesmätare).
    [GeneratedRegex(@"^(ME|MQ|MF)\d", RegexOptions.CultureInvariant)]
    private static partial Regex MatarNamn();

    /// <summary>Om komponenten är en mätare: M-bus-punkt (oavsett namn), namnet (ME/MQ/MF) eller komponenttypen.</summary>
    public static bool ArMatare(Komponent k) =>
        Signaler.Las(k).Any(s => s.Typ == "M-bus")
        || MatarNamn().IsMatch(SistaDel(k.Beteckning))
        || k.Komponenttyp.Contains("mätare", StringComparison.OrdinalIgnoreCase)
        || k.Komponenttyp.Contains("energimät", StringComparison.OrdinalIgnoreCase);

    /// <summary>Förslag på medie, enhet och kommunikation för en ny mätarrad (fylls bara i när det går att avgöra).</summary>
    public static Dictionary<string, string> MatareForslag(Komponent k)
    {
        var d = new Dictionary<string, string>();
        var text = $"{k.Komponenttyp} {k.Beskrivning}".ToLowerInvariant();
        var del = SistaDel(k.Beteckning);
        var medie =
            text.Contains("elmätare") || text.Contains("el-mätare") || text.Contains("fastighetsel") || del.StartsWith("MQ5") ? "El"
            : text.Contains("fjärrvärme") ? "Fjärrvärme"
            : text.Contains("varmvatten") ? "Varmvatten"
            : text.Contains("kallvatten") ? "Kallvatten"
            : text.Contains("kyl") ? "Kyla"
            : text.Contains("värme") || del.StartsWith("MQ4") ? "Värme"
            : "";
        if (medie != "") d["medie"] = medie;
        var enhet = medie switch
        {
            "El" => "kWh / MWh",
            "Kallvatten" => "m³/h / m³",
            "" => "",
            _ => "kWh / MWh / m³/h / m³",
        };
        if (enhet != "") d["enhet"] = enhet;
        var typer = Signaler.Las(k).Select(s => s.Typ).ToHashSet();
        var komm = typer.Contains("M-bus") ? "M-bus" : typer.Contains("Modbus RTU") ? "Modbus RTU" : typer.Contains("Modbus TCP") ? "Modbus TCP" : "";
        if (komm != "") d["kommunikation"] = komm;
        return d;
    }

    /// <summary>
    /// Lägger till rader för komponenter som hör till listan men saknas (även dolda räknas som "finns").
    /// Returnerar de nya raderna; tom lista om inget saknades. Sparar inte.
    /// </summary>
    public static async Task<List<ListRad>> LaggTillSaknadeAsync(PvDbContext db, Guid projektId, ListDef def, string lista, Anvandare av, CancellationToken ct = default)
    {
        if (def.Hamtar is null) return [];
        var komponenter = await db.Komponenter.AsNoTracking().Where(k => k.ProjektId == projektId).ToListAsync(ct);
        List<Komponent> kandidater;
        string kolumn;
        if (def.Hamtar == "kraft")
        {
            if (!lista.StartsWith(Listdefinitioner.KraftPrefix) || !Guid.TryParse(lista[Listdefinitioner.KraftPrefix.Length..], out var skapId)) return [];
            var skap = await db.Skap.AsNoTracking().FirstOrDefaultAsync(s => s.Id == skapId && s.ProjektId == projektId, ct);
            if (skap is null) return [];
            var namn = new[] { skap.Beteckning.Trim(), skap.Namn.Trim() }.Where(n => n != "").ToList();
            if (namn.Count == 0) return [];
            kandidater = komponenter.Where(k => namn.Any(n => string.Equals(k.AnslutsTill.Trim(), n, StringComparison.OrdinalIgnoreCase)) && ArLast(k)).ToList();
            kolumn = "beteckning";
        }
        else if (def.Hamtar == "matare")
        {
            kandidater = komponenter.Where(ArMatare).ToList();
            kolumn = "matare";
        }
        else if (def.Hamtar == "modbus")
        {
            kandidater = komponenter.Where(KomponentApi.Gateways.ArModbusEnhet).ToList();
            kolumn = "beteckning";
        }
        else return [];
        if (kandidater.Count == 0) return [];

        var befintliga = await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).ToListAsync(ct);
        var finns = new HashSet<Guid>(befintliga.Where(r => r.KomponentId is not null).Select(r => r.KomponentId!.Value));
        // Rader som skrivits in för hand med komponentens Id i kopplingskolumnen räknas också.
        foreach (var r in befintliga)
            if (Guid.TryParse(ListEndpoints.LasData(r.Data).GetValueOrDefault(kolumn, ""), out var id)) finns.Add(id);

        var max = befintliga.Count == 0 ? 0 : befintliga.Max(r => r.Ordning);
        List<Produkt> produkter = def.Hamtar == "kraft" ? await Produkter.HamtaAsync(db) : new();
        var nya = new List<ListRad>();
        foreach (var k in kandidater
                     .Where(k => !finns.Contains(k.Id))
                     .OrderBy(k => k.System).ThenBy(k => k.Beteckning, StringComparer.Create(new System.Globalization.CultureInfo("sv-SE"), true)))
        {
            var data = def.Kolumner.Where(c => c.Standard is not null).ToDictionary(c => c.Nyckel, c => c.Standard!);
            data[kolumn] = k.Id.ToString();
            if (def.Hamtar == "matare")
                foreach (var (f, v) in MatareForslag(k)) data[f] = v;
            // Kraftberäkning: strömmen från produktregistret när produkten finns där.
            if (def.Hamtar == "kraft" && Produkter.Hitta(produkter, k.Produkttyp) is { } produkt)
                foreach (var (f, v) in Produkter.Strom(produkt)) data[f] = v;
            var rad = new ListRad { ProjektId = projektId, Lista = lista, KomponentId = k.Id, Ordning = ++max, Data = JsonSerializer.Serialize(data, Json), AndradAv = av.Namn };
            db.ListRader.Add(rad);
            nya.Add(rad);
        }
        if (nya.Count > 0)
            Andringslogg.Logga(db, projektId, av, "Lista", null,
                $"hämtade {nya.Count} {(def.Hamtar switch { "kraft" => "laster", "modbus" => "Modbus-enheter", _ => "mätare" })} från Komponenter till {def.Namn}");
        return nya;
    }

    public static bool ArDold(ListRad r) => ListEndpoints.LasData(r.Data).GetValueOrDefault(Dold) == "true";
}
