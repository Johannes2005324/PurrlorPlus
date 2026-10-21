using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PurrlorPlus;

/// <summary>
/// Keeps the app up to date from its GitHub releases. It looks for a newer `desktop-vX.Y.Z`
/// release, downloads its installer in the background, and checks the installer's signature
/// before it will run it: the release workflow signs every installer with a key only it holds
/// (the DESKTOP_UPDATE_SIGNING_KEY secret), and this app carries the public half
/// (UpdatePublicKey in PurrlorPlus.csproj). The signature covers the version too, so an older
/// installer can't be passed off as a newer one. An installer that doesn't verify is deleted, never
/// run. The update itself happens when you restart or quit PurrlorPlus, as a silent reinstall.
///
/// Builds without a public key (a fork that hasn't made one) only ever say a new version exists.
/// </summary>
internal sealed class Updater : IDisposable
{
    public enum State { Idle, Checking, UpToDate, Downloading, Ready, Failed }

    public sealed record Status(State State, string? Version = null, string? Error = null, string? ReleaseUrl = null);

    private const string InstallerAsset = "PurrlorPlus-Setup.exe";
    private const string SignatureAsset = "PurrlorPlus-Setup.exe.sig";
    private const string TagPrefix = "plus-v";
    private static readonly TimeSpan FirstCheck = TimeSpan.FromMinutes(2), Every = TimeSpan.FromHours(6);

    private readonly string? repository = Metadata("UpdateRepository");
    private readonly ECDsa? publicKey = LoadKey(Metadata("UpdatePublicKey"));
    private readonly Version current = Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);
    private readonly Control ui;
    private readonly Action<Status> changed;
    private readonly System.Windows.Forms.Timer timer = new();
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(10) };
    private bool busy;

    public Status Current { get; private set; } = new(State.Idle);
    /// <summary>The verified installer waiting to run, when Current is Ready.</summary>
    private string? readyInstaller;

    public static string Folder => Path.Combine(AppPaths.Root, "Updates");
    public bool CanInstall => repository != null && publicKey != null;

    /// <param name="changed">Called on the UI thread whenever Current changes.</param>
    public Updater(Control ui, Action<Status> changed)
    {
        this.ui = ui;
        this.changed = changed;
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("PurrlorPlusDesktop", current.ToString(3)));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        timer.Tick += async (_, _) => { timer.Interval = (int)Every.TotalMilliseconds; await CheckAsync(); };
    }

    /// <summary>Checks now and then every few hours, or stops checking.</summary>
    public void Schedule(bool automatic)
    {
        timer.Stop();
        if (!automatic || repository == null) return;
        timer.Interval = (int)FirstCheck.TotalMilliseconds;
        timer.Start();
    }

    public async Task CheckAsync()
    {
        if (busy || repository == null || Current.State == State.Ready) return;
        busy = true;
        try
        {
            Set(new Status(State.Checking));
            var release = await FindNewerReleaseAsync();
            if (release == null) { Set(new Status(State.UpToDate)); return; }
            var (version, url, installer, signature) = release.Value;
            if (publicKey == null || installer == null || signature == null)
            {
                // Can't check it, so can't install it: say it's there and link to it.
                Set(new Status(State.Failed, version.ToString(3), "Download the new version from its release page.", url));
                return;
            }
            Set(new Status(State.Downloading, version.ToString(3), ReleaseUrl: url));
            var path = await DownloadAsync(version, installer, signature);
            readyInstaller = path;
            Set(new Status(State.Ready, version.ToString(3), ReleaseUrl: url));
        }
        catch (Exception ex)
        {
            AppPaths.LogError("update", ex);
            Set(new Status(State.Failed, Current.Version, ex is UpdateRejected ? ex.Message : "Couldn't check for updates.", Current.ReleaseUrl));
        }
        finally { busy = false; }
    }

    private async Task<(Version, string, string?, string?)?> FindNewerReleaseAsync()
    {
        using var response = await http.GetAsync($"https://api.github.com/repos/{repository}/releases?per_page=30");
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        (Version, string, string?, string?)? best = null;
        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean()) continue;
            var tag = release.GetProperty("tag_name").GetString() ?? "";
            if (!tag.StartsWith(TagPrefix) || !Version.TryParse(tag[TagPrefix.Length..], out var version)) continue;
            version = new Version(version.Major, version.Minor, Math.Max(0, version.Build));
            if (version <= Normalize(current) || (best != null && version <= best.Value.Item1)) continue;
            string? Asset(string name) => release.GetProperty("assets").EnumerateArray()
                .Where(a => a.GetProperty("name").GetString() == name)
                .Select(a => a.GetProperty("browser_download_url").GetString())
                .FirstOrDefault();
            best = (version, release.GetProperty("html_url").GetString() ?? "", Asset(InstallerAsset), Asset(SignatureAsset));
        }
        return best;
    }

    private async Task<string> DownloadAsync(Version version, string installerUrl, string signatureUrl)
    {
        Directory.CreateDirectory(Folder);
        var target = Path.Combine(Folder, $"PurrlorPlus-Setup-{version.ToString(3)}.exe");
        var partial = target + ".download";
        var signature = Convert.FromBase64String((await http.GetStringAsync(signatureUrl)).Trim());
        await using (var output = File.Create(partial))
        await using (var input = await http.GetStreamAsync(installerUrl))
            await input.CopyToAsync(output);

        if (!Verify(partial, version, signature))
        {
            File.Delete(partial);
            throw new UpdateRejected($"The download of {version.ToString(3)} didn't match its signature, so it wasn't installed.");
        }
        File.Move(partial, target, overwrite: true);
        File.WriteAllBytes(target + ".sig", signature);
        // Only the newest is kept.
        foreach (var old in Directory.GetFiles(Folder).Where(f => !f.StartsWith(target, StringComparison.OrdinalIgnoreCase)))
            try { File.Delete(old); } catch { }
        return target;
    }

    /// <summary>What the release workflow signs: the version and the installer's SHA-256 (desktop.yml).</summary>
    private bool Verify(string installer, Version version, byte[] signature)
    {
        if (publicKey == null) return false;
        string hash;
        using (var stream = File.OpenRead(installer)) hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        var message = Encoding.UTF8.GetBytes($"purrlorplus-desktop-update\n{version.ToString(3)}\n{hash}\n");
        return publicKey.VerifyData(message, signature, HashAlgorithmName.SHA256);
    }

    /// <summary>
    /// At startup: an installer downloaded last time that's newer than this copy, and still verifies,
    /// is ready to go. Anything else in the folder is cleared out.
    /// </summary>
    public void LoadDownloaded()
    {
        if (!Directory.Exists(Folder)) return;
        foreach (var file in Directory.GetFiles(Folder, "PurrlorPlus-Setup-*.exe"))
        {
            var name = Path.GetFileNameWithoutExtension(file)["PurrlorPlus-Setup-".Length..];
            if (Version.TryParse(name, out var version) && version > Normalize(current)
                && File.Exists(file + ".sig") && Verify(file, version, File.ReadAllBytes(file + ".sig")))
            {
                readyInstaller = file;
                Set(new Status(State.Ready, version.ToString(3)));
                return;
            }
        }
        foreach (var file in Directory.GetFiles(Folder)) try { File.Delete(file); } catch { }
    }

    /// <summary>
    /// Runs the waiting installer silently. It stops this copy itself, so the caller exits straight
    /// after. With `relaunch`, the new version starts when it's done (in the tray with `tray`).
    /// </summary>
    public bool Install(bool relaunch, bool tray)
    {
        var path = readyInstaller;
        if (path == null || Current.Version == null || !Version.TryParse(Current.Version, out var version)) return false;
        // Checked again right before running it, not trusted from when it was downloaded.
        if (!File.Exists(path + ".sig") || !Verify(path, version, File.ReadAllBytes(path + ".sig"))) return false;
        var arguments = "/S" + (relaunch ? " /RELAUNCH" : "") + (relaunch && tray ? " /TRAY" : "");
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path, arguments) { UseShellExecute = false }); return true; }
        catch (Exception ex) { AppPaths.LogError("update install", ex); return false; }
    }

    private void Set(Status status)
    {
        Current = status;
        try { ui.BeginInvoke(() => changed(status)); } catch (InvalidOperationException) { }
    }

    private static Version Normalize(Version v) => new(v.Major, v.Minor, Math.Max(0, v.Build));

    private static string? Metadata(string key) =>
        Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == key)?.Value is { Length: > 0 } value ? value : null;

    private static ECDsa? LoadKey(string? spki)
    {
        if (spki == null) return null;
        try
        {
            var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(spki), out _);
            return key;
        }
        catch (Exception ex) { AppPaths.LogError("update key", ex); return null; }
    }

    public void Dispose()
    {
        timer.Dispose();
        http.Dispose();
        publicKey?.Dispose();
    }

    private sealed class UpdateRejected(string message) : Exception(message);
}
