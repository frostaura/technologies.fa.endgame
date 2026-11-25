using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AskVisits : Migration
    {
        /// <summary>
        /// "Ask about this app": <c>ask.requests</c> gains <c>visit</c>, true for a page someone opened —
        /// the same rule the app page's "visits today" counts by (<c>TelemetryService.VisitSql</c>): a GET
        /// that is not an API call, a file, a health poll, a platform callback or a webhook. A model asked
        /// about visits then counts <c>count(*) FILTER (WHERE visit)</c> and gets the number the owner
        /// already sees, instead of guessing at paths. <c>CREATE OR REPLACE</c> only appends a column, so
        /// the view keeps its grants and its <c>security_invoker</c>.
        /// </summary>
        private const string VisitUp = """
            CREATE OR REPLACE VIEW ask.requests WITH (security_invoker = true) AS
                SELECT start_at AS at, http_method AS method, COALESCE(http_route, url_path) AS route, url_path AS path,
                       http_status AS status, duration_ms,
                       (COALESCE(http_status, 0) >= 500 OR (http_status IS NULL AND status_code = 2)) AS failed,
                       (http_method = 'GET'
                        AND COALESCE(url_path, http_route, '/') !~* '(^|/)(api|health|_platform|_endgame|hooks|openapi)(/|$)'
                        AND COALESCE(url_path, '/') !~ '\.[A-Za-z0-9]{1,8}$') AS visit
                FROM public.telemetry_spans
                WHERE kind = 2 AND COALESCE(url_path, http_route, '/') !~* '(^|/)health(/|$)';
            """;

        /// <summary>A column cannot be dropped from a view in place: the earlier view is made again, with its grant.</summary>
        private const string VisitDown = """
            DROP VIEW ask.requests;
            CREATE VIEW ask.requests WITH (security_invoker = true) AS
                SELECT start_at AS at, http_method AS method, COALESCE(http_route, url_path) AS route, url_path AS path,
                       http_status AS status, duration_ms,
                       (COALESCE(http_status, 0) >= 500 OR (http_status IS NULL AND status_code = 2)) AS failed
                FROM public.telemetry_spans
                WHERE kind = 2 AND COALESCE(url_path, http_route, '/') !~* '(^|/)health(/|$)';
            REVOKE ALL ON ask.requests FROM PUBLIC, endgame_app, endgame_system;
            GRANT SELECT ON ask.requests TO endgame_ask;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(VisitUp);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(VisitDown);
        }
    }
}
