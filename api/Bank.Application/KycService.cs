using Bank.Domain;
using Microsoft.EntityFrameworkCore;

namespace Bank.Application;

public sealed class KycService(IAppDb db, IStorage storage)
{
    public const long MaxBytes = 5 * 1024 * 1024;

    private static readonly Dictionary<string, string> AllowedTypes = new(StringComparer.Ordinal)
    {
        ["application/pdf"] = ".pdf",
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png"
    };

    public async Task<UploadUrlResponse> CreateUploadUrlAsync(Guid customerId, UploadUrlRequest request, CancellationToken ct)
    {
        if (!AllowedTypes.TryGetValue(request.ContentType, out var extension))
            throw Errors.BadRequest("Only PDF, JPG and PNG files are allowed.");
        if (request.SizeBytes is <= 0 or > MaxBytes)
            throw Errors.BadRequest("File must be 5 MB or smaller.");

        await EnsureCanUploadAsync(customerId, request.Type, request.ApplicationId, ct);

        var key = $"{Prefix(customerId)}{Guid.NewGuid():N}{extension}";
        var upload = await storage.CreateUploadUrlAsync(key, request.ContentType, request.SizeBytes, ct);
        return new UploadUrlResponse(upload.Url, key, upload.Headers, upload.ExpiresAt);
    }

    public async Task<KycDocumentResponse> RegisterAsync(Guid customerId, RegisterDocumentRequest request, CancellationToken ct)
    {
        if (!request.S3Key.StartsWith(Prefix(customerId), StringComparison.Ordinal) || request.S3Key.Contains(".."))
            throw Errors.BadRequest("Invalid document key.");

        var stored = await storage.HeadAsync(request.S3Key, ct) ?? throw Errors.BadRequest("Uploaded file was not found.");
        if (!AllowedTypes.TryGetValue(stored.ContentType, out var extension)
            || !request.S3Key.EndsWith(extension, StringComparison.Ordinal))
            throw Errors.BadRequest("Only PDF, JPG and PNG files are allowed.");
        if (stored.SizeBytes is <= 0 or > MaxBytes)
            throw Errors.BadRequest("File must be 5 MB or smaller.");

        await using var tx = await db.BeginTransactionAsync(ct);
        await db.LockCustomerAsync(customerId, ct);
        await EnsureCanUploadAsync(customerId, request.Type, request.ApplicationId, ct);

        var document = await db.KycDocuments.FirstOrDefaultAsync(d =>
            d.CustomerId == customerId && d.Type == request.Type && d.ApplicationId == request.ApplicationId, ct);
        if (document is null)
        {
            document = new KycDocument
            {
                CustomerId = customerId,
                ApplicationId = request.ApplicationId,
                Type = request.Type,
                S3Key = request.S3Key
            };
            db.KycDocuments.Add(document);
        }

        document.S3Key = request.S3Key;
        document.Status = KycDocumentStatus.Uploaded;
        document.RejectReason = null;
        document.UploadedAt = DateTime.UtcNow;
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = customerId,
            Action = "KycUploaded",
            EntityType = "KycDocument",
            EntityId = document.Id.ToString()
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return ToResponse(document);
    }

    public async Task<IReadOnlyList<KycDocumentResponse>> ListAsync(Guid customerId, CancellationToken ct)
    {
        var documents = await db.KycDocuments.AsNoTracking()
            .Where(d => d.CustomerId == customerId)
            .OrderBy(d => d.Type)
            .ToListAsync(ct);
        return documents.Select(ToResponse).ToList();
    }

    public static KycDocumentResponse ToResponse(KycDocument d) =>
        new(d.Id, d.Type.ToString(), d.Status.ToString(), d.RejectReason, d.ApplicationId, d.UploadedAt);

    private static string Prefix(Guid customerId) => $"kyc/{customerId:N}/";

    private async Task EnsureCanUploadAsync(Guid customerId, KycDocumentType type, Guid? applicationId, CancellationToken ct)
    {
        if (type == KycDocumentType.SalarySlip)
        {
            if (applicationId is null) throw Errors.BadRequest("A salary slip must belong to a loan application.");
            var app = await db.Applications.AsNoTracking().Include(a => a.Product)
                .FirstOrDefaultAsync(a => a.Id == applicationId && a.CustomerId == customerId, ct)
                ?? throw Errors.NotFound("Application not found.");
            if (app.Product!.Code != ProductCodes.Loan) throw Errors.BadRequest("Salary slips apply only to loans.");
            if (app.Status is not (ApplicationStatus.Draft or ApplicationStatus.ActionRequired))
                throw Errors.Conflict("This application can no longer be changed.");
            return;
        }

        if (applicationId is not null) throw Errors.BadRequest("Only a salary slip belongs to an application.");
        var verified = await db.KycDocuments.AnyAsync(d =>
            d.CustomerId == customerId && d.Type == type && d.ApplicationId == null && d.Status == KycDocumentStatus.Verified, ct);
        if (verified) throw Errors.Conflict("This document is already verified.");
    }
}
