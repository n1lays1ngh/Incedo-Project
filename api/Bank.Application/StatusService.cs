using Bank.Domain;
using Microsoft.Extensions.Logging;

namespace Bank.Application;

/// <summary>Holds emails until the database commit succeeds. A failed email never fails the request.</summary>
public sealed class EmailQueue(IEmailSender sender, ILogger<EmailQueue> logger)
{
    private readonly List<(string To, string Subject, string Body)> _pending = [];

    public void Enqueue(string to, string subject, string body) => _pending.Add((to, subject, body));

    public async Task FlushAsync(CancellationToken ct)
    {
        var batch = _pending.ToArray();
        _pending.Clear();
        foreach (var mail in batch)
        {
            try
            {
                await sender.SendAsync(mail.To, mail.Subject, mail.Body, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError("Email delivery failed: {ErrorType}", ex.GetType().Name);
            }
        }
    }
}

/// <summary>
/// The only code allowed to change Application.Status. It stages status, history, audit and notification
/// on the context, so the caller's single SaveChanges commits them together.
/// </summary>
public sealed class StatusService(IAppDb db, EmailQueue emails)
{
    private static readonly ApplicationStatus[] EmailedStatuses =
    [
        ApplicationStatus.UnderReview,
        ApplicationStatus.Approved,
        ApplicationStatus.Rejected,
        ApplicationStatus.ActionRequired
    ];

    public async Task TransitionAsync(BankApplication app, ApplicationStatus to, Guid actorId, string? reason, CancellationToken ct)
    {
        var from = app.Status;
        app.ApplyTransition(to, reason);

        db.ApplicationStatusHistory.Add(new ApplicationStatusHistory
        {
            ApplicationId = app.Id,
            FromStatus = from,
            ToStatus = to,
            ChangedBy = actorId,
            Reason = reason
        });
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = actorId,
            Action = $"Status:{from}->{to}",
            EntityType = "Application",
            EntityId = app.Id.ToString()
        });

        var message = Describe(to, reason);
        db.Notifications.Add(new Notification { UserId = app.CustomerId, Type = $"Application{to}", Message = message });

        if (EmailedStatuses.Contains(to))
        {
            var email = await db.Users.FindAsync([app.CustomerId], ct);
            if (email is not null) emails.Enqueue(email.Email, $"Application update: {to}", message);
        }
    }

    private static string Describe(ApplicationStatus status, string? reason) => status switch
    {
        ApplicationStatus.Submitted => "Your application has been submitted.",
        ApplicationStatus.KycPending => "Your application is waiting for KYC verification.",
        ApplicationStatus.KycVerified => "Your KYC documents have been verified.",
        ApplicationStatus.UnderReview => "Your application is under review.",
        ApplicationStatus.Approved => "Congratulations, your application has been approved.",
        ApplicationStatus.Rejected => $"Your application was rejected. Reason: {reason}",
        ApplicationStatus.ActionRequired => $"Your application needs action. {reason}",
        _ => $"Your application status is now {status}."
    };
}
