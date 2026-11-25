using System.Text.RegularExpressions;

namespace Projekteringsverktyg.Server.ProjektApi;

/// <summary>
/// Regler för projektnamn: två aktiva projekt får inte heta likadant, och ett arkiverat projekt
/// får " – Arkiverat ÅÅÅÅ-MM-DD" i namnet så att namnet blir ledigt för nya projekt.
/// </summary>
public static partial class ProjektNamn
{
    public const int MaxLangd = 200;

    [GeneratedRegex(@" – Arkiverat \d{4}-\d{2}-\d{2}( \(\d+\))?$")]
    private static partial Regex ArkivTillagg();

    /// <summary>Jämförelse av namn: skiftläge och dubbla mellanslag spelar ingen roll.</summary>
    public static string Nyckel(string namn) => Regex.Replace(namn.Trim(), @"\s+", " ").ToLowerInvariant();

    public static bool Krockar(string namn, IEnumerable<string> andra)
    {
        var n = Nyckel(namn);
        return andra.Any(a => Nyckel(a) == n);
    }

    /// <summary>
    /// "Kv. Lärkan" → "Kv. Lärkan – Arkiverat 2026-11-25". Finns namnet redan (två arkiveringar samma dag)
    /// läggs (2), (3) … till. Ett tidigare arkivtillägg byts ut i stället för att läggas på igen.
    /// </summary>
    public static string Arkiverat(string namn, DateOnly datum, IEnumerable<string> upptagna)
    {
        var upptagen = upptagna.Select(Nyckel).ToHashSet();
        var tillagg = $" – Arkiverat {datum:yyyy-MM-dd}";
        var bas = UtanArkiv(namn);
        for (var i = 1; ; i++)
        {
            var slut = i == 1 ? tillagg : $"{tillagg} ({i})";
            var b = bas.Length + slut.Length > MaxLangd ? bas[..(MaxLangd - slut.Length)].TrimEnd() : bas;
            var forslag = b + slut;
            if (!upptagen.Contains(Nyckel(forslag))) return forslag;
        }
    }

    /// <summary>"Kv. Lärkan – Arkiverat 2026-11-25" → "Kv. Lärkan". Namn utan tillägg lämnas orörda.</summary>
    public static string UtanArkiv(string namn) => ArkivTillagg().Replace(namn.Trim(), "").TrimEnd();
}
