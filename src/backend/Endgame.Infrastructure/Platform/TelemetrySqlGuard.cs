using System.Text;

namespace Endgame.Infrastructure.Platform;

/// <summary>What the guard decided about a query: allowed (with the text to run) or refused, with why.</summary>
public sealed record SqlVerdict(bool Allowed, string Sql, string? Reason)
{
    public static SqlVerdict Refuse(string reason) => new(false, "", reason);
}

/// <summary>
/// The parser-level fence for "ask about this app" (spec: natural-language dashboards). A query a
/// model wrote — or a hostile person — runs only if it is one plain <c>SELECT</c> (a <c>WITH</c> of
/// selects is allowed) that reads only the four documented telemetry views and calls only functions
/// on a short allow-list. It is the first of three fences: the query then runs as a role that can
/// read nothing but those views, under row-level security pinned to one app, with a statement
/// timeout and a row limit (<see cref="TelemetryQueryRunner"/>).
/// </summary>
public static class TelemetrySqlGuard
{
    public const int MaxLength = 4000;

    /// <summary>The views a query may read: <c>ask.requests</c>, <c>ask.errors</c>, <c>ask.events</c>, <c>ask.metrics</c>.</summary>
    public static readonly IReadOnlySet<string> Views = new HashSet<string>(StringComparer.Ordinal) { "requests", "errors", "events", "metrics" };

    public static readonly IReadOnlySet<string> Functions = new HashSet<string>(StringComparer.Ordinal)
    {
        "count", "sum", "avg", "min", "max", "stddev", "variance", "percentile_cont", "percentile_disc", "bool_and", "bool_or",
        "date_trunc", "date_part", "extract", "date_bin", "to_char", "now", "age",
        "coalesce", "nullif", "greatest", "least", "round", "floor", "ceil", "ceiling", "abs", "trunc",
        "lower", "upper", "length", "left", "right", "split_part", "concat", "replace", "position", "strpos",
        "row_number", "rank", "dense_rank", "lag", "lead", "first_value", "last_value", "ntile",
        "cast", "jsonb_extract_path_text",
    };

    /// <summary>Types a value may be cast to with <c>::</c> or <c>CAST(… AS …)</c>.</summary>
    public static readonly IReadOnlySet<string> Types = new HashSet<string>(StringComparer.Ordinal)
    {
        "int", "integer", "bigint", "smallint", "numeric", "decimal", "real", "float", "double", "precision", "text", "varchar",
        "date", "timestamp", "timestamptz", "interval", "boolean", "bool", "time", "with", "zone", "jsonb",
    };

    /// <summary>Words that never appear in a read of four views: writes, schema changes, session changes, locks, files.</summary>
    private static readonly IReadOnlySet<string> Forbidden = new HashSet<string>(StringComparer.Ordinal)
    {
        "insert", "update", "delete", "merge", "upsert", "drop", "create", "alter", "truncate", "grant", "revoke", "comment",
        "copy", "into", "set", "reset", "show", "do", "call", "execute", "prepare", "deallocate", "declare", "fetch", "move", "close",
        "lock", "for", "vacuum", "analyze", "analyse", "cluster", "reindex", "refresh", "listen", "notify", "unlisten", "load",
        "discard", "begin", "commit", "rollback", "savepoint", "release", "start", "transaction", "returning", "table", "only",
        "lateral", "tablesample", "recursive", "values", "security", "role", "session", "user", "current_user",
        "session_user", "current_role", "current_schema", "current_catalog", "current_database", "pg_catalog", "information_schema",
        "public", "import", "export",
    };

    /// <summary>Clause keywords: a word after one of these is not in a list of relations any more.</summary>
    private static readonly IReadOnlySet<string> ClauseEnds = new HashSet<string>(StringComparer.Ordinal)
    {
        "where", "group", "having", "order", "limit", "offset", "window", "union", "intersect", "except", "select", "fetch",
    };

    /// <summary>Keywords that may stand before a parenthesis without being a function call.</summary>
    private static readonly IReadOnlySet<string> Structural = new HashSet<string>(StringComparer.Ordinal)
    {
        "select", "from", "where", "and", "or", "not", "in", "exists", "as", "on", "using", "join", "over", "filter", "within",
        "group", "by", "having", "when", "then", "else", "case", "any", "all", "some", "distinct", "union", "intersect", "except",
        "with", "partition", "order", "between", "is", "like", "ilike", "similar", "to", "asc", "desc", "nulls", "first", "last",
        "inner", "left", "right", "full", "outer", "cross", "natural", "end", "limit", "offset", "range", "rows", "groups",
        "preceding", "following", "current", "row", "unbounded", "interval", "cast", "escape",
    };

    private enum Kind
    {
        Word,
        Number,
        String,
        Symbol,
    }

    private readonly record struct Token(Kind Kind, string Text);

    public static SqlVerdict Check(string? sql)
    {
        var text = (sql ?? "").Trim();
        while (text.EndsWith(';'))
        {
            text = text[..^1].TrimEnd();
        }

        if (text.Length == 0)
        {
            return SqlVerdict.Refuse("The query is empty.");
        }

        if (text.Length > MaxLength)
        {
            return SqlVerdict.Refuse($"A query is at most {MaxLength} characters.");
        }

        List<Token> tokens;
        try
        {
            tokens = Tokenise(text);
        }
        catch (FormatException ex)
        {
            return SqlVerdict.Refuse(ex.Message);
        }

        if (tokens.Count == 0 || tokens[0].Kind != Kind.Word || tokens[0].Text is not ("select" or "with"))
        {
            return SqlVerdict.Refuse("Only a single SELECT (or WITH … SELECT) is allowed.");
        }

        // Names a WITH defines (`with name as (…)`, `, name as (…)` at the top of its list), each with
        // where its body ends: a name is the CTE only after its body, so an earlier body cannot reach a
        // real table of the same name.
        var ctes = new Dictionary<string, int>(StringComparer.Ordinal);
        if (tokens[0].Text == "with")
        {
            var depth = 0;
            for (var i = 1; i < tokens.Count; i++)
            {
                var t = tokens[i];
                if (t.Text == "(")
                {
                    depth++;
                }
                else if (t.Text == ")")
                {
                    depth--;
                }
                else if (depth == 0 && t.Kind == Kind.Word && t.Text == "select")
                {
                    break;
                }
                else if (depth == 0 && t.Kind == Kind.Word && i + 2 < tokens.Count && tokens[i + 1].Text == "as" && tokens[i + 2].Text == "(")
                {
                    var inner = 0;
                    var end = i + 2;
                    for (; end < tokens.Count; end++)
                    {
                        inner += tokens[end].Text == "(" ? 1 : tokens[end].Text == ")" ? -1 : 0;
                        if (inner == 0)
                        {
                            break;
                        }
                    }

                    ctes.TryAdd(t.Text, end);
                }
            }
        }

        var clause = new Stack<string>();
        clause.Push("");
        var parenKinds = new Stack<string>();
        var expectRelation = false;
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            var next = i + 1 < tokens.Count ? tokens[i + 1] : default;
            if (t.Kind == Kind.Symbol)
            {
                switch (t.Text)
                {
                    case "(":
                        var previous = i > 0 ? tokens[i - 1] : default;
                        var kind = previous.Kind == Kind.Word && previous.Text is "extract" or "position" or "cast" ? previous.Text : "group";
                        if (expectRelation)
                        {
                            // A subquery in a FROM list must itself be a SELECT.
                            if (next.Kind != Kind.Word || next.Text is not ("select" or "with"))
                            {
                                return SqlVerdict.Refuse("Only the views requests, errors, events and metrics may be read.");
                            }

                            expectRelation = false;
                        }

                        parenKinds.Push(kind);
                        clause.Push("");
                        break;
                    case ")":
                        if (parenKinds.Count == 0)
                        {
                            return SqlVerdict.Refuse("The parentheses do not balance.");
                        }

                        parenKinds.Pop();
                        clause.Pop();
                        break;
                    case ",":
                        if (clause.Peek() == "from")
                        {
                            expectRelation = true;
                        }

                        break;
                    case ";":
                        return SqlVerdict.Refuse("Only one statement is allowed.");
                    case "::":
                        if (next.Kind != Kind.Word || !Types.Contains(next.Text))
                        {
                            return SqlVerdict.Refuse($"Values may be cast only to {string.Join(", ", Types.Where(x => x is not ("with" or "zone" or "precision")))}.");
                        }

                        i++;
                        break;
                }

                continue;
            }

            if (t.Kind != Kind.Word)
            {
                if (expectRelation)
                {
                    return SqlVerdict.Refuse("Only the views requests, errors, events and metrics may be read.");
                }

                continue;
            }

            var word = t.Text;
            if (Forbidden.Contains(word) || word.StartsWith("pg_", StringComparison.Ordinal) || word.StartsWith("_pg", StringComparison.Ordinal))
            {
                return SqlVerdict.Refuse($"'{word}' is not allowed: a dashboard question is one read of the app's telemetry.");
            }

            if (expectRelation)
            {
                expectRelation = false;
                var name = word;
                if (word == "ask" && next.Text == "." && i + 2 < tokens.Count && tokens[i + 2].Kind == Kind.Word)
                {
                    name = tokens[i + 2].Text;
                    i += 2;
                }
                else if (next.Text == ".")
                {
                    return SqlVerdict.Refuse("Only the views requests, errors, events and metrics may be read.");
                }

                if (!Views.Contains(name) && !(ctes.TryGetValue(name, out var bodyEnd) && bodyEnd < i))
                {
                    return SqlVerdict.Refuse($"'{name}' cannot be read: only the views requests, errors, events and metrics.");
                }

                if (i + 1 < tokens.Count && tokens[i + 1].Text == "(")
                {
                    return SqlVerdict.Refuse("A relation is a view, not a function.");
                }

                continue;
            }

            if (word == "as" && parenKinds.Count > 0 && parenKinds.Peek() == "cast" && (next.Kind != Kind.Word || !Types.Contains(next.Text)))
            {
                return SqlVerdict.Refuse($"Values may be cast only to {string.Join(", ", Types.Where(x => x is not ("with" or "zone" or "precision")))}.");
            }

            if (word == "from")
            {
                // Inside extract( … from … ) and position( … in … ) a FROM names no relation.
                if (parenKinds.Count > 0 && parenKinds.Peek() is "extract")
                {
                    continue;
                }

                clause.Pop();
                clause.Push("from");
                expectRelation = true;
                continue;
            }

            if (word == "join")
            {
                expectRelation = true;
                continue;
            }

            if (ClauseEnds.Contains(word))
            {
                clause.Pop();
                clause.Push(word);
            }

            if (next.Text == "(" && !Structural.Contains(word))
            {
                if (!Functions.Contains(word))
                {
                    return SqlVerdict.Refuse($"The function '{word}' is not allowed. Allowed: {string.Join(", ", Functions.Order(StringComparer.Ordinal))}.");
                }
            }
        }

        if (parenKinds.Count != 0)
        {
            return SqlVerdict.Refuse("The parentheses do not balance.");
        }

        if (expectRelation)
        {
            return SqlVerdict.Refuse("The query ends where a view should be named.");
        }

        if (!tokens.Any(t => t.Kind == Kind.Word && t.Text == "from"))
        {
            return SqlVerdict.Refuse("Read one of the views requests, errors, events and metrics.");
        }

        return new SqlVerdict(true, text, null);
    }

    /// <summary>
    /// Splits the text into words (lower-cased), numbers, single-quoted strings and symbols. Anything a
    /// read of four views has no use for — comments, double-quoted names, dollar quoting, escapes,
    /// parameters — is refused here rather than understood.
    /// </summary>
    private static List<Token> Tokenise(string text)
    {
        var tokens = new List<Token>();
        var i = 0;
        while (i < text.Length)
        {
            var c = text[i];
            if (char.IsWhiteSpace(c))
            {
                i++;
                continue;
            }

            if ((c == '-' && i + 1 < text.Length && text[i + 1] == '-') || (c == '/' && i + 1 < text.Length && text[i + 1] == '*'))
            {
                throw new FormatException("Comments are not allowed in a dashboard query.");
            }

            if (c is '"' or '$' or '\\' or '`' or '?' or '@' or '#' or '{' or '}' or '[' or ']')
            {
                throw new FormatException($"The character '{c}' is not allowed in a dashboard query.");
            }

            if (c == '\'')
            {
                var sb = new StringBuilder();
                i++;
                while (true)
                {
                    if (i >= text.Length)
                    {
                        throw new FormatException("A string is not closed.");
                    }

                    if (text[i] == '\'')
                    {
                        if (i + 1 < text.Length && text[i + 1] == '\'')
                        {
                            sb.Append('\'');
                            i += 2;
                            continue;
                        }

                        i++;
                        break;
                    }

                    sb.Append(text[i]);
                    i++;
                }

                // E'…' and other prefixed strings are a word right before a quote: refused below.
                if (tokens.Count > 0 && tokens[^1].Kind == Kind.Word && tokens[^1].Text is "e" or "u&" or "b" or "x" or "n")
                {
                    throw new FormatException("Escaped or prefixed strings are not allowed.");
                }

                tokens.Add(new Token(Kind.String, sb.ToString()));
                continue;
            }

            if (char.IsAsciiLetter(c) || c == '_')
            {
                var start = i;
                while (i < text.Length && (char.IsAsciiLetterOrDigit(text[i]) || text[i] == '_'))
                {
                    i++;
                }

                tokens.Add(new Token(Kind.Word, text[start..i].ToLowerInvariant()));
                continue;
            }

            if (char.IsAsciiDigit(c) || (c == '.' && i + 1 < text.Length && char.IsAsciiDigit(text[i + 1])))
            {
                var start = i;
                while (i < text.Length && (char.IsAsciiDigit(text[i]) || text[i] == '.' || text[i] is 'e' or 'E'))
                {
                    i++;
                }

                tokens.Add(new Token(Kind.Number, text[start..i]));
                continue;
            }

            if (c > 127)
            {
                throw new FormatException("Only plain ASCII is allowed outside strings.");
            }

            // Multi-character operators first.
            foreach (var op in new[] { "::", "->>", "->", "<=", ">=", "<>", "!=", "||", "!~*", "!~", "~*" })
            {
                if (string.CompareOrdinal(text, i, op, 0, op.Length) == 0)
                {
                    tokens.Add(new Token(Kind.Symbol, op));
                    i += op.Length;
                    goto next;
                }
            }

            if ("(),.;+-*/%<>=~".Contains(c, StringComparison.Ordinal))
            {
                tokens.Add(new Token(Kind.Symbol, c.ToString()));
                i++;
                continue;
            }

            throw new FormatException($"The character '{c}' is not allowed in a dashboard query.");
        next:;
        }

        return tokens;
    }
}
