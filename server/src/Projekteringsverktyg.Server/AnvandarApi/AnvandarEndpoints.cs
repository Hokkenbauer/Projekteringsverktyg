using System.Security.Claims;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.AnvandarApi;

public sealed record MigDto(string Id, string Namn, string Tema);
public sealed record TemaVal(string Tema);

public static class AnvandarEndpoints
{
    public static readonly IReadOnlySet<string> Teman =
        new HashSet<string> { "system", "natt", "dag", "grafit", "fjall" };

    public static IEndpointRouteBuilder MapAnvandarEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/mig", async (ClaimsPrincipal user, PvDbContext db) =>
        {
            var av = Anvandare.Fran(user);
            var inst = await db.AnvandarInstallningar.FindAsync(av.Id);
            return new MigDto(av.Id, av.Namn, inst?.Tema ?? "natt");
        });

        app.MapPut("/api/mig/tema", async (TemaVal val, ClaimsPrincipal user, PvDbContext db) =>
        {
            if (!Teman.Contains(val.Tema))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["tema"] = ["Okänt tema."] });

            var av = Anvandare.Fran(user);
            var inst = await db.AnvandarInstallningar.FindAsync(av.Id);
            if (inst is null)
            {
                inst = new AnvandarInstallning { AnvandarId = av.Id };
                db.AnvandarInstallningar.Add(inst);
            }
            inst.Tema = val.Tema;
            await db.SaveChangesAsync();
            return Results.Ok(new MigDto(av.Id, av.Namn, inst.Tema));
        });

        return app;
    }
}
