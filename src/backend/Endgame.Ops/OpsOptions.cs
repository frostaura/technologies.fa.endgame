namespace Endgame.Ops;

/// <summary>
/// Cloudflare: the <c>Ops:Cloudflare</c> section (<c>Ops__Cloudflare__*</c>; compose maps the
/// <c>CLOUDFLARE_*</c> keys of <c>.env</c> onto it). With no token the service manages nothing and
/// says so on <c>/health</c>.
/// </summary>
public sealed class CloudflareOptions
{
    public const string Section = "Ops:Cloudflare";

    /// <summary>Cloudflare's API. Configuration, so tests point it at a local fake.</summary>
    public string BaseUrl { get; set; } = "https://api.cloudflare.com/client/v4";

    /// <summary>A scoped API token (ARCH-007 lists the permissions). Empty: idle.</summary>
    public string ApiToken { get; set; } = "";

    public string AccountId { get; set; } = "";

    public string ZoneId { get; set; } = "";

    /// <summary>The zone's domain, e.g. <c>frostaura.net</c>: organisation subdomains live directly under it.</summary>
    public string Zone { get; set; } = "";

    /// <summary>The tunnel cloudflared runs (its UUID); DNS points at <c>&lt;id&gt;.cfargotunnel.com</c>.</summary>
    public string TunnelId { get; set; } = "";

    /// <summary>The console's host, e.g. <c>endgame.frostaura.net</c>. Must be directly under <see cref="Zone"/>.</summary>
    public string ConsoleHost { get; set; } = "";

    /// <summary>Where the tunnel sends every Endgame host: the Edge, by its compose name.</summary>
    public string EdgeService { get; set; } = "http://edge:8080";

    /// <summary>The outage Worker's script name on the account.</summary>
    public string WorkerName { get; set; } = "endgame-outage";

    /// <summary>
    /// Labels refused as organisation names whatever DNS says (comma-separated), on top of every
    /// existing record's label and the console host's own.
    /// </summary>
    public string ReservedLabels { get; set; } = "www,mail,api,admin,status,ftp,smtp,imap,pop,mx,ns1,ns2";

    /// <summary>How long a read of the zone's records answers <c>reserved-hosts</c> before it is read again.</summary>
    public int ReservedCacheSeconds { get; set; } = 300;

    public bool HasToken => ApiToken.Length > 0;

    /// <summary>The keys a token alone does not make up for.</summary>
    public IReadOnlyList<string> Missing()
    {
        var missing = new List<string>();
        if (AccountId.Length == 0)
        {
            missing.Add("CLOUDFLARE_ACCOUNT_ID");
        }

        if (ZoneId.Length == 0)
        {
            missing.Add("CLOUDFLARE_ZONE_ID");
        }

        if (Zone.Length == 0)
        {
            missing.Add("ENDGAME_ZONE");
        }

        if (TunnelId.Length == 0)
        {
            missing.Add("CLOUDFLARE_TUNNEL_ID");
        }

        if (ConsoleHost.Length == 0)
        {
            missing.Add("ENDGAME_CONSOLE_HOST");
        }

        return missing;
    }
}

/// <summary>Backups: the <c>Ops:Backup</c> section (<c>Ops__Backup__*</c>; compose maps <c>ENDGAME_BACKUP_*</c>).</summary>
public sealed class BackupOptions
{
    public const string Section = "Ops:Backup";

    /// <summary>32 random bytes, hex or base64: every archive is sealed with a key derived from it. Empty: no backup runs.</summary>
    public string Key { get; set; } = "";

    /// <summary>An administrator's connection to the shared PostgreSQL server (any database; <c>postgres</c> is used).</summary>
    public string Postgres { get; set; } = "";

    /// <summary>The app repositories volume, mounted here. Empty or absent: not part of the archive.</summary>
    public string RepositoriesDirectory { get; set; } = "/data/dock";

    /// <summary>An uploaded-files volume, when the stack has one. Empty: there is none.</summary>
    public string UploadsDirectory { get; set; } = "";

    /// <summary>Archives land here when no bucket is configured.</summary>
    public string LocalDirectory { get; set; } = "/backups";

    /// <summary>Where a database dump is spooled while it is written into, or read out of, an archive.</summary>
    public string WorkDirectory { get; set; } = "/backups/.work";

    /// <summary>An S3-compatible endpoint: Cloudflare R2 is <c>https://&lt;account id&gt;.r2.cloudflarestorage.com</c>.</summary>
    public string S3Endpoint { get; set; } = "";

    public string S3Bucket { get; set; } = "";

    public string S3AccessKeyId { get; set; } = "";

    public string S3SecretAccessKey { get; set; } = "";

    /// <summary>R2 takes <c>auto</c>; MinIO and AWS take a real region name.</summary>
    public string S3Region { get; set; } = "auto";

    /// <summary>Every archive's key starts with this.</summary>
    public string S3Prefix { get; set; } = "endgame/";

    /// <summary>Upload part size: also the most memory an upload holds at once.</summary>
    public int PartSizeMb { get; set; } = 16;

    public bool ScheduleEnabled { get; set; } = true;

    /// <summary>The nightly backup runs at the first check on or after this hour (UTC).</summary>
    public int HourUtc { get; set; } = 1;

    public int CheckMinutes { get; set; } = 5;

    public int KeepDaily { get; set; } = 7;

    public int KeepWeekly { get; set; } = 4;

    /// <summary>R2's free storage allowance, in GB (10⁹ bytes, the stricter reading).</summary>
    public double AllowanceGb { get; set; } = 10;

    /// <summary>Warn once the next night's archive would take the bucket past this share of the allowance.</summary>
    public int WarnPercent { get; set; } = 80;

    public bool Offsite => S3Endpoint.Length > 0 && S3Bucket.Length > 0;

    /// <summary>Why no backup can run, or null when one can.</summary>
    public string? WhyRefused()
    {
        if (Key.Length == 0)
        {
            return $"ENDGAME_BACKUP_KEY is not set, so nothing can be encrypted and no backup runs. {BackupKey.Shape}";
        }

        if (!BackupKey.TryParse(Key, out _))
        {
            return $"ENDGAME_BACKUP_KEY is set but is not a backup key, so no backup runs. {BackupKey.Shape} " +
                "An archive opens only with the key that sealed it, so keep the one you have used before.";
        }

        if (Postgres.Length == 0)
        {
            return "No PostgreSQL connection is configured (Ops__Backup__Postgres), so no backup runs.";
        }

        if (S3Endpoint.Length > 0 != S3Bucket.Length > 0 || (Offsite && (S3AccessKeyId.Length == 0 || S3SecretAccessKey.Length == 0)))
        {
            return "The bucket is half configured: ENDGAME_BACKUP_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY are needed together.";
        }

        return null;
    }
}

/// <summary>The backup key: 32 bytes, written as 64 hex characters or as base64.</summary>
public static class BackupKey
{
    /// <summary>The shape a key must have, for every refusal that names the variable. Never the value.</summary>
    public const string Shape = "It must be 32 random bytes written as 64 hex characters (or as 44 characters of base64); make one with `openssl rand -hex 32`.";

    public static bool TryParse(string text, out byte[] key)
    {
        key = [];
        text = text.Trim();
        try
        {
            if (text.Length == 64 && text.All(Uri.IsHexDigit))
            {
                key = Convert.FromHexString(text);
                return true;
            }

            var bytes = Convert.FromBase64String(text);
            if (bytes.Length == 32)
            {
                key = bytes;
                return true;
            }
        }
        catch (FormatException)
        {
        }

        return false;
    }

    public static byte[] Parse(string text) =>
        TryParse(text, out var key) ? key : throw new InvalidOperationException($"ENDGAME_BACKUP_KEY is not a backup key. {Shape}");
}
