namespace Bank.Domain;

public static class EmiCalculator
{
    public const decimal WarningRatio = 0.50m;

    /// <summary>EMI = P·r·(1+r)^n / ((1+r)^n − 1), where r is the monthly rate and n the tenure in months.</summary>
    public static decimal Calculate(decimal principal, decimal annualRatePercent, int tenureMonths)
    {
        if (principal <= 0) throw new ArgumentOutOfRangeException(nameof(principal));
        if (annualRatePercent < 0) throw new ArgumentOutOfRangeException(nameof(annualRatePercent));
        if (tenureMonths <= 0) throw new ArgumentOutOfRangeException(nameof(tenureMonths));

        var r = annualRatePercent / 12m / 100m;
        if (r == 0) return Math.Round(principal / tenureMonths, 2, MidpointRounding.AwayFromZero);

        var factor = 1m;
        for (var i = 0; i < tenureMonths; i++) factor *= 1m + r;

        return Math.Round(principal * r * factor / (factor - 1m), 2, MidpointRounding.AwayFromZero);
    }

    /// <summary>Rounds up, so a ratio just over the 50% limit cannot round down to exactly 50% and lose its warning.</summary>
    public static decimal? IncomeRatio(decimal emi, decimal monthlyIncome) =>
        monthlyIncome <= 0 ? null : Math.Round(emi / monthlyIncome, 4, MidpointRounding.ToPositiveInfinity);

    /// <summary>Over 50% is a warning for the officer, never a block.</summary>
    public static bool IsHighRatio(decimal? ratio) => ratio > WarningRatio;
}

public static class KycRules
{
    public static readonly KycDocumentType[] RequiredCustomerDocuments =
        [KycDocumentType.Pan, KycDocumentType.Aadhaar, KycDocumentType.AddressProof];

    /// <summary>True when every required customer-level document is verified. Salary slips do not count.</summary>
    public static bool IsCustomerVerified(IEnumerable<KycDocument> documents)
    {
        var verified = documents
            .Where(d => d.ApplicationId is null && d.Status == KycDocumentStatus.Verified)
            .Select(d => d.Type)
            .ToHashSet();
        return RequiredCustomerDocuments.All(verified.Contains);
    }

    public static bool CanApproveLoan(KycDocument? salarySlip) =>
        salarySlip is { Type: KycDocumentType.SalarySlip, Status: KycDocumentStatus.Verified };
}
