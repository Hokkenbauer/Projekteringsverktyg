using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.AnvandarApi;

public sealed record NyInbjudan(string Epost, string? Namn, string? Roll, List<Guid>? ProjektIds);
public sealed record InbjudanProjekt(Guid Id, string Namn);
public sealed record InbjudanDto(Guid Id, string Epost, string Namn, string Roll, List<InbjudanProjekt> Projekt, string Status,
    string Meddelande, DateTimeOffset Skapad, string SkapadAv, DateTimeOffset? Accepterad);
public sealed record InbjudanSvar(InbjudanDto Inbjudan, bool Skickad, string Meddelande);

/// <summary>Svar från Microsoft på en gästinbjudan.</summary>
public sealed record GastSvar(bool Ok, string GastId, string Meddelande);

/// <summary>Skickar en gästinbjudan i HECO:s Microsoft Entra ID (eller låtsas, i tester och utveckling).</summary>
public interface IGastInbjudan
{
    Task<GastSvar> BjudInAsync(string epost, string namn, string tillbakaUrl, string meddelande, CancellationToken ct);
}

/// <summary>
/// Microsoft Graph: POST /invitations. Personen får ett mejl från Microsoft och loggar sedan in med sitt eget
/// jobbkonto (eller en engångskod på mejlen om hen inte har Microsoft 365).
/// Kräver att appregistreringen har applikationsbehörigheten User.Invite.All med administratörsgodkännande, och
/// en klienthemlighet i AzureAd:ClientSecret (annars används serverns hanterade identitet om den har behörigheten).
/// </summary>
public sealed class GraphGastInbjudan(IConfiguration config, IHttpClientFactory http, ILogger<GraphGastInbjudan> log) : IGastInbjudan
{
    /// <summary>Inloggningen mot Microsoft och en beskrivning av vilken som används (för felmeddelanden).</summary>
    private (TokenCredential? Cred, string Satt) Credential()
    {
        var tenant = config["AzureAd:TenantId"];
        var klient = config["AzureAd:ClientId"];
        var hemlighet = config["AzureAd:ClientSecret"] ?? config["Graph:ClientSecret"];
        if (string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(klient)) return (null, "");
        return !string.IsNullOrWhiteSpace(hemlighet)
            ? (new ClientSecretCredential(tenant, klient, hemlighet.Trim()), $"klienthemligheten för appen {klient[..Math.Min(8, klient.Length)]}…")
            : (new DefaultAzureCredential(), "serverns hanterade identitet (AzureAd__ClientSecret saknas i serverns miljövariabler)");
    }

    /// <summary>Behörigheterna (roles) i en åtkomsttoken, för att kunna säga exakt vad som saknas.</summary>
    private static List<string> TokenRoller(string token)
    {
        try
        {
            var del = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
            del = del.PadRight(del.Length + (4 - del.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Convert.FromBase64String(del));
            return doc.RootElement.TryGetProperty("roles", out var r) && r.ValueKind == JsonValueKind.Array
                ? r.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : [];
        }
        catch (Exception) { return []; }
    }

    public async Task<GastSvar> BjudInAsync(string epost, string namn, string tillbakaUrl, string meddelande, CancellationToken ct)
    {
        var (cred, satt) = Credential();
        if (cred is null) return new GastSvar(false, "", "Inloggning via Microsoft är inte inställd på servern.");
        string token;
        try { token = (await cred.GetTokenAsync(new TokenRequestContext(["https://graph.microsoft.com/.default"]), ct)).Token; }
        catch (Exception e)
        {
            log.LogWarning(e, "Ingen token till Microsoft Graph");
            return new GastSvar(false, "", $"Servern kunde inte logga in mot Microsoft med {satt}: {e.Message.Split('\n')[0]}");
        }
        var roller = TokenRoller(token);
        if (!roller.Contains("User.Invite.All"))
            return new GastSvar(false, "", $"Servern loggar in med {satt}, men den inloggningen har inte behörigheten User.Invite.All"
                + (roller.Count > 0 ? $" (har bara: {string.Join(", ", roller)})." : ". Kontrollera att behörigheten är beviljad på samma app som AzureAd__ClientId pekar på, och vänta några minuter efter att den beviljats."));

        var klient = http.CreateClient("graph");
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://graph.microsoft.com/v1.0/invitations")
        {
            Content = JsonContent.Create(new
            {
                invitedUserEmailAddress = epost,
                invitedUserDisplayName = namn,
                inviteRedirectUrl = tillbakaUrl,
                sendInvitationMessage = true,
                invitedUserMessageInfo = new { customizedMessageBody = meddelande },
            }),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var svar = await klient.SendAsync(req, ct);
        var text = await svar.Content.ReadAsStringAsync(ct);
        if (svar.IsSuccessStatusCode)
        {
            try
            {
                using var doc = JsonDocument.Parse(text);
                var id = doc.RootElement.TryGetProperty("invitedUser", out var u) && u.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
                return new GastSvar(true, id, "Inbjudan skickad från Microsoft.");
            }
            catch (JsonException) { return new GastSvar(true, "", "Inbjudan skickad från Microsoft."); }
        }
        log.LogWarning("Gästinbjudan misslyckades {Status}: {Text}", (int)svar.StatusCode, text);
        var fel = "";
        try { using var doc = JsonDocument.Parse(text); fel = doc.RootElement.GetProperty("error").GetProperty("message").GetString() ?? ""; }
        catch (Exception) { /* inget läsbart fel */ }
        return svar.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.Unauthorized
            ? new GastSvar(false, "", $"Microsoft nekade inbjudan ({(int)svar.StatusCode}) trots behörigheten User.Invite.All: {fel}. Kontrollera inställningarna för externt samarbete i Entra ID.")
            : new GastSvar(false, "", $"Microsoft kunde inte skicka inbjudan: {fel}".Trim());
    }
}

/// <summary>Används när Microsoft-inloggning inte är påslagen (utveckling och tester): inget mejl skickas.</summary>
public sealed class IngenGastInbjudan : IGastInbjudan
{
    public Task<GastSvar> BjudInAsync(string epost, string namn, string tillbakaUrl, string meddelande, CancellationToken ct) =>
        Task.FromResult(new GastSvar(false, "", "Microsoft-inloggning är inte påslagen här, så inget mejl skickades."));
}

/// <summary>Inbjudningar av externa deltagare och hur de tillämpas vid första inloggningen.</summary>
public static class Inbjudningar
{
    /// <summary>Roller som en projektledare får bjuda in. Admin får bjuda in alla utom Admin.</summary>
    private static readonly string[] ProjektledarRoller = [Roller.Lasare, Roller.Tekniker];

    public static string Normalisera(string epost) => (epost ?? "").Trim().ToLowerInvariant();

    /// <summary>
    /// E-postadresser som inloggningen kan ha för personen. En gäst har ofta användarnamnet
    /// "namn_foretaget.se#EXT#@heco.onmicrosoft.com", som motsvarar namn@foretaget.se.
    /// </summary>
    public static HashSet<string> EpostFran(ClaimsPrincipal user)
    {
        var ut = new HashSet<string>();
        foreach (var typ in new[] { "preferred_username", "email", "upn", ClaimTypes.Email, ClaimTypes.Upn, ClaimTypes.Name })
        {
            var v = Normalisera(user.FindFirstValue(typ) ?? "");
            if (!v.Contains('@')) continue;
            ut.Add(v);
            var ext = v.IndexOf("#ext#", StringComparison.Ordinal);
            if (ext > 0)
            {
                var lokal = v[..ext];
                var i = lokal.LastIndexOf('_');
                if (i > 0) ut.Add(lokal[..i] + "@" + lokal[(i + 1)..]);
            }
        }
        return ut;
    }

    /// <summary>
    /// Ger personen rollen och projekten från väntande inbjudningar som matchar e-post eller gäst-Id.
    /// Returnerar true om något ändrades (anroparen sparar).
    /// </summary>
    public static async Task<bool> TillampaAsync(PvDbContext db, AnvandarPost post, IReadOnlyCollection<string> epost, bool nyAnvandare, CancellationToken ct = default)
    {
        if (epost.Count == 0 && post.Id == "") return false;
        var lista = await db.Inbjudningar
            .Where(i => i.Status == "Vantar" && (epost.Contains(i.Epost) || (i.GastId != "" && i.GastId == post.Id)))
            .ToListAsync(ct);
        if (lista.Count == 0) return false;

        foreach (var inb in lista.OrderBy(i => i.Skapad))
        {
            // Nya användare får inbjudans roll. En befintlig användare behåller en roll som ser mer.
            if (nyAnvandare || Rang(inb.Roll) > Rang(post.Roll)) post.Roll = inb.Roll;
            foreach (var pid in inb.Projekt())
            {
                if (!await db.Projekt.AnyAsync(p => p.Id == pid, ct)) continue;
                var finns = await db.Medlemmar.AnyAsync(m => m.ProjektId == pid && m.AnvandarId == post.Id, ct)
                    || db.Medlemmar.Local.Any(m => m.ProjektId == pid && m.AnvandarId == post.Id);
                if (finns) continue;
                db.Medlemmar.Add(new ProjektMedlem { ProjektId = pid, AnvandarId = post.Id, TillagdAv = $"Inbjudan från {inb.SkapadAv}" });
                Andringslogg.Logga(db, pid, new Anvandare(post.Id, post.Namn), "Medlem", null, $"{post.Namn} tackade ja till inbjudan och lades till i projektet");
            }
            inb.Status = "Accepterad";
            inb.Accepterad = DateTimeOffset.UtcNow;
            inb.AnvandarId = post.Id;
        }
        return true;
    }

    private static int Rang(string roll) => roll switch
    {
        Roller.Admin => 5, Roller.Projektledare => 4, Roller.System => 3, Roller.Tekniker => 2, _ => 1,
    };

    private static async Task<List<InbjudanDto>> Dtos(PvDbContext db, IEnumerable<Inbjudan> lista)
    {
        var l = lista.ToList();
        var ids = l.SelectMany(i => i.Projekt()).Distinct().ToList();
        var namn = await db.Projekt.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Namn);
        return l.Select(i => new InbjudanDto(i.Id, i.Epost, i.Namn, i.Roll,
            i.Projekt().Where(namn.ContainsKey).Select(p => new InbjudanProjekt(p, namn[p])).ToList(),
            i.Status, i.Meddelande, i.Skapad, i.SkapadAv, i.Accepterad)).ToList();
    }

    private static string TillbakaUrl(HttpContext ctx) => $"{ctx.Request.Scheme}://{ctx.Request.Host}/";

    private static string Mejltext(string av) =>
        $"{av} på HECO Automation bjuder in dig till Projekteringsverktyget. Acceptera inbjudan och logga in med ditt vanliga jobbkonto (eller med en engångskod som skickas till din e-post).";

    private static IResult Fel(string falt, string text) => Results.ValidationProblem(new Dictionary<string, string[]> { [falt] = [text] });

    public static IEndpointRouteBuilder MapInbjudanEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/inbjudningar");

        g.MapGet("/", async (Guid? projektId, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var lista = await db.Inbjudningar.OrderByDescending(i => i.Skapad).Take(500).ToListAsync();
            if (projektId is { } pid) lista = lista.Where(i => i.Projekt().Contains(pid)).ToList();
            return Results.Ok(await Dtos(db, lista));
        });

        g.MapPost("/", async (NyInbjudan ny, HttpContext ctx, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IGastInbjudan gast, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var mig = await beh.AktuellAsync(user);
            var epost = Normalisera(ny.Epost);
            if (epost.Length > 254 || !System.Text.RegularExpressions.Regex.IsMatch(epost, @"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$"))
                return Fel("epost", "Skriv en giltig e-postadress, t.ex. namn@foretaget.se.");
            var roll = string.IsNullOrWhiteSpace(ny.Roll) ? Roller.Lasare : ny.Roll.Trim();
            if (!Roller.Alla.Contains(roll) || roll == Roller.Admin) return Fel("roll", "Välj Läsare, Tekniker, System eller Projektledare.");
            if (mig.Roll != Roller.Admin && !ProjektledarRoller.Contains(roll)) return Fel("roll", "Projektledare kan bjuda in Läsare och Tekniker. Be en admin om andra roller.");
            var projekt = (ny.ProjektIds ?? []).Distinct().ToList();
            var finnsProjekt = await db.Projekt.Where(p => projekt.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
            if (finnsProjekt.Count == 0) return Fel("projekt", "Välj minst ett projekt.");
            var namn = (ny.Namn ?? "").Trim();
            if (namn.Length > 120) namn = namn[..120];
            var av = Anvandare.Fran(user);

            // Har personen redan loggat in: lägg till direkt, ingen inbjudan behövs.
            var befintlig = await db.Anvandare.FirstOrDefaultAsync(a => a.Epost.ToLower() == epost, ct);
            if (befintlig is not null)
            {
                foreach (var pid in finnsProjekt)
                    if (!await db.Medlemmar.AnyAsync(m => m.ProjektId == pid && m.AnvandarId == befintlig.Id, ct))
                    {
                        db.Medlemmar.Add(new ProjektMedlem { ProjektId = pid, AnvandarId = befintlig.Id, TillagdAv = av.Namn });
                        Andringslogg.Logga(db, pid, av, "Medlem", null, $"lade till {befintlig.Namn} i projektet");
                    }
                await db.SaveChangesAsync(ct);
                var direkt = new Inbjudan { Epost = epost, Namn = befintlig.Namn, Roll = befintlig.Roll, ProjektIds = string.Join(",", finnsProjekt), Status = "Accepterad", Accepterad = DateTimeOffset.UtcNow, SkapadAv = av.Namn, AnvandarId = befintlig.Id };
                return Results.Ok(new InbjudanSvar((await Dtos(db, [direkt]))[0], false,
                    $"{befintlig.Namn} har redan ett konto och lades till direkt. Rollen ({befintlig.Roll}) ändras under Admin."));
            }

            // Väntande inbjudan till samma adress: lägg till projekten i den i stället för att skapa en ny.
            var inb = await db.Inbjudningar.FirstOrDefaultAsync(i => i.Epost == epost && i.Status == "Vantar", ct);
            var nyInb = inb is null;
            inb ??= new Inbjudan { Epost = epost, SkapadAv = av.Namn };
            inb.Namn = namn != "" ? namn : inb.Namn;
            inb.Roll = roll;
            inb.ProjektIds = string.Join(",", inb.Projekt().Concat(finnsProjekt).Distinct());
            if (nyInb) db.Inbjudningar.Add(inb);

            var svar = await gast.BjudInAsync(epost, inb.Namn == "" ? epost : inb.Namn, TillbakaUrl(ctx), Mejltext(av.Namn), ct);
            if (svar.GastId != "") inb.GastId = svar.GastId;
            inb.Meddelande = svar.Meddelande;
            foreach (var pid in finnsProjekt)
                Andringslogg.Logga(db, pid, av, "Medlem", null, $"bjöd in {(inb.Namn == "" ? epost : $"{inb.Namn} ({epost})")} som {roll}");
            await db.SaveChangesAsync(ct);
            return Results.Ok(new InbjudanSvar((await Dtos(db, [inb]))[0], svar.Ok, svar.Meddelande));
        });

        g.MapPost("/{id:guid}/skicka-igen", async (Guid id, HttpContext ctx, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IGastInbjudan gast, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var inb = await db.Inbjudningar.FirstOrDefaultAsync(i => i.Id == id, ct);
            if (inb is null || inb.Status != "Vantar") return Results.NotFound();
            var av = Anvandare.Fran(user);
            var svar = await gast.BjudInAsync(inb.Epost, inb.Namn == "" ? inb.Epost : inb.Namn, TillbakaUrl(ctx), Mejltext(av.Namn), ct);
            if (svar.GastId != "") inb.GastId = svar.GastId;
            inb.Meddelande = svar.Meddelande;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new InbjudanSvar((await Dtos(db, [inb]))[0], svar.Ok, svar.Meddelande));
        });

        // Lägg till ett projekt i en väntande inbjudan (personen har inte loggat in än). Inget nytt mejl skickas.
        g.MapPost("/{id:guid}/projekt/{projektId:guid}", async (Guid id, Guid projektId, ClaimsPrincipal user, Behorighet beh, PvDbContext db, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var inb = await db.Inbjudningar.FirstOrDefaultAsync(i => i.Id == id, ct);
            if (inb is null || inb.Status != "Vantar") return Results.NotFound();
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId, ct)) return Results.NotFound();
            if (!inb.Projekt().Contains(projektId))
            {
                inb.ProjektIds = string.Join(",", inb.Projekt().Append(projektId));
                Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null,
                    $"lade till {(inb.Namn == "" ? inb.Epost : $"{inb.Namn} ({inb.Epost})")} i projektet (inbjuden, har inte loggat in än)");
                await db.SaveChangesAsync(ct);
            }
            return Results.Ok((await Dtos(db, [inb]))[0]);
        });

        // Ta bort ett projekt ur en väntande inbjudan. Finns inga projekt kvar tas inbjudan bort.
        g.MapDelete("/{id:guid}/projekt/{projektId:guid}", async (Guid id, Guid projektId, ClaimsPrincipal user, Behorighet beh, PvDbContext db, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var inb = await db.Inbjudningar.FirstOrDefaultAsync(i => i.Id == id, ct);
            if (inb is null || inb.Status != "Vantar") return Results.NoContent();
            var kvar = inb.Projekt().Where(p => p != projektId).ToList();
            if (await db.Projekt.AnyAsync(p => p.Id == projektId, ct))
                Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null, $"tog bort inbjudan till {inb.Epost} från projektet");
            if (kvar.Count == 0) db.Inbjudningar.Remove(inb);
            else inb.ProjektIds = string.Join(",", kvar);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var inb = await db.Inbjudningar.FirstOrDefaultAsync(i => i.Id == id, ct);
            if (inb is null) return Results.NoContent();
            if (inb.Status != "Vantar") return Fel("inbjudan", "Inbjudan är redan accepterad. Ta bort personen ur projektet i stället.");
            var av = Anvandare.Fran(user);
            foreach (var pid in inb.Projekt())
                if (await db.Projekt.AnyAsync(p => p.Id == pid, ct))
                    Andringslogg.Logga(db, pid, av, "Medlem", null, $"tog tillbaka inbjudan till {inb.Epost}");
            db.Inbjudningar.Remove(inb);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        return app;
    }
}
