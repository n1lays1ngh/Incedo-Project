using System.Text.RegularExpressions;

namespace Bank.Domain;

public static partial class PiiMasking
{
    [GeneratedRegex("^[A-Z]{5}[0-9]{4}[A-Z]$")]
    private static partial Regex PanFormat();

    [GeneratedRegex("^[0-9]{12}$")]
    private static partial Regex AadhaarFormat();

    public static string NormalizePan(string value) => value.Trim().ToUpperInvariant();

    public static string NormalizeAadhaar(string value) => value.Replace("-", "").Replace(" ", "").Trim();

    public static bool IsValidPan(string normalized) => PanFormat().IsMatch(normalized);

    public static bool IsValidAadhaar(string normalized) => AadhaarFormat().IsMatch(normalized);

    /// <summary>ABCDE1234F becomes XXXXXX234F.</summary>
    public static string MaskPan(string pan) =>
        pan.Length < 4 ? "XXXXXXXXXX" : $"XXXXXX{pan[^4..]}";

    /// <summary>123412341234 becomes XXXX-XXXX-1234.</summary>
    public static string MaskAadhaar(string aadhaar) =>
        aadhaar.Length < 4 ? "XXXX-XXXX-XXXX" : $"XXXX-XXXX-{aadhaar[^4..]}";
}
