using System.Buffers.Binary;
using System.Text;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// Writes OTLP/HTTP protobuf export requests the way an OpenTelemetry exporter does, field for field
/// (opentelemetry-proto: trace/v1, metrics/v1, logs/v1), so the intake is tested on real wire bytes.
/// </summary>
public static class OtlpWriter
{
    public sealed record Span(string Name, int Kind, DateTimeOffset Start, double DurationMs, string Method, string Path, int Status, string? Route = null);

    public static byte[] Traces(string serviceName, params Span[] spans)
    {
        var scope = new Proto()
            .Message(1, new Proto().Text(1, "Microsoft.AspNetCore"));
        foreach (var span in spans)
        {
            var start = Nanos(span.Start);
            var s = new Proto()
                .Bytes(1, Guid.NewGuid().ToByteArray())
                .Bytes(2, Guid.NewGuid().ToByteArray()[..8])
                .Text(5, span.Name)
                .Varint(6, (ulong)span.Kind)
                .Fixed64(7, start)
                .Fixed64(8, start + (ulong)(span.DurationMs * 1_000_000))
                .Message(9, Attribute("http.request.method", span.Method))
                .Message(9, Attribute("url.path", span.Path))
                .Message(9, IntAttribute("http.response.status_code", span.Status))
                .Message(15, new Proto().Varint(3, span.Status >= 500 ? 2UL : 0UL));
            if (span.Route is not null)
            {
                s.Message(9, Attribute("http.route", span.Route));
            }

            scope.Message(2, s);
        }

        return new Proto().Message(1, new Proto().Message(1, Resource(serviceName)).Message(2, scope)).ToArray();
    }

    public static byte[] Metrics(string serviceName, string name, double value, DateTimeOffset at) =>
        new Proto().Message(1, new Proto()
            .Message(1, Resource(serviceName))
            .Message(2, new Proto().Message(2, new Proto()
                .Text(1, name)
                .Text(3, "ms")
                .Message(5, new Proto().Message(1, new Proto().Fixed64(3, Nanos(at)).Double(4, value)))))).ToArray();

    public static byte[] Logs(string serviceName, string body, int severity, DateTimeOffset at) =>
        new Proto().Message(1, new Proto()
            .Message(1, Resource(serviceName))
            .Message(2, new Proto()
                .Message(1, new Proto().Text(1, "App.Notes"))
                .Message(2, new Proto().Fixed64(1, Nanos(at)).Varint(2, (ulong)severity).Text(3, "Information").Message(5, new Proto().Text(1, body))))).ToArray();

    private static Proto Resource(string serviceName) => new Proto().Message(1, Attribute("service.name", serviceName));

    private static Proto Attribute(string key, string value) => new Proto().Text(1, key).Message(2, new Proto().Text(1, value));

    private static Proto IntAttribute(string key, long value) => new Proto().Text(1, key).Message(2, new Proto().Varint(3, (ulong)value));

    private static ulong Nanos(DateTimeOffset at) => (ulong)(at - DateTimeOffset.UnixEpoch).Ticks * 100UL;

    private sealed class Proto
    {
        private readonly MemoryStream buffer = new();

        public Proto Varint(int field, ulong value)
        {
            Tag(field, 0);
            Raw(value);
            return this;
        }

        public Proto Fixed64(int field, ulong value)
        {
            Tag(field, 1);
            Span<byte> bytes = stackalloc byte[8];
            BinaryPrimitives.WriteUInt64LittleEndian(bytes, value);
            buffer.Write(bytes);
            return this;
        }

        public Proto Double(int field, double value) => Fixed64(field, BitConverter.DoubleToUInt64Bits(value));

        public Proto Bytes(int field, byte[] value)
        {
            Tag(field, 2);
            Raw((ulong)value.Length);
            buffer.Write(value);
            return this;
        }

        public Proto Text(int field, string value) => Bytes(field, Encoding.UTF8.GetBytes(value));

        public Proto Message(int field, Proto value) => Bytes(field, value.ToArray());

        public byte[] ToArray() => buffer.ToArray();

        private void Tag(int field, int wire) => Raw((ulong)((field << 3) | wire));

        private void Raw(ulong value)
        {
            while (value >= 0x80)
            {
                buffer.WriteByte((byte)(value | 0x80));
                value >>= 7;
            }

            buffer.WriteByte((byte)value);
        }
    }
}
