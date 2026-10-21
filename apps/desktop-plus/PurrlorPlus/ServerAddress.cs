using System.Net.Http;
using System.Text.Json;

namespace PurrlorPlus;

/// <summary>
/// The PurrlorPlus server the desktop app opens: the address of a PurrlorPlus web client deployment
/// (e.g. https://purr.meowops.net), not a Matrix homeserver. Whether that deployment is locked to
/// one homeserver or lets people pick is up to it (its /config.json); the desktop app only picks
/// which deployment to load.
/// </summary>
internal static class ServerAddress
{
    public const string Default = "https://purr.meowops.net";

    /// <summary>Turns what someone typed ("purr.example.com", "https://purr.example.com/login")
    /// into the origin to load. PurrlorPlus is always served from the root of its origin (it fetches
    /// /config.json and registers /sw.js), so any path is dropped.</summary>
    public static bool TryNormalize(string? input, out Uri origin, out string error)
    {
        origin = null!;
        var text = (input ?? "").Trim();
        if (text.Length == 0) { error = "Enter a server address."; return false; }
        if (!text.Contains("://")) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host))
        {
            error = "That isn't a valid address."; return false;
        }
        if (!string.IsNullOrEmpty(uri.UserInfo)) { error = "The address can't contain a username or password."; return false; }
        bool local = uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase);
        if (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && local))
        {
            // Voice, notifications and encryption all need a secure context.
            error = "The server must use https://."; return false;
        }
        origin = new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
        error = "";
        return true;
    }

    public static bool IsSameOrigin(string? uri, Uri server) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var u) &&
        u.Scheme == server.Scheme &&
        u.Port == server.Port &&
        u.Host.Equals(server.Host, StringComparison.OrdinalIgnoreCase);

    public static string DisplayName(Uri server) => server.IsDefaultPort ? server.Host : $"{server.Host}:{server.Port}";

    /// <summary>Every PurrlorPlus web deployment serves /config.json (apps/web/deploy/40-purrlor-config.sh),
    /// so reading it back as a JSON object is a cheap check that the address is right.</summary>
    public static async Task<string?> ProbeAsync(Uri server)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            using var res = await http.GetAsync(new Uri(server, "config.json"));
            if (!res.IsSuccessStatusCode) return $"The server answered {(int)res.StatusCode} {res.ReasonPhrase}.";
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement.ValueKind == JsonValueKind.Object ? null : "The server didn't return a PurrlorPlus config.";
        }
        catch (JsonException) { return "That server doesn't look like a PurrlorPlus web client (no config.json)."; }
        catch (TaskCanceledException) { return "The server didn't answer in time."; }
        catch (Exception ex) { return "Couldn't reach the server: " + ex.Message; }
    }
}
