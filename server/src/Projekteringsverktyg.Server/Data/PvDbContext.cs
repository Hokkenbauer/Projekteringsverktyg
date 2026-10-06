using Microsoft.EntityFrameworkCore;

namespace Projekteringsverktyg.Server.Data;

public class PvDbContext(DbContextOptions<PvDbContext> options) : DbContext(options)
{
    public DbSet<Projekt> Projekt => Set<Projekt>();
    public DbSet<Komponent> Komponenter => Set<Komponent>();
    public DbSet<AndringsloggPost> Andringslogg => Set<AndringsloggPost>();
    public DbSet<AnvandarInstallning> AnvandarInstallningar => Set<AnvandarInstallning>();
    public DbSet<AttGoraPost> AttGora => Set<AttGoraPost>();
    public DbSet<AnvandarPost> Anvandare => Set<AnvandarPost>();
    public DbSet<ProjektMedlem> Medlemmar => Set<ProjektMedlem>();
    public DbSet<StatusRubrik> StatusRubriker => Set<StatusRubrik>();
    public DbSet<StatusUppgift> StatusUppgifter => Set<StatusUppgift>();
    public DbSet<ListRad> ListRader => Set<ListRad>();
    public DbSet<ProjektText> Texter => Set<ProjektText>();
    public DbSet<ProjektFil> Filer => Set<ProjektFil>();
    public DbSet<Ritning> Ritningar => Set<Ritning>();
    public DbSet<KomponentMall> Komponentmallar => Set<KomponentMall>();
    public DbSet<KontrollMall> Kontrollmallar => Set<KontrollMall>();
    public DbSet<Kontroll> Kontroller => Set<Kontroll>();
    public DbSet<RitbordBild> RitbordBilder => Set<RitbordBild>();
    public DbSet<RitbordInstallning> RitbordInstallningar => Set<RitbordInstallning>();

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

        b.Entity<AnvandarPost>(e =>
        {
            e.ToTable("anvandare");
            e.HasKey(a => a.Id);
        });

        b.Entity<ProjektMedlem>(e =>
        {
            e.ToTable("projekt_medlem");
            e.HasKey(m => new { m.ProjektId, m.AnvandarId });
        });

        b.Entity<StatusRubrik>(e =>
        {
            e.ToTable("status_rubrik");
            e.HasKey(r => r.Id);
        });

        b.Entity<StatusUppgift>(e =>
        {
            e.ToTable("status_uppgift");
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.ProjektId);
            e.Property(u => u.Version).IsConcurrencyToken();
        });

        b.Entity<ListRad>(e =>
        {
            e.ToTable("listrad");
            e.HasKey(r => r.Id);
            e.HasIndex(r => new { r.ProjektId, r.Lista });
            e.Property(r => r.Version).IsConcurrencyToken();
        });

        b.Entity<ProjektText>(e =>
        {
            e.ToTable("projekttext");
            e.HasKey(t => new { t.ProjektId, t.Nyckel });
        });

        b.Entity<KomponentMall>(e => { e.ToTable("komponentmall"); e.HasKey(m => m.Id); });
        b.Entity<KontrollMall>(e => { e.ToTable("kontrollmall"); e.HasKey(m => m.Id); });
        b.Entity<Kontroll>(e => { e.ToTable("kontroll"); e.HasKey(k => k.Id); e.HasIndex(k => new { k.ProjektId, k.Typ }); });

        b.Entity<RitbordBild>(e =>
        {
            e.ToTable("ritbord");
            e.HasKey(r => r.Id);
            e.HasIndex(r => r.ProjektId);
            e.Property(r => r.Version).IsConcurrencyToken();
        });
        b.Entity<RitbordInstallning>(e => { e.ToTable("ritbord_installning"); e.HasKey(r => r.Id); e.Property(r => r.Id).ValueGeneratedNever(); });

        b.Entity<Ritning>(e =>
        {
            e.ToTable("ritning");
            e.HasKey(r => r.ProjektId);
            e.Property(r => r.Version).IsConcurrencyToken();
        });

        b.Entity<ProjektFil>(e =>
        {
            e.ToTable("projektfil");
            e.HasKey(f => f.Id);
            e.HasIndex(f => new { f.ProjektId, f.Mapp, f.Namn });
        });

        b.Entity<AnvandarInstallning>(e =>
        {
            e.ToTable("anvandarinstallning");
            e.HasKey(a => a.AnvandarId);
        });
    }
}
