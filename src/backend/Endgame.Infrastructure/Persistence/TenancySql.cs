namespace Endgame.Infrastructure.Persistence;

/// <summary>
/// The database's half of tenancy and of the append-only logs, applied by the <c>ControlPlaneCore</c>
/// migration. The platform connects through two roles: <c>endgame_app</c>, which row-level security
/// confines to the organisation in the <c>endgame.organisation_id</c> session setting, and
/// <c>endgame_system</c>, which bypasses it for the few cross-organisation jobs (routing, sweeps).
/// Neither role may update or delete a run event, a ledger entry or an operator action, and a
/// trigger refuses it to anyone else, the owner included.
/// </summary>
public static class TenancySql
{
    /// <summary>Every table that holds an organisation's rows.</summary>
    public static readonly IReadOnlyList<string> TenantTables =
    [
        "organisations", "divisions", "projects", "apps", "memberships", "cascade_entries", "employees",
        "runs", "run_events", "tasks", "approvals", "ideas", "conversations", "credit_entries", "operator_actions",
    ];

    public static readonly IReadOnlyList<string> AppendOnlyTables = ["run_events", "credit_entries", "operator_actions"];

    public static string Up()
    {
        var sql = new System.Text.StringBuilder("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'endgame_app') THEN
                    CREATE ROLE endgame_app NOLOGIN;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'endgame_system') THEN
                    CREATE ROLE endgame_system NOLOGIN BYPASSRLS;
                END IF;
            END $$;
            GRANT endgame_app TO CURRENT_USER;
            GRANT endgame_system TO CURRENT_USER;
            GRANT USAGE ON SCHEMA public TO endgame_app, endgame_system;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO endgame_app, endgame_system;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO endgame_app, endgame_system;
            REVOKE INSERT, UPDATE, DELETE ON "__EFMigrationsHistory" FROM endgame_app, endgame_system;

            CREATE OR REPLACE FUNCTION endgame_current_organisation() RETURNS uuid
                LANGUAGE sql STABLE
                AS $$ SELECT NULLIF(current_setting('endgame.organisation_id', true), '')::uuid $$;

            CREATE OR REPLACE FUNCTION endgame_refuse_change() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only: rows are never updated or deleted', TG_TABLE_NAME
                        USING ERRCODE = 'insufficient_privilege';
                END $$;

            """);
        foreach (var table in TenantTables)
        {
            sql.AppendLine($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;");
            sql.AppendLine($"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;");
            sql.AppendLine($"CREATE POLICY {table}_tenant ON {table} USING (organisation_id = endgame_current_organisation()) WITH CHECK (organisation_id = endgame_current_organisation());");
        }

        foreach (var table in AppendOnlyTables)
        {
            sql.AppendLine($"REVOKE UPDATE, DELETE, TRUNCATE ON {table} FROM endgame_app, endgame_system;");
            // Statement-level, so even an UPDATE or DELETE that matches no row is refused.
            sql.AppendLine($"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION endgame_refuse_change();");
        }

        return sql.ToString();
    }

    public static string Down()
    {
        var sql = new System.Text.StringBuilder();
        foreach (var table in AppendOnlyTables)
        {
            sql.AppendLine($"DROP TRIGGER IF EXISTS {table}_append_only ON {table};");
        }

        foreach (var table in TenantTables)
        {
            sql.AppendLine($"DROP POLICY IF EXISTS {table}_tenant ON {table};");
            sql.AppendLine($"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;");
            sql.AppendLine($"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;");
        }

        sql.AppendLine("DROP FUNCTION IF EXISTS endgame_refuse_change();");
        sql.AppendLine("DROP FUNCTION IF EXISTS endgame_current_organisation();");
        return sql.ToString();
    }

    /// <summary>
    /// Row-level security, grants and the tenant policy for tables a later migration adds. The
    /// migration passes its own literal list, so what an applied migration did never changes.
    /// </summary>
    public static string EnableFor(IEnumerable<string> tables)
    {
        var sql = new System.Text.StringBuilder();
        foreach (var table in tables)
        {
            sql.AppendLine($"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO endgame_app, endgame_system;");
            sql.AppendLine($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;");
            sql.AppendLine($"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;");
            sql.AppendLine($"CREATE POLICY {table}_tenant ON {table} USING (organisation_id = endgame_current_organisation()) WITH CHECK (organisation_id = endgame_current_organisation());");
        }

        return sql.ToString();
    }

    /// <summary>Makes tables a later migration adds append-only, as <see cref="AppendOnlyTables"/> are.</summary>
    public static string AppendOnlyFor(IEnumerable<string> tables)
    {
        var sql = new System.Text.StringBuilder();
        foreach (var table in tables)
        {
            sql.AppendLine($"REVOKE UPDATE, DELETE, TRUNCATE ON {table} FROM endgame_app, endgame_system;");
            sql.AppendLine($"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION endgame_refuse_change();");
        }

        return sql.ToString();
    }

    public static string DisableFor(IEnumerable<string> tables)
    {
        var sql = new System.Text.StringBuilder();
        foreach (var table in tables)
        {
            sql.AppendLine($"DROP TRIGGER IF EXISTS {table}_append_only ON {table};");
            sql.AppendLine($"DROP POLICY IF EXISTS {table}_tenant ON {table};");
            sql.AppendLine($"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;");
            sql.AppendLine($"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;");
        }

        return sql.ToString();
    }
}
