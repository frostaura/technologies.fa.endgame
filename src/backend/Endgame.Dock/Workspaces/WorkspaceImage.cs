using System.Formats.Tar;
using System.Security.Cryptography;
using System.Text;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Api;
using Endgame.Dock.Engine;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Workspaces;

/// <summary>
/// Makes sure the workspace image exists: the configured one, or Dock's own, built through the
/// Engine API from the embedded Dockerfile, the build script and the app-kit template.
/// </summary>
public sealed class WorkspaceImage(
    DockerClient docker,
    IOptions<DockOptions> options,
    ResourceNames names,
    ILogger<WorkspaceImage> logger) : BackgroundService
{
    private readonly TaskCompletionSource<string> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private volatile string status = "pending";

    /// <summary><c>pending</c>, <c>building</c>, <c>ready</c> or <c>failed: …</c> — for the health report.</summary>
    public string Status => status;

    public string? Name { get; private set; }

    /// <summary>The image name once ready; a 503 problem while it is being prepared.</summary>
    public string Require()
    {
        if (ready.Task.IsCompletedSuccessfully)
        {
            return ready.Task.Result;
        }

        throw new DockProblem(StatusCodes.Status503ServiceUnavailable, DockProblemCodes.WorkspaceImageNotReady,
            "Workspaces are being prepared.", status);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var name = await EnsureAsync(stoppingToken);
                Name = name;
                status = "ready";
                ready.TrySetResult(name);
                return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                status = "failed: " + e.Message;
                logger.LogError(e, "The workspace image could not be prepared; retrying in a minute.");
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
        }
    }

    private async Task<string> EnsureAsync(CancellationToken cancellationToken)
    {
        if (options.Value.WorkspaceImage is { Length: > 0 } configured)
        {
            await docker.Images.InspectImageAsync(configured, cancellationToken);
            return configured;
        }

        var files = ContextFiles();
        var name = $"{options.Value.WorkspaceImageRepository}:{Hash(files)}";
        try
        {
            await docker.Images.InspectImageAsync(name, cancellationToken);
            logger.LogInformation("Workspace image {Image} is present.", name);
            return name;
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
        }

        status = "building";
        logger.LogInformation("Building the workspace image {Image}; this takes a few minutes the first time.", name);
        using var context = new MemoryStream();
        await using (var tar = new TarWriter(context, TarEntryFormat.Pax, leaveOpen: true))
        {
            await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.Directory, "template/") { Mode = (UnixFileMode)0b111_101_101 }, cancellationToken);
            foreach (var (path, content) in files)
            {
                var entry = new PaxTarEntry(TarEntryType.RegularFile, path)
                {
                    Mode = (UnixFileMode)0b110_100_100,
                    DataStream = new MemoryStream(content, writable: false),
                };
                await tar.WriteEntryAsync(entry, cancellationToken);
            }
        }

        context.Position = 0;
        var log = new OutputCapture(32 * 1024);
        string? error = null;
        var progress = new Progress<JSONMessage>(m =>
        {
            if (m.Stream is { Length: > 0 } line)
            {
                log.Append(Encoding.UTF8.GetBytes(line));
            }

            if (m.Error?.Message is { Length: > 0 } message)
            {
                error = message;
            }
        });
        var labels = names.Labels("workspace-image");
        await docker.Images.BuildImageFromDockerfileAsync(new ImageBuildParameters
        {
            Tags = [name],
            Dockerfile = "Dockerfile",
            Remove = true,
            ForceRemove = true,
            Labels = labels,
        }, context, [], new Dictionary<string, string>(), progress, cancellationToken);

        try
        {
            await docker.Images.InspectImageAsync(name, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            throw new InvalidOperationException($"The workspace image build failed: {error ?? "no image was produced"}\n{log}");
        }

        logger.LogInformation("Workspace image {Image} built.", name);
        return name;
    }

    private List<(string Path, byte[] Content)> ContextFiles()
    {
        var files = new List<(string, byte[])>
        {
            ("Dockerfile", Embedded("workspace.Dockerfile")),
            ("endgame-build.sh", Embedded("endgame-build.sh")),
        };
        var template = options.Value.TemplateDirectory;
        if (Directory.Exists(template))
        {
            foreach (var file in Directory.EnumerateFiles(template, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
            {
                var relative = Path.GetRelativePath(template, file).Replace('\\', '/');
                if (relative.Split('/').Any(s => s is ".git" or "bin" or "obj" or "node_modules"))
                {
                    continue;
                }

                files.Add(("template/" + relative, File.ReadAllBytes(file)));
            }
        }

        return files;
    }

    private static string Hash(IEnumerable<(string Path, byte[] Content)> files)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var (path, content) in files)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(path + "\0"));
            hash.AppendData(SHA256.HashData(content));
        }

        return Convert.ToHexString(hash.GetHashAndReset())[..16].ToLowerInvariant();
    }

    private static byte[] Embedded(string name)
    {
        using var stream = typeof(WorkspaceImage).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded resource {name} is missing.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
