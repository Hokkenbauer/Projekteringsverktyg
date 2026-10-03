using Microsoft.EntityFrameworkCore;

namespace Projekteringsverktyg.Server.Data;

public class PvDbContext(DbContextOptions<PvDbContext> options) : DbContext(options)
{
    public DbSet<Projekt> Projekt => Set<Projekt>();
    public DbSet<Komponent> Komponenter => Set<Komponent>();
    public DbSet<AndringsloggPost> Andringslogg => Set<AndringsloggPost>();
    public DbSet<AnvandarInstallning> AnvandarInstallningar => Set<AnvandarInstallning>();
    public DbSet<AttGoraPost> AttGora => Set<AttGoraPost>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Projekt>(e =>
        {
            e.ToTable("projekt");
            e.HasKey(p => p.Id);
            e.Property(p => p.Namn).HasMaxLength(200);
            e.Property(p => p.Nummer).HasMaxLength(50);
            e.HasMany(p => p.Komponenter).WithOne(k => k.Projekt!).HasForeignKey(k => k.ProjektId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Komponent>(e =>
        {
            e.ToTable("komponent");
            e.HasKey(k => k.Id);
            e.HasIndex(k => k.ProjektId);
            e.HasIndex(k => new { k.ProjektId, k.Beteckning });
            e.Property(k => k.Version).IsConcurrencyToken();
        });

        b.Entity<AndringsloggPost>(e =>
        {
            e.ToTable("andringslogg");
            e.HasKey(a => a.Id);
            e.HasIndex(a => new { a.ProjektId, a.Tidpunkt });
            e.HasIndex(a => a.EntitetId);
        });

        b.Entity<AttGoraPost>(e =>
        {
            e.ToTable("att_gora");
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.ProjektId);
            e.Property(a => a.Version).IsConcurrencyToken();
        });

        b.Entity<AnvandarInstallning>(e =>
        {
            e.ToTable("anvandarinstallning");
            e.HasKey(a => a.AnvandarId);
        });
    }
}
