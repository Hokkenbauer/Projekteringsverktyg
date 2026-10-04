using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.KomponentApi;

/// <summary>
/// Vilka fält på en komponent som får ändras via API:t, och hur de läses och skrivs.
/// Allt som inte står här avvisas, så att ingen kan ändra t.ex. Id eller ProjektId.
/// </summary>
public static class KomponentFalt
{
    public const int MaxLangd = 2000;

    public static readonly IReadOnlyList<string> Tillatna =
    [
        "system", "beteckning", "komponenttyp", "signaltyp", "beskrivning",
        "anslutsTill", "kabeltyp", "placering", "ovrigt",
        "produkttyp", "produkt", "monteringsanvisning",
    ];

    public static bool ArTillatet(string falt) => Tillatna.Contains(falt);

    public static string Hamta(Komponent k, string falt) => falt switch
    {
        "system" => k.System,
        "beteckning" => k.Beteckning,
        "komponenttyp" => k.Komponenttyp,
        "signaltyp" => k.Signaltyp,
        "beskrivning" => k.Beskrivning,
        "anslutsTill" => k.AnslutsTill,
        "kabeltyp" => k.Kabeltyp,
        "placering" => k.Placering,
        "ovrigt" => k.Ovrigt,
        "produkttyp" => k.Produkttyp,
        "produkt" => k.Produkt,
        "monteringsanvisning" => k.Monteringsanvisning,
        _ => throw new ArgumentException($"Okänt fält: {falt}", nameof(falt)),
    };

    public static void Satt(Komponent k, string falt, string varde)
    {
        varde = (varde ?? "").Trim();
        if (varde.Length > MaxLangd) varde = varde[..MaxLangd];
        switch (falt)
        {
            case "system": k.System = varde; break;
            case "beteckning": k.Beteckning = varde; break;
            case "komponenttyp": k.Komponenttyp = varde; break;
            case "signaltyp": k.Signaltyp = varde; break;
            case "beskrivning": k.Beskrivning = varde; break;
            case "anslutsTill": k.AnslutsTill = varde; break;
            case "kabeltyp": k.Kabeltyp = varde; break;
            case "placering": k.Placering = varde; break;
            case "ovrigt": k.Ovrigt = varde; break;
            case "produkttyp": k.Produkttyp = varde; break;
            case "produkt": k.Produkt = varde; break;
            case "monteringsanvisning": k.Monteringsanvisning = varde; break;
            default: throw new ArgumentException($"Okänt fält: {falt}", nameof(falt));
        }
    }
}
