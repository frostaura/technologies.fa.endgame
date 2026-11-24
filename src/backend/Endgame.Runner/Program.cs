namespace Endgame.Runner;

// A named entry point rather than top-level statements: the test project references the Runner and
// the control plane, and two generated global `Program` classes would collide there.
internal static class Program
{
    private static void Main(string[] args) => RunnerHost.Create(args).Run();
}
