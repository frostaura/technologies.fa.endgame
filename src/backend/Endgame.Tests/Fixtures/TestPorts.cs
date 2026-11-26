using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// Loopback ports for hosts a test starts itself. A port is asked of the operating system and then
/// released for the host to bind, so two tests in this process could be handed the same one before
/// either bound it: every port given out here is remembered and never given twice.
/// </summary>
public static class TestPorts
{
    private static readonly ConcurrentDictionary<int, byte> Given = new();

    public static int Free()
    {
        while (true)
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            if (Given.TryAdd(port, 0))
            {
                return port;
            }
        }
    }
}
