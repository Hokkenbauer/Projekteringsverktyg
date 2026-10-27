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
        "produkttyp", "produkt", "monteringsanvisning", "signaler", "installningar",
    ];

    public const int MaxLangdInstallningar = 20000;

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
        "installningar" => k.Installningar,
        "signaler" => System.Text.Json.JsonSerializer.Serialize(Signaler.Las(k), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)),
        _ => throw new ArgumentException($"Okänt fält: {falt}", nameof(falt)),
    };

    /// <summary>Värdet som visas i ändringsloggen (I/O-punkterna som sammanfattning, inte som JSON).</summary>
    public static string LoggVarde(Komponent k, string falt) => falt == "signaler" ? k.Signaltyp : Hamta(k, falt);

    public static void Satt(Komponent k, string falt, string varde)
    {
        varde = (varde ?? "").Trim();
        // I/O-punkterna: JSON-listan sparas och Signaltyp blir sammanfattningen. Kortform ("2DI DU AO") går också.
        if (falt == "signaler")
        {
            Signaler.Satt(k, varde.StartsWith('[') ? Signaler.LasJson(varde) : Signaler.Tolka(varde));
            return;
        }
        // Inställningarna ska vara ett JSON-objekt (t.ex. gatewayens portar).
        if (falt == "installningar")
        {
            if (varde.Length > MaxLangdInstallningar) throw new ArgumentException("Inställningarna är för stora.");
            if (varde != "")
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(varde);
                    if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object) throw new ArgumentException("Inställningarna måste vara ett objekt.");
                }
                catch (System.Text.Json.JsonException) { throw new ArgumentException("Inställningarna kunde inte läsas."); }
            }
            k.Installningar = varde;
            return;
        }
        if (varde.Length > MaxLangd) varde = varde[..MaxLangd];
        switch (falt)
        {
            case "system": k.System = varde; break;
            case "beteckning": k.Beteckning = varde; break;
            case "komponenttyp": k.Komponenttyp = varde; break;
            case "signaltyp":
                // Skrivs signaltypen som text (tabell, import, mall) tolkas I/O-punkterna ur den.
                if (varde == "") { k.Signaltyp = ""; k.Signaler = ""; }
                else Signaler.Satt(k, Signaler.Tolka(varde));
                break;
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
