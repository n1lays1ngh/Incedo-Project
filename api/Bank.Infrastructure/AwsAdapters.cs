using Amazon.S3;
using Amazon.S3.Model;
using Amazon.SimpleEmailV2;
using Amazon.SimpleEmailV2.Model;
using Bank.Application;
using Microsoft.Extensions.Configuration;

namespace Bank.Infrastructure;

public sealed class S3Storage(IAmazonS3 s3, IConfiguration configuration) : IStorage
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromMinutes(5);
    private string Bucket => configuration["Aws:KycBucket"] ?? throw new InvalidOperationException("Aws:KycBucket is not configured.");

    public async Task<PresignedUpload> CreateUploadUrlAsync(string key, string contentType, long sizeBytes, CancellationToken ct)
    {
        var expires = DateTime.UtcNow + LinkLifetime;
        var request = new GetPreSignedUrlRequest
        {
            BucketName = Bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = expires,
            ContentType = contentType
        };
        request.Headers.ContentLength = sizeBytes;
        var url = await s3.GetPreSignedURLAsync(request);

        // Browsers set Content-Length themselves and refuse a script that tries to.
        return new PresignedUpload(url, new Dictionary<string, string> { ["Content-Type"] = contentType }, expires);
    }

    public async Task<StoredObject?> HeadAsync(string key, CancellationToken ct)
    {
        try
        {
            var head = await s3.GetObjectMetadataAsync(Bucket, key, ct);
            return new StoredObject(head.Headers.ContentType, head.ContentLength);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public Task<string> CreateViewUrlAsync(string key, CancellationToken ct) =>
        s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow + LinkLifetime
        });
}

public sealed class SesEmailSender(IAmazonSimpleEmailServiceV2 ses, IConfiguration configuration) : IEmailSender
{
    public Task SendAsync(string to, string subject, string body, CancellationToken ct) =>
        ses.SendEmailAsync(new SendEmailRequest
        {
            FromEmailAddress = configuration["Aws:SesFrom"] ?? throw new InvalidOperationException("Aws:SesFrom is not configured."),
            Destination = new Destination { ToAddresses = [to] },
            Content = new EmailContent
            {
                Simple = new Message
                {
                    Subject = new Content { Data = subject },
                    Body = new Body { Text = new Content { Data = body } }
                }
            }
        }, ct);
}
