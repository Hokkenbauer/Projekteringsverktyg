using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.Auth;

/// <summary>
/// Vem är inloggad, vilken roll har hen och vad får hen göra.
/// Användaren registreras automatiskt vid första anropet. Finns ingen admin än blir den
/// första användaren admin, annars Tekniker tills en admin ändrar rollen.
/// </summary>
public sealed class Behorighet(PvDbContext db)
{
    private AnvandarPost? _aktuell;

    public async Task<AnvandarPost> AktuellAsync(ClaimsPrincipal user)
    {
        if (_aktuell is not null) return _aktuell;

        var anv = Anvandare.Fran(user);
        var epost = user.FindFirstValue("preferred_username") ?? user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? "";
        var post = await db.Anvandare.FindAsync(anv.Id);
        if (post is null)
        {
            var finnsAdmin = await db.Anvandare.AnyAsync(a => a.Roll == Roller.Admin);
            post = new AnvandarPost
            {
                Id = anv.Id,
                Namn = anv.Namn,
                Epost = epost,
                Roll = finnsAdmin ? Roller.Tekniker : Roller.Admin,
            };
            db.Anvandare.Add(post);
            await db.SaveChangesAsync();
        }
        else if (post.Namn != anv.Namn || (epost != "" && post.Epost != epost) || post.SenastInloggad < DateTimeOffset.UtcNow.AddMinutes(-10))
        {
            post.Namn = anv.Namn;
            if (epost != "") post.Epost = epost;
            post.SenastInloggad = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        }

        _aktuell = post;
        return post;
    }

    public async Task<bool> HarRoll(ClaimsPrincipal user, params string[] roller)
    {
        var roll = (await AktuellAsync(user)).Roll;
        return Array.IndexOf(roller, roll) >= 0;
    }

    public async Task<bool> KanLasa(ClaimsPrincipal user, Guid projektId)
    {
        var a = await AktuellAsync(user);
        if (Roller.SerAllaProjekt(a.Roll)) return true;
        return await db.Medlemmar.AnyAsync(m => m.ProjektId == projektId && m.AnvandarId == a.Id);
    }

    public async Task<bool> KanSkriva(ClaimsPrincipal user, Guid projektId)
    {
        var a = await AktuellAsync(user);
        return a.Roll != Roller.Lasare && await KanLasa(user, projektId);
    }

    /// <summary>Rättigheter som webbappen använder för att visa eller dölja knappar. Servern kontrollerar alltid själv.</summary>
    public static object Rattigheter(string roll) => new
    {
        skapaProjekt = roll is Roller.Admin or Roller.Projektledare,
        hanteraAnvandare = roll is Roller.Admin,
        hanteraMedlemmar = roll is Roller.Admin or Roller.Projektledare,
        redigeraStatusRubriker = roll is Roller.Admin,
        redigeraUnderrubriker = roll is Roller.Admin or Roller.Projektledare,
        redigeraKataloger = roll is Roller.Admin or Roller.System,
        seAnslutningsinformation = roll is Roller.Admin or Roller.Projektledare or Roller.System,
        skriva = roll is not Roller.Lasare,
    };
}

/// <summary>
/// Kontrollerar att användaren får läsa (GET) eller ändra (övriga) i projektet som adressen pekar på.
/// Läggs på alla API-grupper under /api/projekt/{projektId eller id}.
/// </summary>
public sealed class ProjektAtkomst : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var rv = ctx.HttpContext.Request.RouteValues;
        var raw = rv.TryGetValue("projektId", out var p) ? p : rv.TryGetValue("id", out var i) ? i : null;
        if (raw is null || !Guid.TryParse(raw.ToString(), out var projektId)) return await next(ctx);

        var beh = ctx.HttpContext.RequestServices.GetRequiredService<Behorighet>();
        var user = ctx.HttpContext.User;
        var lasning = HttpMethods.IsGet(ctx.HttpContext.Request.Method);

        if (!await beh.KanLasa(user, projektId))
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Du har inte tillgång till projektet.");
        if (!lasning && !await beh.KanSkriva(user, projektId))
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Du har bara läsbehörighet i projektet.");

        return await next(ctx);
    }
}
