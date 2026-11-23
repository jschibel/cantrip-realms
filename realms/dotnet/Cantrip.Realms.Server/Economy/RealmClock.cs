namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// The realm's hourly work (tech.md B4): at the turn of every hour on the injected <see cref="TimeProvider"/>, every vendor's
/// trickle and rotation (<see cref="Vendors.AdvanceAll"/>), and every duel left unfinished for 24 hours counted as lost
/// (<see cref="Encounters.SettleAllAbandoned"/>). Both also happen whenever a player's own call needs them, so nothing
/// waits on this; it keeps the realm current for everyone else.
/// </summary>
public sealed class RealmClock(IServiceScopeFactory scopes, TimeProvider time, ILogger<RealmClock> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            DateTimeOffset now = time.GetUtcNow();
            DateTimeOffset next = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, 0, 0, TimeSpan.Zero).AddHours(1);
            try
            {
                await Task.Delay(next - now, time, stoppingToken).ConfigureAwait(false);
                await Tick().ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
#pragma warning disable CA1031 // The clock keeps going whatever one hour's work met; the next hour tries again.
            catch (Exception problem)
#pragma warning restore CA1031
            {
                log.LogError(problem, "The realm's hourly work failed.");
            }
        }
    }

    /// <summary>One hour's work.</summary>
    public async Task Tick()
    {
        using IServiceScope scope = scopes.CreateScope();
        await scope.ServiceProvider.GetRequiredService<Vendors>().AdvanceAll().ConfigureAwait(false);
        await scope.ServiceProvider.GetRequiredService<Encounters>().SettleAllAbandoned().ConfigureAwait(false);
    }
}
