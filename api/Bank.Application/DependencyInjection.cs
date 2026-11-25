using Microsoft.Extensions.DependencyInjection;

namespace Bank.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<EmailQueue>();
        services.AddScoped<StatusService>();
        services.AddScoped<AuthService>();
        services.AddScoped<ProfileService>();
        services.AddScoped<ProductService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<ApplicationService>();
        services.AddScoped<LoanService>();
        services.AddScoped<KycService>();
        services.AddScoped<OfficerService>();
        services.AddScoped<TicketService>();
        services.AddScoped<AgentService>();
        services.AddScoped<AdminService>();
        return services;
    }
}
