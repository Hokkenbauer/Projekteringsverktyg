using System.Reflection;
using System.Text.Json;

namespace Projekteringsverktyg.Server.Data;

/// <summary>
/// Valbara värden från dagens program (DATA\DropDowns). Används som grund i förslagslistor och
/// valkolumner; värden som skrivs in i projekten läggs till automatiskt i förslagen.
/// </summary>
public static class Grundkataloger
{
    private static readonly Dictionary<string, string[]> Alla = Las();

    private static Dictionary<string, string[]> Las()
    {
        var asm = Assembly.GetExecutingAssembly();
        var namn = asm.GetManifestResourceNames().First(n => n.EndsWith("Grundkataloger.json", StringComparison.Ordinal));
        using var s = asm.GetManifestResourceStream(namn)!;
        return JsonSerializer.Deserialize<Dictionary<string, string[]>>(s) ?? new();
    }

    public static string[] Hamta(string namn) => Alla.TryGetValue(namn, out var v) ? v : [];

    public static IReadOnlyDictionary<string, string[]> Samtliga => Alla;
}
