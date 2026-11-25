using Endgame.Ops.Backups;

namespace Endgame.Ops.Tests;

public sealed class BackupPolicyTests
{
    private static StoredBackup At(string iso, long bytes = 1_000)
    {
        var at = DateTimeOffset.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);
        var id = BackupNames.IdFor(at);
        return new StoredBackup(id, BackupNames.FileName(id), bytes, at);
    }

    [Fact]
    public void Archive_names_round_trip_and_ids_are_accepted_in_any_form()
    {
        var at = new DateTimeOffset(2026, 11, 25, 1, 2, 3, TimeSpan.Zero);
        var name = BackupNames.FileName(BackupNames.IdFor(at));
        Assert.Equal("endgame-20261125T010203Z.egbk", name);
        Assert.Equal(at, BackupNames.Parse(name, 5)!.CreatedAt);
        Assert.Null(BackupNames.Parse("endgame-daily-20261125T010203Z.dump", 5));
        Assert.Equal("20261125T010203Z", BackupNames.NormaliseId("20261125T010203Z"));
        Assert.Equal("20261125T010203Z", BackupNames.NormaliseId("endgame/endgame-20261125T010203Z.egbk"));
        Assert.Throws<ArgumentException>(() => BackupNames.NormaliseId("../../etc/passwd"));
    }

    [Fact]
    public void Retention_keeps_the_newest_of_each_recent_day_and_week()
    {
        // Thirty nights, two archives on the newest night.
        var backups = Enumerable.Range(0, 30)
            .Select(d => At($"2026-11-{30 - d:00}T01:00:00Z"))
            .Append(At("2026-11-30T13:00:00Z"))
            .ToList();
        var (keep, delete) = Retention.Apply(backups, keepDaily: 7, keepWeekly: 4);

        Assert.Equal(backups.Count, keep.Count + delete.Count);
        // The newest of 30 Nov is the afternoon one; the morning one on the same day goes.
        Assert.Contains(keep, b => b.Id == "20261130T130000Z");
        Assert.Contains(delete, b => b.Id == "20261130T010000Z");
        // Seven days: 24–30 Nov.
        foreach (var day in Enumerable.Range(24, 7))
        {
            Assert.Contains(keep, b => b.CreatedAt.Day == day);
        }

        // Four ISO weeks. 30 Nov 2026 is the Monday of week 49, so weeks 49 and 48 are already held
        // by the dailies; weeks 47 and 46 add their newest night, a Sunday each.
        Assert.Contains(keep, b => b.Id == "20261122T010000Z"); // Sunday of week 47
        Assert.Contains(keep, b => b.Id == "20261115T010000Z"); // Sunday of week 46
        Assert.Equal(9, keep.Count);
        Assert.DoesNotContain(keep, b => b.Id == "20261108T010000Z");
    }

    [Fact]
    public void Retention_never_deletes_the_only_archive_however_it_is_configured()
    {
        var only = At("2026-11-25T01:00:00Z");
        var (keep, delete) = Retention.Apply([only], keepDaily: 0, keepWeekly: 0);
        Assert.Equal([only], keep);
        Assert.Empty(delete);
    }

    [Fact]
    public void Usage_warns_before_the_free_allowance_is_crossed()
    {
        var options = new BackupOptions { AllowanceGb = 10, WarnPercent = 80 };
        var gb = 1_000_000_000L;
        var ok = StorageUsage.From([At("2026-11-24T01:00:00Z", 2 * gb), At("2026-11-25T01:00:00Z", 2 * gb)], options, offsite: true);
        Assert.Equal("ok", ok.State);
        Assert.Equal(6 * gb, ok.ProjectedBytes);

        var warning = StorageUsage.From([At("2026-11-24T01:00:00Z", 3 * gb), At("2026-11-25T01:00:00Z", 3 * gb)], options, offsite: true);
        Assert.Equal("warning", warning.State);
        Assert.Contains("10 GB free allowance", warning.Message);

        var over = StorageUsage.From([At("2026-11-24T01:00:00Z", 5 * gb), At("2026-11-25T01:00:00Z", 5 * gb)], options, offsite: true);
        Assert.Equal("over", over.State);

        var local = StorageUsage.From([At("2026-11-25T01:00:00Z", 5 * gb)], options, offsite: false);
        Assert.Equal("local", local.State);
        Assert.Contains("nothing is offsite", local.Message);
    }

    [Fact]
    public void The_nightly_backup_is_due_once_a_day_after_its_hour()
    {
        var stored = new[] { At("2026-11-24T01:05:00Z") };
        Assert.True(BackupScheduler.IsDue(DateTimeOffset.Parse("2026-11-25T01:00:00Z", System.Globalization.CultureInfo.InvariantCulture), [], 1));
        Assert.False(BackupScheduler.IsDue(DateTimeOffset.Parse("2026-11-25T00:59:00Z", System.Globalization.CultureInfo.InvariantCulture), stored, 1));
        Assert.True(BackupScheduler.IsDue(DateTimeOffset.Parse("2026-11-25T01:00:00Z", System.Globalization.CultureInfo.InvariantCulture), stored, 1));
        Assert.True(BackupScheduler.IsDue(DateTimeOffset.Parse("2026-11-25T23:00:00Z", System.Globalization.CultureInfo.InvariantCulture), stored, 1));
        Assert.False(BackupScheduler.IsDue(DateTimeOffset.Parse("2026-11-24T23:00:00Z", System.Globalization.CultureInfo.InvariantCulture), stored, 1));
    }

    [Fact]
    public void Roles_are_restored_without_touching_the_administrator_or_failing_on_one_that_exists()
    {
        const string globals = """
            SET default_transaction_read_only = off;
            CREATE ROLE endgame;
            ALTER ROLE endgame WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$old';
            CREATE ROLE endgame_app;
            ALTER ROLE endgame_app WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
            CREATE ROLE "app-7f3a";
            ALTER ROLE "app-7f3a" WITH LOGIN PASSWORD 'SCRAM-SHA-256$x';
            GRANT endgame_app TO endgame GRANTED BY endgame;
            """;
        var prepared = PostgresTools.PrepareGlobals(globals, "endgame");
        Assert.DoesNotContain("CREATE ROLE endgame;", prepared);
        Assert.DoesNotContain("ALTER ROLE endgame WITH", prepared);
        Assert.Contains("DO $endgame$ BEGIN CREATE ROLE endgame_app; EXCEPTION WHEN duplicate_object THEN NULL; END $endgame$;", prepared);
        Assert.Contains("CREATE ROLE \"app-7f3a\"; EXCEPTION", prepared);
        Assert.Contains("ALTER ROLE endgame_app WITH NOSUPERUSER", prepared);
        Assert.Contains("ALTER ROLE \"app-7f3a\" WITH LOGIN", prepared);
        Assert.Contains("GRANT endgame_app TO endgame GRANTED BY endgame;", prepared);
    }

    [Fact]
    public void The_development_stacks_default_backup_key_is_a_valid_key()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "docker-compose.yml")))
        {
            root = root.Parent;
        }

        var compose = File.ReadAllText(Path.Combine(root!.FullName, "docker-compose.yml"));
        var match = System.Text.RegularExpressions.Regex.Match(compose, @"Ops__Backup__Key: \$\{ENDGAME_BACKUP_KEY:-(?<key>[0-9a-f]+)\}");
        Assert.True(match.Success, "docker-compose.yml gives the ops service a development backup key");
        Assert.True(BackupKey.TryParse(match.Groups["key"].Value, out _));
    }

    [Fact]
    public void Backups_refuse_plainly_when_misconfigured()
    {
        Assert.Contains("ENDGAME_BACKUP_KEY is not set", new BackupOptions { Postgres = "Host=x" }.WhyRefused());
        Assert.Contains("not 32 bytes", new BackupOptions { Key = "abc", Postgres = "Host=x" }.WhyRefused());
        var key = Convert.ToHexString(new byte[32]);
        Assert.Contains("half configured", new BackupOptions { Key = key, Postgres = "Host=x", S3Endpoint = "https://r2" }.WhyRefused());
        Assert.Null(new BackupOptions { Key = key, Postgres = "Host=x" }.WhyRefused());
        Assert.False(new BackupOptions { Key = key, Postgres = "Host=x" }.Offsite);
    }
}
