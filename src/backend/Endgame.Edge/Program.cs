namespace Endgame.Edge;

// A named entry point rather than top-level statements: the test project references both the edge
// and the control plane, and two generated global `Program` classes would collide there.
internal static class Program
{
    private static void Main(string[] args) => EdgeHost.Create(args).Run();
}
