using Bank.Domain;
using Microsoft.EntityFrameworkCore;

namespace Bank.Application;

public sealed class OfficerService(IAppDb db, StatusService status, EmailQueue emails, IStorage storage, IPiiCipher cipher)
{
    private static readonly ApplicationStatus[] Waiting = [ApplicationStatus.KycPending, ApplicationStatus.UnderReview];

    public async Task<IReadOnlyList<QueueItem>> QueueAsync(Guid officerId, CancellationToken ct)
    {
        var rows = await (
            from a in db.Applications.AsNoTracking()
            join p in db.CustomerProfiles.AsNoTracking() on a.CustomerId equals p.UserId into profiles
            from p in profiles.DefaultIfEmpty()
            where (a.Status == ApplicationStatus.KycPending || a.Status == ApplicationStatus.UnderReview)
                  && (a.AssignedOfficerId == null || a.AssignedOfficerId == officerId)
            orderby a.CreatedAt
            select new { a.Id, a.Product!.Code, Name = p == null ? "Unknown" : p.Name, a.Status, a.AssignedOfficerId, a.CreatedAt }
        ).ToListAsync(ct);

        return rows.Select(r => new QueueItem(r.Id, r.Code, r.Name, r.Status.ToString(), r.AssignedOfficerId == officerId, r.CreatedAt)).ToList();
    }

    public async Task ClaimAsync(Guid officerId, Guid id, CancellationToken ct)
    {
        await using var tx = await db.BeginTransactionAsync(ct);
        var claimed = await db.Applications
            .Where(a => a.Id == id && a.AssignedOfficerId == null
                        && (a.Status == ApplicationStatus.KycPending || a.Status == ApplicationStatus.UnderReview))
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.AssignedOfficerId, officerId), ct);

        if (claimed == 0)
        {
            var exists = await db.Applications.AnyAsync(a => a.Id == id && a.Status != ApplicationStatus.Draft, ct);
            throw exists ? Errors.Conflict("This application is already claimed or closed.") : Errors.NotFound("Application not found.");
        }

        db.AuditLogs.Add(new AuditLog { ActorId = officerId, Action = "Claimed", EntityType = "Application", EntityId = id.ToString() });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task<OfficerApplicationDetail> GetAsync(Guid officerId, Guid id, CancellationToken ct)
    {
        var app = await db.Applications.AsNoTracking()
            .Include(a => a.Product).Include(a => a.Savings).Include(a => a.Loan)
            .FirstOrDefaultAsync(a => a.Id == id && a.Status != ApplicationStatus.Draft, ct)
            ?? throw Errors.NotFound("Application not found.");

        var profile = await db.CustomerProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == app.CustomerId, ct);
        db.AuditLogs.Add(new AuditLog { ActorId = officerId, Action = "ViewedApplication", EntityType = "Application", EntityId = id.ToString() });
        await db.SaveChangesAsync(ct);

        var detail = await ApplicationService.ToDetailAsync(db, app, ct);
        return new OfficerApplicationDetail(detail, app.CustomerId, app.AssignedOfficerId, app.AssignedOfficerId == officerId,
            profile is null ? null : ProfileService.ToResponse(profile, cipher));
    }

    public async Task<IReadOnlyList<HistoryResponse>> HistoryAsync(Guid id, CancellationToken ct)
    {
        if (!await db.Applications.AnyAsync(a => a.Id == id && a.Status != ApplicationStatus.Draft, ct))
            throw Errors.NotFound("Application not found.");
        return await db.ApplicationStatusHistory.AsNoTracking()
            .Where(h => h.ApplicationId == id)
            .OrderBy(h => h.At).ThenBy(h => h.Id)
            .Select(h => new HistoryResponse(h.FromStatus.ToString(), h.ToStatus.ToString(), h.Reason, h.At))
            .ToListAsync(ct);
    }

    public async Task<ViewUrlResponse> ViewUrlAsync(Guid officerId, Guid documentId, CancellationToken ct)
    {
        var document = await db.KycDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == documentId, ct)
            ?? throw Errors.NotFound("Document not found.");

        var visible = document.ApplicationId is { } applicationId
            ? await db.Applications.AnyAsync(a => a.Id == applicationId && a.Status != ApplicationStatus.Draft, ct)
            : await db.Applications.AnyAsync(a => a.CustomerId == document.CustomerId && a.Status != ApplicationStatus.Draft, ct);
        if (!visible) throw Errors.NotFound("Document not found.");

        // The view is recorded before the link is issued, so no document can be opened unlogged.
        db.AuditLogs.Add(new AuditLog { ActorId = officerId, Action = "ViewedKycDocument", EntityType = "KycDocument", EntityId = documentId.ToString() });
        await db.SaveChangesAsync(ct);
        return new ViewUrlResponse(await storage.CreateViewUrlAsync(document.S3Key, ct));
    }

    public async Task<KycDocumentResponse> VerifyDocumentAsync(Guid officerId, Guid documentId, CancellationToken ct)
    {
        var customerId = await CustomerOfDocumentAsync(documentId, ct);
        await using var tx = await db.BeginTransactionAsync(ct);
        await db.LockCustomerAsync(customerId, ct);

        var document = await db.KycDocuments.FirstAsync(d => d.Id == documentId, ct);
        await EnsureReviewerAsync(officerId, document, ct);
        if (document.Status != KycDocumentStatus.Uploaded) throw Errors.Conflict("Only an uploaded document can be verified.");

        document.Status = KycDocumentStatus.Verified;
        document.RejectReason = null;
        db.AuditLogs.Add(new AuditLog { ActorId = officerId, Action = "KycVerified", EntityType = "KycDocument", EntityId = documentId.ToString() });

        if (document.ApplicationId is null)
        {
            var all = await db.KycDocuments.Where(d => d.CustomerId == customerId && d.ApplicationId == null).ToListAsync(ct);
            if (KycRules.IsCustomerVerified(all))
            {
                var pending = await db.Applications
                    .Where(a => a.CustomerId == customerId && a.Status == ApplicationStatus.KycPending)
                    .ToListAsync(ct);
                foreach (var app in pending)
                {
                    await status.TransitionAsync(app, ApplicationStatus.KycVerified, officerId, null, ct);
                    await status.TransitionAsync(app, ApplicationStatus.UnderReview, officerId, null, ct);
                }
            }
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        await emails.FlushAsync(ct);
        return KycService.ToResponse(document);
    }

    public async Task<KycDocumentResponse> RejectDocumentAsync(Guid officerId, Guid documentId, string reason, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw Errors.BadRequest("A reason is required.");

        var customerId = await CustomerOfDocumentAsync(documentId, ct);
        await using var tx = await db.BeginTransactionAsync(ct);
        await db.LockCustomerAsync(customerId, ct);

        var document = await db.KycDocuments.FirstAsync(d => d.Id == documentId, ct);
        await EnsureReviewerAsync(officerId, document, ct);
        if (document.Type == KycDocumentType.SalarySlip)
            throw Errors.Conflict("For an unusable salary slip, use Request info on the application.");
        if (document.Status != KycDocumentStatus.Uploaded) throw Errors.Conflict("Only an uploaded document can be rejected.");

        var trimmed = reason.Trim();
        document.Status = KycDocumentStatus.Rejected;
        document.RejectReason = trimmed;
        db.AuditLogs.Add(new AuditLog { ActorId = officerId, Action = "KycRejected", EntityType = "KycDocument", EntityId = documentId.ToString() });

        var message = $"Your {document.Type} document was rejected: {trimmed}. Please upload it again.";
        db.Notifications.Add(new Notification { UserId = customerId, Type = "KycRejected", Message = message });
        var customer = await db.Users.FirstAsync(u => u.Id == customerId, ct);
        emails.Enqueue(customer.Email, "KYC document needs attention", message);

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        await emails.FlushAsync(ct);
        return KycService.ToResponse(document);
    }

    public async Task DecideAsync(Guid officerId, Guid id, DecisionRequest request, CancellationToken ct)
    {
        var reason = request.Reason?.Trim();
        if (request.Decision != OfficerDecision.Approve && string.IsNullOrEmpty(reason))
            throw Errors.BadRequest("A reason is required.");
        if (request.Decision == OfficerDecision.Reject && request.RejectionCategory is null)
            throw Errors.BadRequest("A rejection category is required.");

        var app = await db.Applications.Include(a => a.Product)
            .FirstOrDefaultAsync(a => a.Id == id && a.Status != ApplicationStatus.Draft, ct)
            ?? throw Errors.NotFound("Application not found.");
        if (app.AssignedOfficerId != officerId) throw Errors.Forbidden("Only the assigned officer can decide this application.");
        if (app.Status != ApplicationStatus.UnderReview) throw Errors.Conflict("Only an application under review can be decided.");

        ApplicationStatus target;
        switch (request.Decision)
        {
            case OfficerDecision.Approve:
                if (app.Product!.Code == ProductCodes.Loan)
                {
                    var slip = await db.KycDocuments.AsNoTracking()
                        .FirstOrDefaultAsync(d => d.ApplicationId == app.Id && d.Type == KycDocumentType.SalarySlip, ct);
                    if (!KycRules.CanApproveLoan(slip))
                        throw Errors.Conflict("Verify the salary slip before approving this loan.");
                }
                target = ApplicationStatus.Approved;
                reason = null;
                break;
            case OfficerDecision.Reject:
                target = ApplicationStatus.Rejected;
                app.RejectionCategory = request.RejectionCategory;
                app.RejectionReason = reason;
                break;
            default:
                target = ApplicationStatus.ActionRequired;
                break;
        }

        await status.TransitionAsync(app, target, officerId, reason, ct);
        await db.SaveChangesAsync(ct);
        await emails.FlushAsync(ct);
    }

    private async Task<Guid> CustomerOfDocumentAsync(Guid documentId, CancellationToken ct)
    {
        var customerId = await db.KycDocuments.AsNoTracking()
            .Where(d => d.Id == documentId)
            .Select(d => (Guid?)d.CustomerId)
            .FirstOrDefaultAsync(ct);
        return customerId ?? throw Errors.NotFound("Document not found.");
    }

    private async Task EnsureReviewerAsync(Guid officerId, KycDocument document, CancellationToken ct)
    {
        var allowed = document.ApplicationId is { } applicationId
            ? await db.Applications.AnyAsync(a => a.Id == applicationId && a.AssignedOfficerId == officerId && Waiting.Contains(a.Status), ct)
            : await db.Applications.AnyAsync(a => a.CustomerId == document.CustomerId && a.AssignedOfficerId == officerId && Waiting.Contains(a.Status), ct);
        if (!allowed) throw Errors.Forbidden("Claim one of this customer's applications to review this document.");
    }
}
