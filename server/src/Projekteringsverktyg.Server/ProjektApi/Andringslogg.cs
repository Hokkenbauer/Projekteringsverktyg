using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.ProjektApi;

public static class Andringslogg
{
    /// <summary>Lägger till en rad i ändringsloggen. Sparas tillsammans med ändringen (samma SaveChanges).</summary>
    public static void Logga(
        PvDbContext db, Guid projektId, Anvandare av, string entitet, Guid? entitetId,
        string beskrivning, string? falt = null, string? fore = null, string? efter = null)
    {
        db.Andringslogg.Add(new AndringsloggPost
        {
            ProjektId = projektId,
            AnvandarId = av.Id,
            AnvandarNamn = av.Namn,
            Entitet = entitet,
            EntitetId = entitetId,
            Beskrivning = beskrivning,
            Falt = falt,
            Fore = fore,
            Efter = efter,
        });
    }
}
