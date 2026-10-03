using System.Security.Claims;

namespace Projekteringsverktyg.Server.Auth;

/// <summary>Den inloggade användaren, utläst ur inloggningens claims.</summary>
public sealed record Anvandare(string Id, string Namn)
{
    private const string OidClaim = "http://schemas.microsoft.com/identity/claims/objectidentifier";

    public static Anvandare Fran(ClaimsPrincipal user)
    {
        var id = user.FindFirstValue("oid")
                 ?? user.FindFirstValue(OidClaim)
                 ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
                 ?? "okand";
        var namn = user.FindFirstValue("name")
                   ?? user.Identity?.Name
                   ?? user.FindFirstValue("preferred_username")
                   ?? "Okänd användare";
        return new Anvandare(id, namn);
    }
}
