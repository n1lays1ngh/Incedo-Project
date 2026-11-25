namespace Bank.Domain;

public class IllegalTransitionException(string message) : Exception(message);

public class ReasonRequiredException(string message) : Exception(message);

public static class ApplicationStateMachine
{
    private static readonly Dictionary<ApplicationStatus, ApplicationStatus[]> Allowed = new()
    {
        [ApplicationStatus.Draft] = [ApplicationStatus.Submitted],
        [ApplicationStatus.Submitted] = [ApplicationStatus.KycPending, ApplicationStatus.UnderReview],
        [ApplicationStatus.KycPending] = [ApplicationStatus.KycVerified],
        [ApplicationStatus.KycVerified] = [ApplicationStatus.UnderReview],
        [ApplicationStatus.UnderReview] =
            [ApplicationStatus.Approved, ApplicationStatus.Rejected, ApplicationStatus.ActionRequired],
        [ApplicationStatus.ActionRequired] = [ApplicationStatus.Submitted],
        [ApplicationStatus.Approved] = [],
        [ApplicationStatus.Rejected] = [],
    };

    public static bool CanTransition(ApplicationStatus from, ApplicationStatus to) =>
        Allowed.TryGetValue(from, out var targets) && targets.Contains(to);

    public static bool RequiresReason(ApplicationStatus to) =>
        to is ApplicationStatus.Rejected or ApplicationStatus.ActionRequired;

    public static void EnsureAllowed(ApplicationStatus from, ApplicationStatus to, string? reason)
    {
        if (!CanTransition(from, to))
            throw new IllegalTransitionException($"Cannot move an application from {from} to {to}.");
        if (RequiresReason(to) && string.IsNullOrWhiteSpace(reason))
            throw new ReasonRequiredException($"A reason is required for {to}.");
    }
}
