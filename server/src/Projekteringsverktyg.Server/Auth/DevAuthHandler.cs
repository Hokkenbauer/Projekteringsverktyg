using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Projekteringsverktyg.Server.Auth;

/// <summary>
/// Inloggning för lokal utveckling när Entra ID inte är konfigurerat.
/// Användarnamnet tas från "Authorization: Bearer &lt;namn&gt;" eller ?access_token=&lt;namn&gt;,
/// så att man kan prova flera användare i olika webbläsarflikar.
/// Används ALDRIG utanför utvecklingsmiljön (se Program.cs).
/// </summary>
public sealed class DevAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Schema = "Utveckling";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        string? namn = null;
        var header = Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            namn = header["Bearer ".Length..].Trim();
        if (string.IsNullOrWhiteSpace(namn))
            namn = Request.Query["access_token"].ToString();
        if (string.IsNullOrWhiteSpace(namn))
            namn = "Utvecklare";

        var id = "dev-" + namn.ToLowerInvariant().Replace(' ', '-');
        var identity = new ClaimsIdentity(
        [
            new Claim("oid", id),
            new Claim("name", namn),
        ], Schema, "name", ClaimTypes.Role);

        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), Schema)));
    }
}
