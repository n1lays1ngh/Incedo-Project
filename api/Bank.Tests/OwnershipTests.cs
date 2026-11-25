using Bank.Application;
using Bank.Domain;
using Bank.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Bank.Tests;

public class OwnershipTests
{
    private sealed class NoEmail : IEmailSender
    {
        public Task SendAsync(string to, string subject, string body, CancellationToken ct) => Task.CompletedTask;
    }

    private static readonly Guid Owner = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();

    private static async Task<(ApplicationService Service, Guid ApplicationId)> ArrangeAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var db = new AppDbContext(options);
        var product = new Product { Id = 1, Code = ProductCodes.Savings, Name = "Savings Account" };
        var application = new BankApplication { CustomerId = Owner, ProductId = product.Id, Product = product };
        db.Products.Add(product);
        db.Applications.Add(application);
        await db.SaveChangesAsync();

        var emails = new EmailQueue(new NoEmail(), NullLogger<EmailQueue>.Instance);
        return (new ApplicationService(db, new StatusService(db, emails), emails), application.Id);
    }

    [Fact]
    public async Task Owner_can_read_their_application()
    {
        var (service, id) = await ArrangeAsync();
        var result = await service.GetAsync(Owner, id, CancellationToken.None);
        Assert.Equal(id, result.Id);
    }

    [Fact]
    public async Task Another_customer_gets_404()
    {
        var (service, id) = await ArrangeAsync();
        var error = await Assert.ThrowsAsync<AppException>(() => service.GetAsync(Other, id, CancellationToken.None));
        Assert.Equal(404, error.StatusCode);
    }

    [Fact]
    public async Task Another_customers_list_is_empty()
    {
        var (service, _) = await ArrangeAsync();
        Assert.Empty(await service.ListAsync(Other, CancellationToken.None));
    }

    [Fact]
    public async Task Another_customer_cannot_update()
    {
        var (service, id) = await ArrangeAsync();
        var request = new UpdateApplicationRequest(new SavingsInput(SavingsVariant.Regular, "Name", "Relation", true), null);
        var error = await Assert.ThrowsAsync<AppException>(() => service.UpdateAsync(Other, id, request, CancellationToken.None));
        Assert.Equal(404, error.StatusCode);
    }
}
