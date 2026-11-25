using Bank.Domain;
using Xunit;

namespace Bank.Tests;

public class StatusTransitionTests
{
    [Theory]
    [InlineData(ApplicationStatus.Draft, ApplicationStatus.Submitted)]
    [InlineData(ApplicationStatus.Submitted, ApplicationStatus.KycPending)]
    [InlineData(ApplicationStatus.Submitted, ApplicationStatus.UnderReview)]
    [InlineData(ApplicationStatus.KycPending, ApplicationStatus.KycVerified)]
    [InlineData(ApplicationStatus.KycVerified, ApplicationStatus.UnderReview)]
    [InlineData(ApplicationStatus.UnderReview, ApplicationStatus.Approved)]
    [InlineData(ApplicationStatus.UnderReview, ApplicationStatus.Rejected)]
    [InlineData(ApplicationStatus.UnderReview, ApplicationStatus.ActionRequired)]
    [InlineData(ApplicationStatus.ActionRequired, ApplicationStatus.Submitted)]
    public void Legal_transitions_are_allowed(ApplicationStatus from, ApplicationStatus to) =>
        Assert.True(ApplicationStateMachine.CanTransition(from, to));

    [Theory]
    [InlineData(ApplicationStatus.Draft, ApplicationStatus.Approved)]
    [InlineData(ApplicationStatus.Submitted, ApplicationStatus.Approved)]
    [InlineData(ApplicationStatus.KycPending, ApplicationStatus.UnderReview)]
    [InlineData(ApplicationStatus.KycPending, ApplicationStatus.Approved)]
    [InlineData(ApplicationStatus.Approved, ApplicationStatus.Rejected)]
    [InlineData(ApplicationStatus.Rejected, ApplicationStatus.Submitted)]
    [InlineData(ApplicationStatus.ActionRequired, ApplicationStatus.Approved)]
    public void Illegal_transitions_are_blocked(ApplicationStatus from, ApplicationStatus to)
    {
        Assert.False(ApplicationStateMachine.CanTransition(from, to));
        Assert.Throws<IllegalTransitionException>(() => ApplicationStateMachine.EnsureAllowed(from, to, "reason"));
    }

    [Theory]
    [InlineData(ApplicationStatus.Rejected, null)]
    [InlineData(ApplicationStatus.Rejected, "   ")]
    [InlineData(ApplicationStatus.ActionRequired, "")]
    public void Reject_and_request_info_need_a_reason(ApplicationStatus to, string? reason) =>
        Assert.Throws<ReasonRequiredException>(() => ApplicationStateMachine.EnsureAllowed(ApplicationStatus.UnderReview, to, reason));

    [Fact]
    public void Failed_transition_leaves_status_unchanged()
    {
        var application = new BankApplication();
        Assert.Throws<IllegalTransitionException>(() => application.ApplyTransition(ApplicationStatus.Approved, null));
        Assert.Equal(ApplicationStatus.Draft, application.Status);
    }
}

public class LoanRuleTests
{
    [Theory]
    [InlineData(100000, 12, 12, 8884.88)]
    [InlineData(120000, 0, 12, 10000.00)]
    public void Emi_matches_the_formula(decimal principal, decimal rate, int months, decimal expected) =>
        Assert.Equal(expected, EmiCalculator.Calculate(principal, rate, months));

    [Theory]
    [InlineData(0, 10, 12)]
    [InlineData(1000, -1, 12)]
    [InlineData(1000, 10, 0)]
    public void Emi_rejects_invalid_input(decimal principal, decimal rate, int months) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => EmiCalculator.Calculate(principal, rate, months));

    [Fact]
    public void Ratio_above_half_warns_and_exactly_half_does_not()
    {
        Assert.True(EmiCalculator.IsHighRatio(EmiCalculator.IncomeRatio(50001, 100000)));
        Assert.False(EmiCalculator.IsHighRatio(EmiCalculator.IncomeRatio(50000, 100000)));
    }

    [Fact]
    public void Ratio_is_unknown_without_income() => Assert.Null(EmiCalculator.IncomeRatio(1000, 0));

    [Theory]
    [InlineData(KycDocumentStatus.Uploaded, false)]
    [InlineData(KycDocumentStatus.Rejected, false)]
    [InlineData(KycDocumentStatus.Verified, true)]
    public void Loan_approval_needs_a_verified_salary_slip(KycDocumentStatus status, bool expected)
    {
        var slip = new KycDocument { Type = KycDocumentType.SalarySlip, S3Key = "key", Status = status };
        Assert.Equal(expected, KycRules.CanApproveLoan(slip));
    }

    [Fact]
    public void Loan_approval_is_blocked_without_a_salary_slip() => Assert.False(KycRules.CanApproveLoan(null));

    [Fact]
    public void Customer_is_verified_only_when_all_required_documents_are()
    {
        var documents = KycRules.RequiredCustomerDocuments
            .Select(t => new KycDocument { Type = t, S3Key = "key", Status = KycDocumentStatus.Verified })
            .ToList();
        Assert.True(KycRules.IsCustomerVerified(documents));

        documents[0].Status = KycDocumentStatus.Rejected;
        Assert.False(KycRules.IsCustomerVerified(documents));
    }
}

public class PiiMaskingTests
{
    [Fact]
    public void Pan_is_masked_to_last_four() => Assert.Equal("XXXXXX234F", PiiMasking.MaskPan("ABCDE1234F"));

    [Fact]
    public void Aadhaar_is_masked_to_last_four() => Assert.Equal("XXXX-XXXX-1234", PiiMasking.MaskAadhaar("123412341234"));

    [Theory]
    [InlineData("ABCDE1234F", true)]
    [InlineData("abcde1234f", false)]
    [InlineData("ABCD1234F", false)]
    public void Pan_format_is_checked(string value, bool expected) => Assert.Equal(expected, PiiMasking.IsValidPan(value));

    [Theory]
    [InlineData("1234-1234 1234", true)]
    [InlineData("12341234123", false)]
    public void Aadhaar_format_is_checked(string value, bool expected) =>
        Assert.Equal(expected, PiiMasking.IsValidAadhaar(PiiMasking.NormalizeAadhaar(value)));
}
