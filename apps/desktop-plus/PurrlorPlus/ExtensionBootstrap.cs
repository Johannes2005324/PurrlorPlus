using Microsoft.Web.WebView2.Core;
using System.Reflection;
using System.Text.Json;

namespace PurrlorPlus;

internal static class ExtensionBootstrap
{
    public static async Task<string> RegisterAsync(CoreWebView2 core, Uri server, bool safeMode)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PurrlorPlus.Extensions.bootstrap.js")
            ?? throw new InvalidOperationException("Der Erweiterungskern fehlt.");
        using var reader = new StreamReader(stream);
        var script = await reader.ReadToEndAsync();
        using var toolsStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PurrlorPlus.Extensions.messageTools.js")
            ?? throw new InvalidOperationException("Die Nachrichtenwerkzeuge fehlen.");
        using var toolsReader = new StreamReader(toolsStream);
        script = script.Replace("/* PURRLORPLUS_MESSAGE_TOOLS */", await toolsReader.ReadToEndAsync());
        using var clientToolsStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PurrlorPlus.Extensions.clientTools.js")
            ?? throw new InvalidOperationException("Die Clientwerkzeuge fehlen.");
        using var clientToolsReader = new StreamReader(clientToolsStream);
        script = script.Replace("/* PURRLORPLUS_CLIENT_TOOLS */", await clientToolsReader.ReadToEndAsync());
        using var richStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PurrlorPlus.Extensions.richTools.js")
            ?? throw new InvalidOperationException("Die Medienwerkzeuge fehlen.");
        using var richReader = new StreamReader(richStream);
        script = script.Replace("/* PURRLORPLUS_RICH_TOOLS */", await richReader.ReadToEndAsync());
        var config = JsonSerializer.Serialize(new { origin = server.GetLeftPart(UriPartial.Authority), safeMode });
        return await core.AddScriptToExecuteOnDocumentCreatedAsync("(() => { const config = " + config + "; " + script + "\n})();");
    }
}
