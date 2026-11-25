using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Bank.Application;
using Bank.Domain;
using Bank.Infrastructure;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Bank.Api;

public sealed class JwtIssuer(IConfiguration configuration) : IJwtIssuer
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    public string Issue(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(configuration["Jwt:Key"]!));
        var token = new JwtSecurityToken(
            configuration["Jwt:Issuer"],
            configuration["Jwt:Audience"],
            [
                new Claim("sub", user.Id.ToString()),
                new Claim("role", user.Role.ToString()),
                new Claim("jti", Guid.NewGuid().ToString())
            ],
            expires: DateTime.UtcNow + Lifetime,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public static class UserContext
{
    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue("sub"), out var id) ? id : throw Errors.Unauthorized("Session expired.");
}

public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        var (status, detail) = exception switch
        {
            AppException e => (e.StatusCode, e.Message),
            ReasonRequiredException e => (StatusCodes.Status400BadRequest, e.Message),
            IllegalTransitionException e => (StatusCodes.Status409Conflict, e.Message),
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, "This record was just changed. Refresh and try again."),
            _ => (StatusCodes.Status500InternalServerError, "Something went wrong.")
        };

        // Only the exception type is logged, because messages can carry customer data.
        if (status >= 500) logger.LogError("Unhandled {ErrorType} on {Method} {Route}", exception.GetType().Name, context.Request.Method, context.Request.Path);

        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = new ProblemDetails { Status = status, Title = ReasonFor(status), Detail = detail }
        });
    }

    private static string ReasonFor(int status) => status switch
    {
        400 => "Bad request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not found",
        409 => "Conflict",
        429 => "Too many requests",
        _ => "Server error"
    };
}

public static class LocalDevStorageEndpoints
{
    /// <summary>Stands in for S3 presigned links. Mapped only in Development with Storage:Provider=local.</summary>
    public static void MapLocalDevStorage(this WebApplication app, LocalDevStorage storage)
    {
        app.MapPut("/dev-storage/{**key}", async (string key, long exp, long size, string sig, HttpRequest request, CancellationToken ct) =>
        {
            var contentType = request.ContentType ?? "";
            if (size > KycService.MaxBytes || request.ContentLength != size || !storage.IsValidUpload(key, exp, contentType, size, sig))
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            await storage.SaveAsync(key, request.Body, contentType, size, ct);
            return Results.Ok();
        }).AllowAnonymous();

        app.MapGet("/dev-storage/{**key}", (string key, long exp, string sig) =>
        {
            if (!storage.IsValidView(key, exp, sig)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            return storage.Open(key) is { } file ? Results.File(file.Path, file.ContentType) : Results.NotFound();
        }).AllowAnonymous();
    }
}
