using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Endgame.Infrastructure.Platform;

public sealed record OtlpSpan(string TraceId, string SpanId, string? ParentSpanId, string Name, int Kind, DateTimeOffset Start, double DurationMs, int StatusCode,
    string? HttpMethod, string? HttpRoute, string? UrlPath, int? HttpStatus);

public sealed record OtlpMetricPoint(string Name, string? Unit, string Type, DateTimeOffset At, double? Value, long? Count, double? Sum);

public sealed record OtlpLog(DateTimeOffset At, int SeverityNumber, string? SeverityText, string Body, string? Category, string? TraceId, string? SpanId);

/// <summary>
/// Reads OTLP/HTTP export requests (traces, metrics, logs) in both encodings — protobuf, which the
/// app kit sends, and JSON — keeping only the fields the platform measures. A hand-written reader of
/// the protobuf wire format: the OTLP messages are stable and small, and this keeps a code generator
/// and a package out of the control plane. Unknown fields are skipped, as protobuf requires.
/// </summary>
public static class OtlpDecoder
{
    public const int MaxItems = 10_000;

    public static IReadOnlyList<OtlpSpan> Traces(ReadOnlySpan<byte> body, bool json) => json ? TracesJson(body) : TracesProto(body);

    public static IReadOnlyList<OtlpMetricPoint> Metrics(ReadOnlySpan<byte> body, bool json) => json ? MetricsJson(body) : MetricsProto(body);

    public static IReadOnlyList<OtlpLog> Logs(ReadOnlySpan<byte> body, bool json) => json ? LogsJson(body) : LogsProto(body);

    // -------------------------------------------------------------- protobuf: traces

    private static List<OtlpSpan> TracesProto(ReadOnlySpan<byte> body)
    {
        var spans = new List<OtlpSpan>();
        foreach (var resource in Messages(body, 1))
        {
            foreach (var scope in Messages(resource, 2))
            {
                foreach (var span in Messages(scope, 2))
                {
                    if (spans.Count >= MaxItems)
                    {
                        return spans;
                    }

                    spans.Add(Span(span));
                }
            }
        }

        return spans;
    }

    private static OtlpSpan Span(ReadOnlySpan<byte> span)
    {
        string trace = "", id = "", name = "";
        string? parent = null;
        int kind = 0, status = 0;
        ulong start = 0, end = 0;
        var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
        var reader = new ProtoReader(span);
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 1 when wire == 2: trace = Convert.ToHexStringLower(reader.Bytes()); break;
                case 2 when wire == 2: id = Convert.ToHexStringLower(reader.Bytes()); break;
                case 4 when wire == 2: var p = reader.Bytes(); parent = p.Length == 0 ? null : Convert.ToHexStringLower(p); break;
                case 5 when wire == 2: name = reader.String(); break;
                case 6 when wire == 0: kind = (int)reader.Varint(); break;
                case 7 when wire == 1: start = reader.Fixed64(); break;
                case 8 when wire == 1: end = reader.Fixed64(); break;
                case 9 when wire == 2: Attribute(reader.Bytes(), attributes); break;
                case 15 when wire == 2: status = Status(reader.Bytes()); break;
                default: reader.Skip(wire); break;
            }
        }

        return Build(trace, id, parent, name, kind, start, end, status, attributes);
    }

    private static int Status(ReadOnlySpan<byte> status)
    {
        var code = 0;
        var reader = new ProtoReader(status);
        while (reader.Next(out var field, out var wire))
        {
            if (field == 3 && wire == 0)
            {
                code = (int)reader.Varint();
            }
            else
            {
                reader.Skip(wire);
            }
        }

        return code;
    }

    private static void Attribute(ReadOnlySpan<byte> keyValue, Dictionary<string, string> into)
    {
        string? key = null, value = null;
        var reader = new ProtoReader(keyValue);
        while (reader.Next(out var field, out var wire))
        {
            if (field == 1 && wire == 2)
            {
                key = reader.String();
            }
            else if (field == 2 && wire == 2)
            {
                value = AnyValue(reader.Bytes());
            }
            else
            {
                reader.Skip(wire);
            }
        }

        if (key is not null && value is not null)
        {
            into[key] = value;
        }
    }

    private static string? AnyValue(ReadOnlySpan<byte> any)
    {
        var reader = new ProtoReader(any);
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 1 when wire == 2: return reader.String();
                case 2 when wire == 0: return reader.Varint() != 0 ? "true" : "false";
                case 3 when wire == 0: return ((long)reader.Varint()).ToString(CultureInfo.InvariantCulture);
                case 4 when wire == 1: return BitConverter.UInt64BitsToDouble(reader.Fixed64()).ToString(CultureInfo.InvariantCulture);
                default: reader.Skip(wire); break;
            }
        }

        return null;
    }

    // -------------------------------------------------------------- protobuf: metrics

    private static List<OtlpMetricPoint> MetricsProto(ReadOnlySpan<byte> body)
    {
        var points = new List<OtlpMetricPoint>();
        foreach (var resource in Messages(body, 1))
        {
            foreach (var scope in Messages(resource, 2))
            {
                foreach (var metric in Messages(scope, 2))
                {
                    Metric(metric, points);
                    if (points.Count >= MaxItems)
                    {
                        return points;
                    }
                }
            }
        }

        return points;
    }

    private static void Metric(ReadOnlySpan<byte> metric, List<OtlpMetricPoint> into)
    {
        string name = "";
        string? unit = null;
        var reader = new ProtoReader(metric);
        var data = new List<(string Type, byte[] Bytes)>();
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 1 when wire == 2: name = reader.String(); break;
                case 3 when wire == 2: unit = reader.String(); break;
                case 5 when wire == 2: data.Add(("gauge", reader.Bytes().ToArray())); break;
                case 7 when wire == 2: data.Add(("sum", reader.Bytes().ToArray())); break;
                case 9 when wire == 2: data.Add(("histogram", reader.Bytes().ToArray())); break;
                default: reader.Skip(wire); break;
            }
        }

        foreach (var (type, bytes) in data)
        {
            foreach (var point in Messages(bytes, 1))
            {
                into.Add(type == "histogram" ? HistogramPoint(name, unit, point) : NumberPoint(name, unit, type, point));
            }
        }
    }

    private static OtlpMetricPoint NumberPoint(string name, string? unit, string type, ReadOnlySpan<byte> point)
    {
        ulong time = 0;
        double? value = null;
        var reader = new ProtoReader(point);
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 3 when wire == 1: time = reader.Fixed64(); break;
                case 4 when wire == 1: value = BitConverter.UInt64BitsToDouble(reader.Fixed64()); break;
                case 6 when wire == 1: value = (long)reader.Fixed64(); break;
                default: reader.Skip(wire); break;
            }
        }

        return new OtlpMetricPoint(name, unit, type, Time(time), value, null, null);
    }

    private static OtlpMetricPoint HistogramPoint(string name, string? unit, ReadOnlySpan<byte> point)
    {
        ulong time = 0, count = 0;
        double? sum = null;
        var reader = new ProtoReader(point);
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 3 when wire == 1: time = reader.Fixed64(); break;
                case 4 when wire == 1: count = reader.Fixed64(); break;
                case 5 when wire == 1: sum = BitConverter.UInt64BitsToDouble(reader.Fixed64()); break;
                default: reader.Skip(wire); break;
            }
        }

        return new OtlpMetricPoint(name, unit, "histogram", Time(time), null, (long)count, sum);
    }

    // -------------------------------------------------------------- protobuf: logs

    private static List<OtlpLog> LogsProto(ReadOnlySpan<byte> body)
    {
        var logs = new List<OtlpLog>();
        foreach (var resource in Messages(body, 1))
        {
            foreach (var scope in Messages(resource, 2))
            {
                string? category = null;
                foreach (var info in Messages(scope, 1))
                {
                    var r = new ProtoReader(info);
                    while (r.Next(out var f, out var w))
                    {
                        if (f == 1 && w == 2)
                        {
                            category = r.String();
                        }
                        else
                        {
                            r.Skip(w);
                        }
                    }
                }

                foreach (var record in Messages(scope, 2))
                {
                    if (logs.Count >= MaxItems)
                    {
                        return logs;
                    }

                    logs.Add(Log(record, category));
                }
            }
        }

        return logs;
    }

    private static OtlpLog Log(ReadOnlySpan<byte> record, string? category)
    {
        ulong time = 0, observed = 0;
        int severity = 0;
        string? severityText = null, trace = null, span = null;
        var body = "";
        var reader = new ProtoReader(record);
        while (reader.Next(out var field, out var wire))
        {
            switch (field)
            {
                case 1 when wire == 1: time = reader.Fixed64(); break;
                case 11 when wire == 1: observed = reader.Fixed64(); break;
                case 2 when wire == 0: severity = (int)reader.Varint(); break;
                case 3 when wire == 2: severityText = reader.String(); break;
                case 5 when wire == 2: body = AnyValue(reader.Bytes()) ?? ""; break;
                case 9 when wire == 2: trace = Hex(reader.Bytes()); break;
                case 10 when wire == 2: span = Hex(reader.Bytes()); break;
                default: reader.Skip(wire); break;
            }
        }

        return new OtlpLog(Time(time != 0 ? time : observed), severity, severityText, body, category, trace, span);
    }

    private static string? Hex(ReadOnlySpan<byte> bytes) => bytes.Length == 0 ? null : Convert.ToHexStringLower(bytes);

    /// <summary>Every length-delimited sub-message with the given field number.</summary>
    private static List<byte[]> Messages(ReadOnlySpan<byte> message, int number)
    {
        var found = new List<byte[]>();
        var reader = new ProtoReader(message);
        while (reader.Next(out var field, out var wire))
        {
            if (field == number && wire == 2)
            {
                found.Add(reader.Bytes().ToArray());
            }
            else
            {
                reader.Skip(wire);
            }
        }

        return found;
    }

    // -------------------------------------------------------------- JSON (OTLP/HTTP JSON encoding)

    private static List<OtlpSpan> TracesJson(ReadOnlySpan<byte> body)
    {
        using var doc = JsonDocument.Parse(body.ToArray());
        var spans = new List<OtlpSpan>();
        foreach (var resource in Array(doc.RootElement, "resourceSpans"))
        {
            foreach (var scope in Array(resource, "scopeSpans"))
            {
                foreach (var s in Array(scope, "spans"))
                {
                    var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (var a in Array(s, "attributes"))
                    {
                        if (Text(a, "key") is { } key && a.TryGetProperty("value", out var v) && JsonAny(v) is { } value)
                        {
                            attributes[key] = value;
                        }
                    }

                    var status = s.TryGetProperty("status", out var st) && st.TryGetProperty("code", out var code) ? Int(code) : 0;
                    spans.Add(Build(Text(s, "traceId") ?? "", Text(s, "spanId") ?? "", Text(s, "parentSpanId") is { Length: > 0 } p ? p : null, Text(s, "name") ?? "",
                        s.TryGetProperty("kind", out var kind) ? Int(kind) : 0, Nanos(s, "startTimeUnixNano"), Nanos(s, "endTimeUnixNano"), status, attributes));
                }
            }
        }

        return spans;
    }

    private static List<OtlpMetricPoint> MetricsJson(ReadOnlySpan<byte> body)
    {
        using var doc = JsonDocument.Parse(body.ToArray());
        var points = new List<OtlpMetricPoint>();
        foreach (var resource in Array(doc.RootElement, "resourceMetrics"))
        {
            foreach (var scope in Array(resource, "scopeMetrics"))
            {
                foreach (var m in Array(scope, "metrics"))
                {
                    var name = Text(m, "name") ?? "";
                    var unit = Text(m, "unit");
                    foreach (var type in new[] { "gauge", "sum", "histogram" })
                    {
                        if (!m.TryGetProperty(type, out var data))
                        {
                            continue;
                        }

                        foreach (var dp in Array(data, "dataPoints"))
                        {
                            var at = Time(Nanos(dp, "timeUnixNano"));
                            points.Add(type == "histogram"
                                ? new OtlpMetricPoint(name, unit, type, at, null, dp.TryGetProperty("count", out var c) ? (long)Nanos(c) : null, dp.TryGetProperty("sum", out var sum) ? sum.GetDouble() : null)
                                : new OtlpMetricPoint(name, unit, type, at,
                                    dp.TryGetProperty("asDouble", out var d) ? d.GetDouble() : dp.TryGetProperty("asInt", out var i) ? (double)(long)Nanos(i) : null, null, null));
                        }
                    }
                }
            }
        }

        return points;
    }

    private static List<OtlpLog> LogsJson(ReadOnlySpan<byte> body)
    {
        using var doc = JsonDocument.Parse(body.ToArray());
        var logs = new List<OtlpLog>();
        foreach (var resource in Array(doc.RootElement, "resourceLogs"))
        {
            foreach (var scope in Array(resource, "scopeLogs"))
            {
                var category = scope.TryGetProperty("scope", out var sc) ? Text(sc, "name") : null;
                foreach (var l in Array(scope, "logRecords"))
                {
                    var time = Nanos(l, "timeUnixNano");
                    logs.Add(new OtlpLog(Time(time != 0 ? time : Nanos(l, "observedTimeUnixNano")), l.TryGetProperty("severityNumber", out var sn) ? Int(sn) : 0, Text(l, "severityText"),
                        l.TryGetProperty("body", out var b) ? JsonAny(b) ?? "" : "", category, Text(l, "traceId") is { Length: > 0 } t ? t : null, Text(l, "spanId") is { Length: > 0 } s ? s : null));
                }
            }
        }

        return logs;
    }

    private static IEnumerable<JsonElement> Array(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : [];

    private static string? Text(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int Int(JsonElement e) => e.ValueKind == JsonValueKind.Number ? e.GetInt32() : e.ValueKind == JsonValueKind.String && int.TryParse(e.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;

    private static ulong Nanos(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? Nanos(v) : 0;

    private static ulong Nanos(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String when ulong.TryParse(v.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) => n,
        JsonValueKind.Number when v.TryGetUInt64(out var n) => n,
        _ => 0,
    };

    private static string? JsonAny(JsonElement any) =>
        any.TryGetProperty("stringValue", out var s) ? s.GetString()
        : any.TryGetProperty("intValue", out var i) ? (i.ValueKind == JsonValueKind.String ? i.GetString() : i.GetRawText())
        : any.TryGetProperty("boolValue", out var b) ? (b.GetBoolean() ? "true" : "false")
        : any.TryGetProperty("doubleValue", out var d) ? d.GetRawText()
        : null;

    // -------------------------------------------------------------- shared

    private static OtlpSpan Build(string trace, string id, string? parent, string name, int kind, ulong start, ulong end, int status, Dictionary<string, string> attributes)
    {
        int? httpStatus = attributes.TryGetValue("http.response.status_code", out var sc) || attributes.TryGetValue("http.status_code", out sc)
            ? int.TryParse(sc, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code) ? code : null
            : null;
        var method = attributes.GetValueOrDefault("http.request.method") ?? attributes.GetValueOrDefault("http.method");
        var duration = end > start ? (end - start) / 1_000_000d : 0d;
        return new OtlpSpan(Clip(trace, 32), Clip(id, 16), parent is null ? null : Clip(parent, 16), Clip(name, 300), kind, Time(start), duration, status,
            ClipOrNull(method, 20), ClipOrNull(attributes.GetValueOrDefault("http.route"), 300), ClipOrNull(attributes.GetValueOrDefault("url.path") ?? attributes.GetValueOrDefault("http.target"), 500), httpStatus);
    }

    private static DateTimeOffset Time(ulong unixNanos) =>
        unixNanos == 0 ? DateTimeOffset.UnixEpoch : DateTimeOffset.UnixEpoch.AddTicks((long)Math.Min(unixNanos / 100, (ulong)(DateTimeOffset.MaxValue - DateTimeOffset.UnixEpoch).Ticks - 1));

    private static string Clip(string value, int max) => value.Length <= max ? value : value[..max];

    private static string? ClipOrNull(string? value, int max) => value is null ? null : value.Length <= max ? value : value[..max];

    /// <summary>A forward-only reader of the protobuf wire format.</summary>
    private ref struct ProtoReader(ReadOnlySpan<byte> data)
    {
        private readonly ReadOnlySpan<byte> data = data;
        private int position;

        public bool Next(out int field, out int wire)
        {
            if (position >= data.Length)
            {
                field = wire = 0;
                return false;
            }

            var tag = Varint();
            field = (int)(tag >> 3);
            wire = (int)(tag & 7);
            return true;
        }

        public ulong Varint()
        {
            ulong result = 0;
            for (var shift = 0; shift < 64; shift += 7)
            {
                if (position >= data.Length)
                {
                    throw new FormatException("A protobuf varint runs past the end of the message.");
                }

                var b = data[position++];
                result |= (ulong)(b & 0x7F) << shift;
                if ((b & 0x80) == 0)
                {
                    return result;
                }
            }

            throw new FormatException("A protobuf varint is too long.");
        }

        public ulong Fixed64()
        {
            Require(8);
            var value = BinaryPrimitives.ReadUInt64LittleEndian(data[position..]);
            position += 8;
            return value;
        }

        public ReadOnlySpan<byte> Bytes()
        {
            var length = Varint();
            if (length > int.MaxValue)
            {
                throw new FormatException("A protobuf field is too long.");
            }

            Require((int)length);
            var bytes = data.Slice(position, (int)length);
            position += (int)length;
            return bytes;
        }

        public string String() => Encoding.UTF8.GetString(Bytes());

        public void Skip(int wire)
        {
            switch (wire)
            {
                case 0: Varint(); break;
                case 1: Require(8); position += 8; break;
                case 2: Bytes(); break;
                case 5: Require(4); position += 4; break;
                default: throw new FormatException($"Protobuf wire type {wire} is not supported.");
            }
        }

        private readonly void Require(int count)
        {
            if (count < 0 || position + count > data.Length)
            {
                throw new FormatException("A protobuf field runs past the end of the message.");
            }
        }
    }
}
