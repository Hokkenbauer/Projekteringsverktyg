using System.Reflection;
using Microsoft.EntityFrameworkCore;

namespace Projekteringsverktyg.Server.Data;

/// <summary>
/// Uppdaterar databasens struktur vid start. Varje fil i Data/Migreringar (001_..., 002_...)
/// körs en gång, i nummerordning, och noteras i tabellen schema_migrering.
/// Ny tabell eller kolumn = ny .sql-fil med nästa nummer. Ändra aldrig en fil som redan körts.
/// </summary>
public static class Migrering
{
    public static async Task KorAsync(PvDbContext db, ILogger logger, CancellationToken ct = default)
    {
        await db.Database.ExecuteSqlRawAsync(
            "CREATE TABLE IF NOT EXISTS schema_migrering (namn text PRIMARY KEY, kord timestamp with time zone NOT NULL DEFAULT now())", ct);

        var korda = (await db.Database
            .SqlQueryRaw<string>("SELECT namn AS \"Value\" FROM schema_migrering")
            .ToListAsync(ct)).ToHashSet();

        var assembly = Assembly.GetExecutingAssembly();
        var skript = assembly.GetManifestResourceNames()
            .Where(n => n.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .Select(n => (Resurs: n, Namn: FilNamn(n)))
            .OrderBy(s => s.Namn, StringComparer.Ordinal);

        foreach (var (resurs, namn) in skript)
        {
            if (korda.Contains(namn)) continue;

            using var lasare = new StreamReader(assembly.GetManifestResourceStream(resurs)!);
            var sql = await lasare.ReadToEndAsync(ct);

            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Database.ExecuteSqlRawAsync(Skydda(sql), ct);
            await db.Database.ExecuteSqlRawAsync("INSERT INTO schema_migrering (namn) VALUES ({0})", [namn], ct);
            await tx.CommitAsync(ct);
            logger.LogInformation("Databasmigrering körd: {Namn}", namn);
        }
    }

    /// <summary>
    /// EF Core läser {0}, {1} … i rå SQL som parametrar. Klamrar i själva skriptet (t.ex. '{}' för tom JSON)
    /// dubbleras därför så att de lämnas orörda.
    /// </summary>
    internal static string Skydda(string sql) => sql.Replace("{", "{{").Replace("}", "}}");

    /// <summary>"Projekteringsverktyg.Server.Data.Migreringar.002_att_gora.sql" → "002_att_gora.sql"</summary>
    internal static string FilNamn(string resurs)
    {
        var utanSql = resurs[..^4];
        var punkt = utanSql.LastIndexOf('.');
        return utanSql[(punkt + 1)..] + ".sql";
    }
}
