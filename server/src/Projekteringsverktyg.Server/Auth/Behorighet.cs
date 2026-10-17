using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.Auth;

/// <summary>
/// Vem är inloggad och vad får hen göra. Två nivåer:
/// verktygsroll (Admin, Intern, Extern) och projektroll per projekt (Projektledare, Tekniker, Läsare).
/// Användaren registreras automatiskt vid första anropet. Finns ingen admin än blir den första admin.
/// En gäst från ett annat företag (eller en inbjuden) blir Extern, övriga Intern.
/// </summary>
public sealed class Behorighet(PvDbContext db)
{
    private AnvandarPost? _aktuell;
    private readonly Dictionary<Guid, string?> _projektRoller = new();

    public async Task<AnvandarPost> AktuellAsync(ClaimsPrincipal user)
    {
        if (_aktuell is not null) return _aktuell;

        var anv = Anvandare.Fran(user);
        var epost = user.FindFirstValue("preferred_username") ?? user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? "";
        var post = await db.Anvandare.FindAsync(anv.Id);
        if (post is null)
        {
            var finnsAdmin = await db.Anvandare.AnyAsync(a => a.Roll == Roller.Admin);
            var adresser = AnvandarApi.Inbjudningar.EpostFran(user);
            // "idp" finns bara i token för konton från ett annat företag (gäster).
            var gast = user.FindFirstValue("idp") is { Length: > 0 }
                || user.FindFirstValue("http://schemas.microsoft.com/identity/claims/identityprovider") is { Length: > 0 };
            var inbjuden = await AnvandarApi.Inbjudningar.HarVantandeAsync(db, anv.Id, adresser);
            post = new AnvandarPost
            {
                Id = anv.Id,
                Namn = anv.Namn,
                Epost = epost,
                Roll = !finnsAdmin ? Roller.Admin : gast || inbjuden ? Roller.Extern : Roller.Intern,
            };
            db.Anvandare.Add(post);
            // Inbjuden: medlem i projekten med inbjudans projektroll.
            if (finnsAdmin) await AnvandarApi.Inbjudningar.TillampaAsync(db, post, adresser);
            await db.SaveChangesAsync();
        }
        else if (post.Namn != anv.Namn || (epost != "" && post.Epost != epost) || post.SenastInloggad < DateTimeOffset.UtcNow.AddMinutes(-10))
        {
            post.Namn = anv.Namn;
            if (epost != "") post.Epost = epost;
            post.SenastInloggad = DateTimeOffset.UtcNow;
            // En befintlig användare kan ha bjudits in till fler projekt sedan sist.
            await AnvandarApi.Inbjudningar.TillampaAsync(db, post, AnvandarApi.Inbjudningar.EpostFran(user));
            await db.SaveChangesAsync();
        }

        _aktuell = post;
        return post;
    }

    /// <summary>Verktygsroll (Admin, Intern, Extern).</summary>
    public async Task<bool> HarRoll(ClaimsPrincipal user, params string[] roller)
    {
        var roll = (await AktuellAsync(user)).Roll;
        return Array.IndexOf(roller, roll) >= 0;
    }

    public async Task<bool> ArAdmin(ClaimsPrincipal user) => (await AktuellAsync(user)).Roll == Roller.Admin;

    public async Task<bool> KanSkapaProjekt(ClaimsPrincipal user) => FarSkapaProjekt(await AktuellAsync(user));
    public static bool FarSkapaProjekt(AnvandarPost a) => a.Roll is Roller.Admin or Roller.Intern || a.FarSkapaProjekt;

    /// <summary>Gemensamma kataloger, mallar, korttyper, verktyg och Ritbordets inställningar.</summary>
    public async Task<bool> KanAndraMallar(ClaimsPrincipal user) => FarAndraMallar(await AktuellAsync(user));
    public static bool FarAndraMallar(AnvandarPost a) => a.Roll == Roller.Admin || a.FarAndraMallar;

    /// <summary>
    /// Personens roll i projektet: Admin räknas som Projektledare, medlemmar har sin projektroll,
    /// interna som inte är medlemmar är Läsare, externa som inte är medlemmar har ingen (null = ingen åtkomst).
    /// </summary>
    public async Task<string?> ProjektRoll(ClaimsPrincipal user, Guid projektId)
    {
        if (_projektRoller.TryGetValue(projektId, out var sparad)) return sparad;
        var a = await AktuellAsync(user);
        string? roll;
        if (a.Roll == Roller.Admin) roll = Roller.Projektledare;
        else
        {
            var m = await db.Medlemmar.AsNoTracking().FirstOrDefaultAsync(x => x.ProjektId == projektId && x.AnvandarId == a.Id);
            roll = m?.Roll ?? (Roller.SerAllaProjekt(a.Roll) ? Roller.Lasare : null);
        }
        _projektRoller[projektId] = roll;
        return roll;
    }

    public async Task<bool> KanLasa(ClaimsPrincipal user, Guid projektId) => await ProjektRoll(user, projektId) is not null;
    public async Task<bool> KanSkriva(ClaimsPrincipal user, Guid projektId) => Roller.KanAndra(await ProjektRoll(user, projektId));
    /// <summary>Projektledare i projektet (eller Admin): medlemmar, inbjudningar, anslutningsinformation m.m.</summary>
    public async Task<bool> KanLedaProjekt(ClaimsPrincipal user, Guid projektId) => await ProjektRoll(user, projektId) == Roller.Projektledare;

    /// <summary>Rättigheter i hela verktyget (webbappen visar eller döljer knappar; servern kontrollerar alltid själv).</summary>
    public static object Rattigheter(AnvandarPost a) => new
    {
        skapaProjekt = FarSkapaProjekt(a),
        hanteraAnvandare = a.Roll == Roller.Admin,
        redigeraStatusRubriker = a.Roll == Roller.Admin,
        redigeraKataloger = FarAndraMallar(a),
        hanteraMallar = FarAndraMallar(a),
        // Gäller ett visst projekt; webbappen hämtar dem per projekt (/api/projekt/{id}/min-roll).
        hanteraMedlemmar = false,
        redigeraUnderrubriker = false,
        seAnslutningsinformation = false,
        skriva = false,
    };

    /// <summary>Rättigheter i ett projekt utifrån projektrollen.</summary>
    public static object ProjektRattigheter(string? projektroll) => new
    {
        projektRoll = projektroll,
        hanteraMedlemmar = projektroll == Roller.Projektledare,
        redigeraUnderrubriker = projektroll == Roller.Projektledare,
        seAnslutningsinformation = projektroll == Roller.Projektledare,
        skriva = Roller.KanAndra(projektroll),
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
