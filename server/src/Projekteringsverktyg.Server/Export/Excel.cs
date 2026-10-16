using ClosedXML.Excel;

namespace Projekteringsverktyg.Server.Export;

/// <summary>Gemensam Excel-export: en titelrad, en rubrikrad och raderna, med filter och fast rubrik.</summary>
public static class Excel
{
    public const string MimeTyp = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private static readonly TimeZoneInfo Sverige = HittaSverige();

    private static TimeZoneInfo HittaSverige()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm"); }
        catch { return TimeZoneInfo.Utc; }
    }

    /// <summary>Svensk tidsförskjutning (sommar- eller vintertid) för en given tidpunkt.</summary>
    public static TimeSpan Svensk(DateTimeOffset tid) => Sverige.GetUtcOffset(tid);

    public static string Filnamn(string namn)
    {
        var ogiltiga = Path.GetInvalidFileNameChars();
        var rent = new string(namn.Select(c => ogiltiga.Contains(c) ? '-' : c).ToArray()).Trim();
        return $"{rent} {DateTime.UtcNow:yyyy-MM-dd}.xlsx";
    }

    /// <summary>Ett blad i en arbetsbok: bladnamn, titel, kolumnrubriker och rader.</summary>
    public sealed record Blad(string Namn, string Titel, IReadOnlyList<string> Kolumner, IEnumerable<object?[]> Rader);

    public static byte[] Tabell(string bladnamn, string titel, IReadOnlyList<string> kolumner, IEnumerable<object?[]> rader) =>
        Arbetsbok([new Blad(bladnamn, titel, kolumner, rader)]);

    /// <summary>En Excel-fil med flera blad (t.ex. projektexporten). Bladnamnen görs unika och högst 31 tecken.</summary>
    public static byte[] Arbetsbok(IEnumerable<Blad> blad)
    {
        using var wb = new XLWorkbook();
        var anvanda = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var b in blad) LaggTill(wb, UniktNamn(b.Namn, anvanda), b.Titel, b.Kolumner, b.Rader);
        if (wb.Worksheets.Count == 0) wb.Worksheets.Add("Tom");
        using var ström = new MemoryStream();
        wb.SaveAs(ström);
        return ström.ToArray();
    }

    private static string UniktNamn(string namn, HashSet<string> anvanda)
    {
        var ren = new string(namn.Select(c => "[]:*?/\\".Contains(c) ? '-' : c).ToArray()).Trim();
        if (ren == "") ren = "Blad";
        var bas = ren.Length > 31 ? ren[..31] : ren;
        var kandidat = bas;
        for (var i = 2; !anvanda.Add(kandidat); i++)
        {
            var suffix = $" ({i})";
            kandidat = (bas.Length + suffix.Length > 31 ? bas[..(31 - suffix.Length)] : bas) + suffix;
        }
        return kandidat;
    }

    private static void LaggTill(XLWorkbook wb, string bladnamn, string titel, IReadOnlyList<string> kolumner, IEnumerable<object?[]> rader)
    {
        var ws = wb.Worksheets.Add(bladnamn);
        ws.Style.Font.FontName = "Arial";
        ws.Style.Font.FontSize = 10;

        ws.Cell(1, 1).Value = titel;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 13;
        ws.Cell(2, 1).Value = $"Exporterad {TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Sverige):yyyy-MM-dd HH:mm}";
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        const int rubrikRad = 4;
        for (var c = 0; c < kolumner.Count; c++)
        {
            var cell = ws.Cell(rubrikRad, c + 1);
            cell.Value = kolumner[c];
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3450");
        }

        var r = rubrikRad + 1;
        foreach (var rad in rader)
        {
            for (var c = 0; c < rad.Length && c < kolumner.Count; c++)
            {
                var cell = ws.Cell(r, c + 1);
                cell.Value = XLCellValue.FromObject(rad[c]);
                if (rad[c] is DateTime) cell.Style.DateFormat.Format = "yyyy-mm-dd hh:mm";
                cell.Style.Alignment.WrapText = true;
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
            }
            r++;
        }

        var sista = Math.Max(r - 1, rubrikRad);
        if (kolumner.Count > 0) ws.Range(rubrikRad, 1, sista, kolumner.Count).SetAutoFilter();
        ws.SheetView.FreezeRows(rubrikRad);
        for (var c = 1; c <= kolumner.Count; c++) ws.Column(c).Width = c == 1 ? 18 : 30;
    }
}
