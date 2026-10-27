using System.Text.Json;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DokumentApi;

namespace Projekteringsverktyg.Server.KomponentApi;

/// <summary>En produkt i produktregistret. Namnet (fabrikat + modell) är det som står i komponentens fält Produkt.</summary>
public sealed record Produkt(
    string Id, string Fabrikat, string Modell, string Komponenttyp, string Io, string StromA, string Fas,
    string Artikelnummer, string Leverantor, string Bedomning, string SundaHus, string Datablad, string Kommentar, bool Utgatt)
{
    public string Namn => $"{Fabrikat?.Trim()} {Modell?.Trim()}".Trim();
}

/// <summary>
/// Produktregistret (gemensam katalog "produkter", redigeras under Verktyg → Produktregister).
/// Väljs en produkt på en komponent fylls komponenttyp och I/O i om de är tomma, och Kraftberäkningen hämtar strömmen.
/// </summary>
public static class Produkter
{
    public const string Katalog = "produkter";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Register(List<Produkt>? Produkter);

    public static List<Produkt> Las(string json)
    {
        try { return (JsonSerializer.Deserialize<Register>(json, Json)?.Produkter ?? []).Where(p => p is not null).ToList(); }
        catch (JsonException) { return []; }
    }

    public static async Task<List<Produkt>> HamtaAsync(PvDbContext db) => Las(await GemensamKatalogEndpoints.HamtaData(db, Katalog));

    public static Produkt? Hitta(IEnumerable<Produkt> produkter, string namn)
    {
        var n = (namn ?? "").Trim();
        return n == "" ? null : produkter.FirstOrDefault(p => string.Equals(p.Namn, n, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Fyller i komponenttyp och I/O från produkten där de är tomma. Returnerar fälten som ändrades.</summary>
    public static List<string> FyllFran(Komponent k, Produkt p)
    {
        var andrade = new List<string>();
        if (k.Komponenttyp.Trim() == "" && (p.Komponenttyp ?? "").Trim() != "")
        {
            k.Komponenttyp = p.Komponenttyp!.Trim();
            andrade.Add("komponenttyp");
        }
        if (Signaler.Las(k).Count == 0 && (p.Io ?? "").Trim() != "")
        {
            Signaler.Satt(k, Signaler.Tolka(p.Io!.Trim()));
            andrade.Add("I/O");
        }
        return andrade;
    }

    /// <summary>Strömmen per fas till Kraftberäkningen: 3-fas = samma på L1–L3, annars bara L1. Tomt om strömmen saknas.</summary>
    public static Dictionary<string, string> Strom(Produkt p)
    {
        var a = (p.StromA ?? "").Trim().Replace(',', '.');
        if (a == "") return [];
        return (p.Fas ?? "").Trim() == "3"
            ? new() { ["l1"] = a, ["l2"] = a, ["l3"] = a }
            : new() { ["l1"] = a };
    }
}
