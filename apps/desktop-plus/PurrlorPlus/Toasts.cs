using Microsoft.Toolkit.Uwp.Notifications;
using Microsoft.Web.WebView2.Core;

namespace PurrlorPlus;

/// <summary>
/// The page's notifications as Windows notifications: they sit in the Action Center, follow Focus
/// Assist and Do Not Disturb, and clicking one opens PurrlorPlus at what it was about (the page's own
/// click handler runs, as it would in a browser). PurrlorPlus registers itself with Windows for them
/// the first time; `PurrlorPlus.exe --cleanup` (the uninstaller) takes that back off.
/// </summary>
internal sealed class Toasts
{
    private const string Group = "purrlor";
    private const int Remembered = 50;

    private readonly Control ui;
    private readonly Action<CoreWebView2Notification?> clicked;
    // The page's notification for each toast still on screen or in the Action Center, so a click
    // can be reported back to the right one. Oldest first.
    private readonly List<(string Tag, CoreWebView2Notification Notification)> live = new();

    /// <param name="clicked">Called on the UI thread when a toast is clicked, with its notification if the page still has it.</param>
    public Toasts(Control ui, Action<CoreWebView2Notification?> clicked)
    {
        this.ui = ui;
        this.clicked = clicked;
        // Raised on a background thread, also for toasts from before a restart (then with no notification).
        ToastNotificationManagerCompat.OnActivated += args =>
        {
            var arguments = ToastArguments.Parse(args.Argument);
            arguments.TryGetValue("id", out string? id);
            try { ui.BeginInvoke(() => this.clicked(Take(id))); } catch (InvalidOperationException) { }
        };
    }

    /// <summary>Shows one. False when Windows wouldn't (notifications switched off for PurrlorPlus, say), so the caller can fall back.</summary>
    public bool Show(CoreWebView2Notification notification)
    {
        string tag = Guid.NewGuid().ToString("N")[..16];
        try
        {
            var builder = new ToastContentBuilder()
                .AddArgument("id", tag)
                .AddText(string.IsNullOrWhiteSpace(notification.Title) ? "PurrlorPlus" : notification.Title);
            if (!string.IsNullOrWhiteSpace(notification.Body)) builder.AddText(notification.Body);
            if (notification.IsSilent) builder.AddAudio(new ToastAudio { Silent = true });
            builder.Show(toast =>
            {
                toast.Tag = tag;
                toast.Group = Group;
                // Old chat doesn't need to wait in the Action Center for days.
                toast.ExpirationTime = DateTimeOffset.Now.AddHours(12);
            });
        }
        catch (Exception ex)
        {
            AppPaths.LogError("toast", ex);
            return false;
        }

        live.Add((tag, notification));
        if (live.Count > Remembered) live.RemoveAt(0);
        // The page closed it (the message was read elsewhere, say): take it off the screen too.
        notification.CloseRequested += (_, _) =>
        {
            Take(tag);
            try { ToastNotificationManagerCompat.History.Remove(tag, Group); } catch { }
        };
        return true;
    }

    private CoreWebView2Notification? Take(string? tag)
    {
        int i = live.FindIndex(t => t.Tag == tag);
        if (i < 0) return null;
        var n = live[i].Notification;
        live.RemoveAt(i);
        return n;
    }

    /// <summary>Removes PurrlorPlus's toasts and its registration with Windows (uninstalling).</summary>
    public static void Uninstall()
    {
        try { ToastNotificationManagerCompat.Uninstall(); } catch (Exception ex) { AppPaths.LogError("toast uninstall", ex); }
    }
}
