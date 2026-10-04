using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.KomponentApi;

/// <summary>
/// Förslagslistor för komponentfälten. Listorna byggs automatiskt av allt som redan skrivits in i
/// något projekt (vanligast först), plus en liten grundlista. Inget behöver matas in för hand:
/// skriver någon in en ny produkt finns den som förslag nästa gång, i alla projekt.
/// </summary>
public static class KatalogEndpoints
{
    public static readonly string[] Falt = ["system", "komponenttyp", "signaltyp", "kabeltyp", "produkttyp", "produkt", "placering"];

    /// <summary>Grundlistor från dagens program per komponentfält. Produkt visas som Fabrikat.</summary>
    private static readonly Dictionary<string, string[]> Grund = new()
    {
        ["system"] = Grundkataloger.Hamta("KomponentSystem"),
        ["komponenttyp"] = Grundkataloger.Hamta("KomponentTyp"),
        ["signaltyp"] = Grundkataloger.Hamta("KomponentSignaltyp"),
        ["kabeltyp"] = Grundkataloger.Hamta("KomponentKabeltyp"),
        ["produkttyp"] = Grundkataloger.Hamta("KomponentProdukttyp"),
        ["produkt"] = Grundkataloger.Hamta("FabrikatTyp"),
    };

    public static IEndpointRouteBuilder MapKatalogEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/kataloger", async (PvDbContext db) =>
        {
            var ut = new Dictionary<string, List<string>>();
            foreach (var falt in Falt)
            {
                var anvanda = await (falt switch
                {
                    "system" => db.Komponenter.Select(k => k.System),
                    "komponenttyp" => db.Komponenter.Select(k => k.Komponenttyp),
                    "signaltyp" => db.Komponenter.Select(k => k.Signaltyp),
                    "kabeltyp" => db.Komponenter.Select(k => k.Kabeltyp),
                    "produkttyp" => db.Komponenter.Select(k => k.Produkttyp),
                    "produkt" => db.Komponenter.Select(k => k.Produkt),
                    _ => db.Komponenter.Select(k => k.Placering),
                })
                    .Where(v => v != "")
                    .GroupBy(v => v)
                    .Select(g => new { Varde = g.Key, Antal = g.Count() })
                    .OrderByDescending(x => x.Antal).ThenBy(x => x.Varde)
                    .Take(1000)
                    .ToListAsync();

                var lista = new List<string>();
                var sett = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var v in anvanda.Select(a => a.Varde.Trim()).Concat(Grund.GetValueOrDefault(falt) ?? []))
                    if (v != "" && sett.Add(v)) lista.Add(v);
                ut[falt] = lista;
            }
            return ut;
        });
        return app;
    }
}
