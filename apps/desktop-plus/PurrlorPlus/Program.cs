using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;
using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace PurrlorPlus;

internal static class Program
{
    internal static bool SafeMode;
    private const string InstanceMutexName = @"Local\PurrlorPlus.Desktop.Instance";
    internal const string ShowEventName = @"Local\PurrlorPlus.Desktop.Show";

    [STAThread]
    static void Main(string[] args)
    {
        // The uninstaller, once PurrlorPlus has stopped: what it registered with Windows goes too.
        if (args.Any(a => a.Equals("--cleanup", StringComparison.OrdinalIgnoreCase)))
        {
            Toasts.Uninstall();
            return;
        }

        // One copy per user: a second launch (Start menu, desktop shortcut, the installer's
        // "run now") just brings the running one out of the tray.
        using var instance = new Mutex(true, InstanceMutexName, out bool first);
        if (!first)
        {
            try { using var show = EventWaitHandle.OpenExisting(ShowEventName); show.Set(); } catch { }
            return;
        }

        SafeMode = Environment.GetEnvironmentVariable("PURRLORPLUS_SAFE_MODE") == "1" || args.Any(a => a.Equals("--safe-mode", StringComparison.OrdinalIgnoreCase));
        Environment.SetEnvironmentVariable("PURRLORPLUS_SAFE_MODE", null);
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
        {
            AppPaths.LogError("unhandled", e.Exception);
            MessageBox.Show($"PurrlorPlus encountered an unexpected error.\n\n{e.Exception.Message}",
                "PurrlorPlus", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => AppPaths.LogError("fatal", e.ExceptionObject);

        var settings = AppSettings.Load();
        if (!ServerAddress.TryNormalize(settings.ServerUrl, out _, out _))
        {
            using var dialog = new ServerDialog(null, firstRun: true);
            if (dialog.ShowDialog() != DialogResult.OK || dialog.Server == null) return;
            settings.ServerUrl = dialog.Server.ToString();
            settings.Save();
        }

        bool startInTray = args.Any(a => a.Equals("--tray", StringComparison.OrdinalIgnoreCase));
        Application.Run(new MainForm(settings, startInTray));
    }
}

internal static class AppPaths
{
    public static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PurrlorPlus");
    public static readonly string Settings = Path.Combine(Root, "settings.json");
    public static readonly string ErrorLog = Path.Combine(Root, "errors.log");
    public static readonly string WebView = Path.Combine(Root, "WebView2");

    public static void LogError(string context, object? error)
    {
        try
        {
            Directory.CreateDirectory(Root);
            File.AppendAllText(ErrorLog, $"{DateTime.Now:u} {context}: {error}\n");
        }
        catch { }
    }
}

internal sealed class AppSettings
{
    public string? ServerUrl { get; set; }
    public Rectangle? Bounds { get; set; }
    public bool Maximized { get; set; }
    public bool StartWithWindows { get; set; }
    // Kept when a settings file from before this setting is read: the close button always hid to the tray then.
    public bool CloseToTray { get; set; } = true;
    public bool AutoUpdate { get; set; } = true;
    public bool TrayHintShown { get; set; }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        try { if (File.Exists(AppPaths.Settings)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.Settings)) ?? new(); }
        catch (Exception ex) { AppPaths.LogError("settings", ex); }
        return new();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            var temporary = AppPaths.Settings + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(this, JsonOptions));
            File.Move(temporary, AppPaths.Settings, overwrite: true);
        }
        catch (Exception ex) { AppPaths.LogError("settings", ex); }
    }
}

internal sealed class WindowButton : Control
{
    private bool hover;
    private bool pressed;
    public string Glyph { get; set; } = "";
    public Color HoverColor { get; set; } = Color.FromArgb(30, 33, 39);
    public Color PressedColor { get; set; } = Color.FromArgb(42, 45, 52);

    public WindowButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        SetStyle(ControlStyles.Selectable, false);
        SetStyle(ControlStyles.StandardClick, true);
        SetStyle(ControlStyles.StandardDoubleClick, false);
        TabStop = false;
        Cursor = Cursors.Default;
        BackColor = MainForm.ChromeColor;
        ForeColor = Color.White;
        Width = 46;
        Height = 38;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left) { pressed = true; Invalidate(); }
        base.OnMouseDown(e);
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        pressed = false; Invalidate(); base.OnMouseUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
        if (pressed) using (var b = new SolidBrush(PressedColor)) e.Graphics.FillRectangle(b, ClientRectangle);
        else if (hover) using (var b = new SolidBrush(HoverColor)) e.Graphics.FillRectangle(b, ClientRectangle);
        using var pen = new Pen(ForeColor, 1.2f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        float cx = Width / 2f, cy = Height / 2f;
        if (Glyph == "min") e.Graphics.DrawLine(pen, cx - 6, cy + 4, cx + 6, cy + 4);
        else if (Glyph == "max") e.Graphics.DrawRectangle(pen, cx - 5, cy - 5, 10, 10);
        else if (Glyph == "restore") { e.Graphics.DrawRectangle(pen, cx - 3, cy - 5, 8, 8); e.Graphics.DrawRectangle(pen, cx - 6, cy - 2, 8, 8); }
        else if (Glyph == "close") { e.Graphics.DrawLine(pen, cx - 5, cy - 5, cx + 5, cy + 5); e.Graphics.DrawLine(pen, cx + 5, cy - 5, cx - 5, cy + 5); }
    }
}

public sealed class MainForm : Form
{
    public static readonly Color ChromeColor = Color.FromArgb(13, 15, 19);
    private static readonly Color CloseHover = Color.FromArgb(190, 45, 39);
    private static readonly Color MutedText = Color.FromArgb(150, 156, 166);
    private const int TitleBarHeight = 40;
    private const int ResizeGrip = 6;
    private const int WM_NCCALCSIZE = 0x0083;
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_NCACTIVATE = 0x0086;
    private const int WM_SETTEXT = 0x000C;
    private const int WM_SETICON = 0x0080;
    private const int GWL_STYLE = -16;
    private const int WS_VISIBLE = 0x10000000;
    private const int WM_QUERYENDSESSION = 0x0011;
    private const int WM_ENDSESSION = 0x0016;
    private const int WS_THICKFRAME = 0x00040000;
    private const int WS_MINIMIZEBOX = 0x00020000;
    private const int WS_MAXIMIZEBOX = 0x00010000;
    private const int WS_SYSMENU = 0x00080000;
    private const int HTCLIENT = 1, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14,
        HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWA_CAPTION_COLOR = 35;
    private const int DWMWA_TEXT_COLOR = 36;

    // Permissions the PurrlorPlus web client asks for: voice/video, desktop notifications, reading
    // pasted images, and autoplaying call audio. Only ever granted to the configured server.
    private static readonly HashSet<CoreWebView2PermissionKind> GrantedToServer = new()
    {
        CoreWebView2PermissionKind.Microphone,
        CoreWebView2PermissionKind.Camera,
        CoreWebView2PermissionKind.Notifications,
        CoreWebView2PermissionKind.ClipboardRead,
        CoreWebView2PermissionKind.Autoplay,
        CoreWebView2PermissionKind.MultipleAutomaticDownloads,
    };

    private WebView2 webView = new();
    private readonly Panel titleBar = new();
    private readonly Label titleLabel = new();
    private readonly Label serverLabel = new();
    private readonly WindowButton minimizeButton = new() { Glyph = "min" };
    private readonly WindowButton maximizeButton = new() { Glyph = "max" };
    private readonly WindowButton closeButton = new() { Glyph = "close", HoverColor = CloseHover };
    private readonly Panel loadingOverlay = new();
    private readonly Label loadingLabel = new();
    private readonly FlowLayoutPanel overlayActions = new();
    private readonly NotifyIcon trayIcon;
    private readonly ContextMenuStrip trayMenu = new();
    private readonly AppSettings settings;
    private readonly EventWaitHandle showSignal;
    private readonly RegisteredWaitHandle showWait;
    private Uri server;
    private bool startHidden;
    private bool allowExit;
    private bool extensionEditing;
    private bool webViewReady;
    private bool restoringAfterCrash;
    private bool pageLoaded;
    private CoreWebView2Notification? lastNotification;
    private ToolStripMenuItem? startWithWindowsItem;
    private readonly GlobalHotkeys hotkeys;
    private readonly Toasts toasts;
    private readonly Badge badge;
    private readonly IdleWatch idleWatch;
    private readonly Updater updater;
    private readonly ToolStripMenuItem updateItem = new() { Visible = false };

    internal MainForm(AppSettings settings, bool startInTray)
    {
        this.settings = settings;
        ServerAddress.TryNormalize(settings.ServerUrl, out server, out _);
        startHidden = startInTray;
        Text = "PurrlorPlus";
        Width = 1280; Height = 820;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = ChromeColor;
        Icon = LoadAppIcon();
        // Started with --tray (Start with Windows): load in the background without flashing up.
        if (startHidden) Opacity = 0;
        ApplySavedBounds();

        // Reported from inside the hook, which has to return quickly: posted to the page afterwards.
        hotkeys = new GlobalHotkeys((id, down) => BeginInvoke(() => { if (!extensionEditing || !down) PostBridgeEvent("hotkey", new { Id = id, Down = down }); }));
        trayIcon = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Text = "PurrlorPlus", Visible = true, ContextMenuStrip = trayMenu };
        trayIcon.DoubleClick += (_, _) => RestoreFromTray();
        trayIcon.BalloonTipClicked += (_, _) => OnBalloonClicked();
        BuildTrayMenu();
        toasts = new Toasts(this, OnToastClicked);
        badge = new Badge(this, trayIcon, trayIcon.Icon);
        idleWatch = new IdleWatch(idle => PostBridgeEvent("idle", new { Idle = idle }));
        updater = new Updater(this, OnUpdateStatus);
        BuildChrome();
        BuildLoadingOverlay();
        Controls.Add(webView);
        Controls.Add(loadingOverlay);
        Controls.Add(titleBar);
        LayoutChrome();
        ApplyDarkDwmFrame();
        ShowServerName();

        // A second launch signals this to bring the window back.
        showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
        showWait = ThreadPool.RegisterWaitForSingleObject(showSignal, (_, _) =>
        {
            try { BeginInvoke(RestoreFromTray); } catch { }
        }, null, Timeout.Infinite, executeOnlyOnce: false);

        // Keep the Run entry pointing at wherever this copy is installed now.
        if (settings.StartWithWindows) SetStartup(true);

        Load += MainForm_Load;
        Shown += (_, _) =>
        {
            LayoutChrome();
            if (startHidden)
            {
                startHidden = false;
                BeginInvoke(() => { Hide(); Opacity = 1; });
                return;
            }
            if (settings.Maximized)
                BeginInvoke(new Action(() => { UpdateMaximizedBounds(); WindowState = FormWindowState.Maximized; UpdateMaximizeButton(); }));
        };
        FormClosing += MainForm_FormClosing;
        Resize += (_, _) => { LayoutChrome(); UpdateMaximizeButton(); };
        ClientSizeChanged += (_, _) => LayoutChrome();
        // The handle already exists (ApplyDarkDwmFrame); make Windows re-run WM_NCCALCSIZE on it.
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        LayoutChrome();
        Move += (_, _) => { if (WindowState == FormWindowState.Normal && Visible) SaveWindowState(); };
        FormClosed += (_, _) => DisposeResources();
    }

    private Icon LoadAppIcon()
    {
        try
        {
            // The published EXE contains the application icon. Extracting it avoids
            // relying on the .ico being copied beside the executable for tray usage.
            var extracted = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (extracted != null) return extracted;
        }
        catch { }
        try
        {
            var path = Path.Combine(Application.StartupPath, "purrlor.ico");
            if (File.Exists(path)) return new Icon(path);
        }
        catch { }
        return SystemIcons.Application;
    }

    private void BuildChrome()
    {
        titleBar.SetBounds(0, 0, ClientSize.Width, TitleBarHeight);
        titleBar.BackColor = ChromeColor;
        titleBar.MouseDown += TitleBar_MouseDown;
        titleBar.DoubleClick += (_, _) => ToggleMaximize();

        titleLabel.Text = "PurrlorPlus";
        titleLabel.ForeColor = Color.FromArgb(235, 238, 242);
        titleLabel.BackColor = Color.Transparent;
        titleLabel.Font = new Font("Segoe UI", 9.5f);
        titleLabel.TextAlign = ContentAlignment.MiddleLeft;
        titleLabel.Padding = new Padding(14, 0, 0, 0);
        titleLabel.Dock = DockStyle.Fill;
        titleLabel.AutoEllipsis = true;
        titleLabel.MouseDown += TitleBar_MouseDown;
        titleLabel.DoubleClick += (_, _) => ToggleMaximize();

        // Which server this window is on, and the way to change it.
        serverLabel.Dock = DockStyle.Right;
        serverLabel.AutoSize = false;
        serverLabel.Width = 220;
        serverLabel.TextAlign = ContentAlignment.MiddleRight;
        serverLabel.Padding = new Padding(0, 0, 12, 0);
        serverLabel.ForeColor = MutedText;
        serverLabel.BackColor = Color.Transparent;
        serverLabel.Font = new Font("Segoe UI", 9f);
        serverLabel.AutoEllipsis = true;
        serverLabel.Cursor = Cursors.Hand;
        serverLabel.MouseEnter += (_, _) => serverLabel.ForeColor = Color.FromArgb(235, 238, 242);
        serverLabel.MouseLeave += (_, _) => serverLabel.ForeColor = MutedText;
        serverLabel.Click += (_, _) => ChangeServer();
        new ToolTip().SetToolTip(serverLabel, "Change server");

        ConfigureButton(minimizeButton);
        ConfigureButton(maximizeButton);
        ConfigureButton(closeButton);
        minimizeButton.Click += (_, _) => WindowState = FormWindowState.Minimized;
        maximizeButton.Click += (_, _) => ToggleMaximize();
        closeButton.Click += (_, _) => CloseOrHide();

        // Left-to-right: Minimize, Maximize/Restore, Close.
        var buttons = new Panel { Dock = DockStyle.Right, Width = 138, Height = TitleBarHeight, BackColor = ChromeColor };
        buttons.Controls.Add(closeButton);
        buttons.Controls.Add(maximizeButton);
        buttons.Controls.Add(minimizeButton);
        closeButton.SetBounds(92, 0, 46, TitleBarHeight);
        maximizeButton.SetBounds(46, 0, 46, TitleBarHeight);
        minimizeButton.SetBounds(0, 0, 46, TitleBarHeight);
        titleBar.Controls.Add(titleLabel);
        titleBar.Controls.Add(serverLabel);
        titleBar.Controls.Add(buttons);
        titleBar.BringToFront();
    }

    private static void ConfigureButton(WindowButton button)
    {
        button.BackColor = ChromeColor;
        button.ForeColor = Color.FromArgb(235, 238, 242);
        button.Width = 46; button.Height = TitleBarHeight;
    }

    private void BuildLoadingOverlay()
    {
        loadingOverlay.BackColor = ChromeColor;
        loadingLabel.Text = "PurrlorPlus\r\nLoading…";
        loadingLabel.ForeColor = Color.FromArgb(220, 224, 230);
        loadingLabel.Font = new Font("Segoe UI", 11f);
        loadingLabel.TextAlign = ContentAlignment.MiddleCenter;
        loadingLabel.Dock = DockStyle.Fill;

        overlayActions.Dock = DockStyle.Bottom;
        overlayActions.Height = 120;
        overlayActions.FlowDirection = FlowDirection.LeftToRight;
        overlayActions.WrapContents = false;
        overlayActions.Visible = false;
        overlayActions.Controls.Add(OverlayButton("Retry", Color.FromArgb(88, 101, 242), Navigate));
        overlayActions.Controls.Add(OverlayButton("Change server…", Color.FromArgb(42, 45, 52), ChangeServer));
        overlayActions.Resize += (_, _) =>
        {
            int total = overlayActions.Controls.Cast<Control>().Sum(c => c.Width + c.Margin.Horizontal);
            overlayActions.Padding = new Padding(Math.Max(0, (overlayActions.Width - total) / 2), 0, 0, 0);
        };

        loadingOverlay.Controls.Add(loadingLabel);
        loadingOverlay.Controls.Add(overlayActions);
        loadingOverlay.BringToFront();
    }

    private static Button OverlayButton(string text, Color back, Action onClick)
    {
        var b = new Button { Text = text, Width = 140, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = back, ForeColor = Color.White, Margin = new Padding(6) };
        b.FlatAppearance.BorderSize = 0;
        b.Click += (_, _) => onClick();
        return b;
    }

    private void ShowOverlay(string message, bool withActions)
    {
        loadingLabel.Text = message;
        overlayActions.Visible = withActions;
        loadingOverlay.Visible = true;
        loadingOverlay.BringToFront();
    }

    private void HideOverlay() { loadingOverlay.Visible = false; overlayActions.Visible = false; }

    // The window has no system frame (see WM_NCCALCSIZE), so a thin strip of the form itself is
    // left around the content while it's not maximized: that strip is what answers WM_NCHITTEST
    // with the resize edges, since the title bar and WebView swallow hit-tests over themselves.
    private int EdgeInset => WindowState == FormWindowState.Normal ? ResizeGrip : 0;

    // Asks Windows: WinForms' cached ClientSize still assumes the frame WS_THICKFRAME would add.
    private Size RealClientSize() =>
        IsHandleCreated && GetClientRect(Handle, out var rc) ? new Size(rc.Right - rc.Left, rc.Bottom - rc.Top) : ClientSize;

    private void LayoutChrome()
    {
        int e = EdgeInset, bar = TitleBarHeight;
        var client = RealClientSize();
        var w = Math.Max(1, client.Width - 2 * e); var h = Math.Max(1, client.Height - 2 * e);
        titleBar.SetBounds(e, e, w, bar);
        webView.SetBounds(e, e + bar, w, Math.Max(1, h - bar));
        loadingOverlay.SetBounds(e, e + bar, w, Math.Max(1, h - bar));
        titleBar.BringToFront();
        if (!webViewReady || loadingOverlay.Visible) loadingOverlay.BringToFront();
    }

    private void BuildTrayMenu()
    {
        var extensions = new ToolStripMenuItem("Erweiterungen öffnen");
        extensions.Click += async (_, _) => { RestoreFromTray(); if (webView.CoreWebView2 != null) await webView.CoreWebView2.ExecuteScriptAsync("window.__purrlorPlus?.open()"); };
        var safe = new ToolStripMenuItem("Ohne Erweiterungen neu starten");
        safe.Click += (_, _) => { Environment.SetEnvironmentVariable("PURRLORPLUS_SAFE_MODE", "1"); allowExit = true; Application.Restart(); };
        trayMenu.Items.Add(extensions);
        trayMenu.Items.Add(safe);
        var show = new ToolStripMenuItem("Show PurrlorPlus"); show.Click += (_, _) => RestoreFromTray();
        var change = new ToolStripMenuItem("Change server…"); change.Click += (_, _) => { RestoreFromTray(); BeginInvoke(ChangeServer); };
        var start = new ToolStripMenuItem("Start with Windows") { Checked = settings.StartWithWindows, CheckOnClick = true };
        start.CheckedChanged += (_, _) => SetStartWithWindows(start.Checked);
        startWithWindowsItem = start;
        var exit = new ToolStripMenuItem("Exit PurrlorPlus"); exit.Click += (_, _) => Quit();
        updateItem.Click += (_, _) => InstallUpdate(relaunch: true);
        trayMenu.Items.Add(updateItem);
        trayMenu.Items.Add(show); trayMenu.Items.Add(change); trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add(start); trayMenu.Items.Add(new ToolStripSeparator()); trayMenu.Items.Add(exit);
    }

    private void SetStartWithWindows(bool enabled)
    {
        if (startWithWindowsItem != null && startWithWindowsItem.Checked != enabled) { startWithWindowsItem.Checked = enabled; return; } // CheckedChanged comes back here
        if (settings.StartWithWindows == enabled) return;
        settings.StartWithWindows = enabled; SetStartup(enabled); SaveSettings();
        PostBridgeEvent("settings", BridgeSettings());
    }

    private void CloseOrHide()
    {
        if (settings.CloseToTray) { MinimizeToTray(); return; }
        Quit();
    }

    /// <summary>Exits; a downloaded update installs on the way out (it's quiet and quick).</summary>
    private void Quit()
    {
        if (updater.Current.State == Updater.State.Ready) updater.Install(relaunch: false, tray: false);
        allowExit = true; Close();
    }

    private void InstallUpdate(bool relaunch)
    {
        if (!updater.Install(relaunch, tray: false))
        {
            ShowTrayMessage("Couldn't update PurrlorPlus", "The downloaded update didn't check out. PurrlorPlus will try again later.");
            return;
        }
        allowExit = true; Close();
    }

    private Updater.State lastUpdateState;

    private void OnUpdateStatus(Updater.Status status)
    {
        bool ready = status.State == Updater.State.Ready;
        updateItem.Text = ready ? $"Restart to update to {status.Version}" : "";
        updateItem.Visible = ready;
        if (ready && lastUpdateState != Updater.State.Ready)
            ShowTrayMessage($"PurrlorPlus {status.Version} is ready", "Restart PurrlorPlus to update, or it updates next time you quit it.");
        lastUpdateState = status.State;
        PostBridgeEvent("update", UpdateInfo());
    }

    private object UpdateInfo()
    {
        var s = updater.Current;
        return new
        {
            State = JsonNamingPolicy.CamelCase.ConvertName(s.State.ToString()),
            s.Version, s.Error, s.ReleaseUrl,
            Automatic = updater.CanInstall,
        };
    }

    private void ShowServerName()
    {
        var name = ServerAddress.DisplayName(server);
        serverLabel.Text = name;
        trayIcon.Text = TrimTo63(badge.Count > 0 ? $"PurrlorPlus — {name} ({badge.Count})" : $"PurrlorPlus — {name}");
    }

    // NotifyIcon.Text throws past 63 characters (and balloon titles are truncated there anyway).
    private static string TrimTo63(string s) => s.Length <= 63 ? s : s[..62] + "…";

    private void ChangeServer()
    {
        using var dialog = new ServerDialog(server.ToString(), firstRun: false);
        if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Server == null) return;
        // Each server keeps its own sign-in and encryption keys (browser storage is per origin),
        // so switching back later picks up where that server left off.
        server = dialog.Server;
        settings.ServerUrl = server.ToString();
        SaveSettings();
        ShowServerName();
        Navigate();
    }

    private string? extensionScriptId;
    private int navigationGeneration;

    private async void Navigate()
    {
        if (webView.CoreWebView2 == null) return;
        ShowOverlay($"PurrlorPlus\r\nConnecting to {ServerAddress.DisplayName(server)}…", withActions: false);
        try
        {
            var generation = ++navigationGeneration;
            var destination = server;
            var core = webView.CoreWebView2;
            var previousScriptId = extensionScriptId;
            extensionScriptId = null;
            if (previousScriptId != null) core.RemoveScriptToExecuteOnDocumentCreated(previousScriptId);
            var registered = await ExtensionBootstrap.RegisterAsync(core, destination, Program.SafeMode);
            if (generation != navigationGeneration) { core.RemoveScriptToExecuteOnDocumentCreated(registered); return; }
            extensionScriptId = registered;
            core.Navigate(destination.ToString());
        }
        catch (Exception ex) { AppPaths.LogError("extensions initialization", ex); ShowOverlay("Erweiterungen konnten nicht geladen werden. Bitte mit --safe-mode starten.", false); }
    }

    private void MinimizeToTray()
    {
        SaveWindowState(); Hide(); WindowState = FormWindowState.Minimized;
        if (!settings.TrayHintShown)
        {
            settings.TrayHintShown = true; settings.Save();
            ShowTrayMessage("PurrlorPlus is still running", "It stays in the tray so you keep getting notifications. Right-click the tray icon to exit.");
        }
    }

    private void RestoreFromTray()
    {
        Opacity = 1;
        Show();
        BeginInvoke(new Action(() =>
        {
            UpdateMaximizedBounds();
            WindowState = settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            Activate(); BringToFront(); UpdateMaximizeButton();
        }));
    }

    private void OnToastClicked(CoreWebView2Notification? notification)
    {
        RestoreFromTray();
        // Lets the web client run its notification click handler (it opens the room).
        try { notification?.ReportClicked(); } catch { }
    }

    private void OnBalloonClicked()
    {
        RestoreFromTray();
        // Lets the web client run its notification click handler (it opens the room).
        try { lastNotification?.ReportClicked(); } catch { }
        lastNotification = null;
    }

    private void MainForm_FormClosing(object? sender, FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.TaskManagerClosing || allowExit) return;
        if (!settings.CloseToTray) { allowExit = true; return; }
        e.Cancel = true; MinimizeToTray();
    }

    private void TitleBar_MouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        if (WindowState == FormWindowState.Maximized)
        {
            double ratio = Math.Clamp((double)e.X / Math.Max(1, titleBar.Width), 0.05, 0.95);
            ToggleMaximize();
            Left = Math.Max(0, Cursor.Position.X - (int)(Width * ratio));
            Top = Math.Max(0, Cursor.Position.Y - TitleBarHeight / 2);
        }
        ReleaseCapture(); SendMessage(Handle, 0x00A1, (IntPtr)2, IntPtr.Zero);
    }

    // WM_GETMINMAXINFO supplies monitor-relative bounds for every maximize path (including Snap).
    private void UpdateMaximizedBounds() { MaximizedBounds = Rectangle.Empty; }

    private void ToggleMaximize()
    {
        bool maximize = WindowState != FormWindowState.Maximized;
        if (maximize) UpdateMaximizedBounds();
        WindowState = maximize ? FormWindowState.Maximized : FormWindowState.Normal;
        BeginInvoke(new Action(() => { settings.Maximized = WindowState == FormWindowState.Maximized; SaveWindowState(); UpdateMaximizeButton(); }));
    }

    private void UpdateMaximizeButton() => maximizeButton.Glyph = WindowState == FormWindowState.Maximized ? "restore" : "max";

    private void ApplySavedBounds()
    {
        if (settings.Bounds is Rectangle r && r.Width >= MinimumSize.Width && r.Height >= MinimumSize.Height)
        {
            var valid = Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r));
            if (valid) Bounds = r; else StartPosition = FormStartPosition.CenterScreen;
        }
        else StartPosition = FormStartPosition.CenterScreen;
    }

    private void SaveWindowState()
    {
        if (WindowState == FormWindowState.Normal)
        {
            settings.Bounds = RestoreBounds.Width >= MinimumSize.Width && RestoreBounds.Height >= MinimumSize.Height ? RestoreBounds : Bounds;
            settings.Maximized = false;
        }
        else if (WindowState == FormWindowState.Maximized)
        {
            if (RestoreBounds.Width >= MinimumSize.Width && RestoreBounds.Height >= MinimumSize.Height) settings.Bounds = RestoreBounds;
            settings.Maximized = true;
        }
        settings.Save();
    }

    private void SaveSettings()
    {
        if (WindowState == FormWindowState.Normal && Visible) { settings.Bounds = Bounds; settings.Maximized = false; }
        settings.Save();
    }

    private static void SetStartup(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            if (enabled) key?.SetValue("PurrlorPlus", $"\"{Application.ExecutablePath}\" --tray"); else key?.DeleteValue("PurrlorPlus", false);
        }
        catch (Exception ex) { AppPaths.LogError("startup", ex); }
    }

    private void DisposeResources()
    {
        SaveSettings(); showWait.Unregister(null); showSignal.Dispose(); hotkeys.Dispose(); idleWatch.Dispose(); updater.Dispose(); badge.Dispose();
        trayIcon.Visible = false; trayIcon.Dispose(); trayMenu.Dispose(); webView.Dispose();
    }

    private async void MainForm_Load(object? sender, EventArgs e)
    {
        updater.LoadDownloaded();
        // Signing in to Windows with an update waiting: install it before anyone's using PurrlorPlus.
        if (startHidden && updater.Current.State == Updater.State.Ready && updater.Install(relaunch: true, tray: true))
        {
            allowExit = true; Close();
            return;
        }
        updater.Schedule(settings.AutoUpdate);
        await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.WebView);
            var environment = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebView);
            await webView.EnsureCoreWebView2Async(environment);
            var core = webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.UserAgent += $" PurrlorPlusDesktop/{Application.ProductVersion}";
            core.NewWindowRequested += Core_NewWindowRequested;
            core.NavigationStarting += Core_NavigationStarting;
            core.NavigationCompleted += Core_NavigationCompleted;
            core.PermissionRequested += Core_PermissionRequested;
            core.DownloadStarting += Core_DownloadStarting;
            core.ProcessFailed += Core_ProcessFailed;
            core.DocumentTitleChanged += (_, _) => BeginInvoke(UpdateTitle);
            core.WebMessageReceived += Core_WebMessageReceived;
            try { core.NotificationReceived += Core_NotificationReceived; }
            catch (Exception ex) { AppPaths.LogError("notifications unavailable on this WebView2 runtime", ex); }
            webViewReady = true;
            Navigate();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowOverlay("PurrlorPlus needs the Microsoft Edge WebView2 Runtime.\r\n\r\n" +
                        "Reinstall PurrlorPlus, or install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703", withActions: false);
        }
        catch (Exception ex)
        {
            ShowOverlay("PurrlorPlus\r\nUnable to start WebView2\r\n\r\n" + ex.Message, withActions: false);
            AppPaths.LogError("WebView2 init", ex);
        }
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (ServerAddress.IsSameOrigin(e.Uri, server) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
        {
            // A new page (a reload, another server) sets its own keybinds when it joins a call.
            extensionEditing = false; hotkeys.Clear(); idleWatch.Watch(0);
            return;
        }
        e.Cancel = true; OpenExternal(e.Uri);
    }

    // The web client puts unread counts in its title; show them on the taskbar too. Error pages
    // title themselves with the bare host, so those fall back to "PurrlorPlus".
    private void UpdateTitle()
    {
        var core = webView.CoreWebView2;
        var title = pageLoaded && core != null && !string.IsNullOrWhiteSpace(core.DocumentTitle) ? core.DocumentTitle : "PurrlorPlus";
        Text = title; titleLabel.Text = title;
    }

    private void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) { pageLoaded = e.IsSuccess; UpdateTitle(); }
        if (e.IsSuccess) { HideOverlay(); return; }
        // Cancelled means we sent a link to the browser ourselves, or a newer navigation replaced this one.
        if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        ShowOverlay($"Couldn't reach {ServerAddress.DisplayName(server)}\r\n({e.WebErrorStatus})", withActions: true);
    }

    private void Core_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // Same-server pop-ups — including the about:blank window the screen-share pop-out writes
        // into — get WebView2's own pop-up window so the page keeps its handle to them.
        if (ServerAddress.IsSameOrigin(e.Uri, server) || e.Uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase)) return;
        e.Handled = true; OpenExternal(e.Uri);
    }

    private void Core_PermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        if (!ServerAddress.IsSameOrigin(e.Uri, server)) { e.State = CoreWebView2PermissionState.Deny; return; }
        if (GrantedToServer.Contains(e.PermissionKind)) e.State = CoreWebView2PermissionState.Allow;
    }

    private void Core_DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        Directory.CreateDirectory(downloads);
        var name = Path.GetFileName(e.ResultFilePath); if (string.IsNullOrWhiteSpace(name)) name = "PurrlorPlus-download";
        e.ResultFilePath = GetUniquePath(Path.Combine(downloads, name)); e.Handled = true;
        e.DownloadOperation.StateChanged += (_, _) => { if (e.DownloadOperation.State == CoreWebView2DownloadState.Completed) ShowTrayMessage("Download complete", Path.GetFileName(e.ResultFilePath)); };
    }

    private void Core_NotificationReceived(object? sender, CoreWebView2NotificationReceivedEventArgs e)
    {
        try
        {
            e.Handled = true;
            var n = e.Notification;
            if (toasts.Show(n)) { n.ReportShown(); return; }
            // Windows wouldn't show it (PurrlorPlus's notifications off, or a Windows too old): the tray balloon instead.
            trayIcon.BalloonTipTitle = TrimTo63(string.IsNullOrWhiteSpace(n.Title) ? "PurrlorPlus" : n.Title);
            trayIcon.BalloonTipText = string.IsNullOrWhiteSpace(n.Body) ? "You have a new notification." : n.Body;
            trayIcon.ShowBalloonTip(5000);
            n.ReportShown();
            lastNotification = n;
        }
        catch (Exception ex) { AppPaths.LogError("notification", ex); }
    }

    private void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (allowExit) return;
        switch (e.ProcessFailedKind)
        {
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
            case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                BeginInvoke(() => { try { webView.CoreWebView2?.Reload(); } catch { } });
                return;
            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                break;
            default:
                // GPU, utility and frame processes are restarted by WebView2 itself.
                return;
        }
        if (restoringAfterCrash) return; restoringAfterCrash = true;
        BeginInvoke(async () =>
        {
            try
            {
                ShowOverlay("PurrlorPlus\r\nRecovering after an error…", withActions: false);
                Controls.Remove(webView); webView.Dispose();
                webView = new WebView2 { Dock = DockStyle.None }; Controls.Add(webView); LayoutChrome();
                await InitializeWebViewAsync();
            }
            finally { restoringAfterCrash = false; }
        });
    }

    // The bridge: the page (apps/web/src/desktop/desktopBridge.ts) asks the app for things over
    // WebView2's message channel. Only the configured server's own page is answered; a message from
    // anywhere else (a page the server sent us to that shouldn't have loaded, say) is ignored.
    private static readonly JsonSerializerOptions BridgeJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed class BridgeError(string message) : Exception(message);

    private void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!ServerAddress.IsSameOrigin(e.Source, server)) return;
        JsonElement message;
        try { using var doc = JsonDocument.Parse(e.WebMessageAsJson); message = doc.RootElement.Clone(); }
        catch { return; }
        if (message.ValueKind != JsonValueKind.Object
            || !message.TryGetProperty("purrlor", out var version) || version.ValueKind != JsonValueKind.Number || version.GetInt32() != 1
            || !message.TryGetProperty("id", out var idElement) || !idElement.TryGetInt64(out var id)) return;
        var method = message.TryGetProperty("method", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
        message.TryGetProperty("params", out var parameters);
        try { PostBridge(new Dictionary<string, object?> { ["purrlor"] = 1, ["id"] = id, ["result"] = HandleBridgeRequest(method, parameters) }); }
        catch (BridgeError ex) { PostBridge(new Dictionary<string, object?> { ["purrlor"] = 1, ["id"] = id, ["error"] = ex.Message }); }
        catch (Exception ex)
        {
            AppPaths.LogError($"bridge {method}", ex);
            PostBridge(new Dictionary<string, object?> { ["purrlor"] = 1, ["id"] = id, ["error"] = "The desktop app couldn't do that." });
        }
    }

    private object? HandleBridgeRequest(string? method, JsonElement parameters)
    {
        switch (method)
        {
            case "getInfo":
                return new { Version = Application.ProductVersion, Settings = BridgeSettings(), Update = UpdateInfo() };
            case "setSetting":
            {
                var name = parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
                if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("value", out var v) || (v.ValueKind != JsonValueKind.True && v.ValueKind != JsonValueKind.False))
                    throw new BridgeError("setSetting takes a name and a true/false value.");
                bool value = v.GetBoolean();
                switch (name)
                {
                    case "startWithWindows": SetStartWithWindows(value); break;
                    case "closeToTray": settings.CloseToTray = value; SaveSettings(); break;
                    case "autoUpdate": settings.AutoUpdate = value; SaveSettings(); updater.Schedule(value); break;
                    default: throw new BridgeError($"There's no desktop setting called {name}.");
                }
                return BridgeSettings();
            }
            case "setExtensionEditing":
                extensionEditing = parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("editing", out var editing) && editing.ValueKind == JsonValueKind.True;
                return null;
            case "setHotkeys":
            {
                if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("bindings", out var list) || list.ValueKind != JsonValueKind.Array)
                    throw new BridgeError("setHotkeys takes a list of bindings.");
                var wanted = new List<(string, string, bool, bool, bool)>();
                foreach (var b in list.EnumerateArray())
                {
                    string? Text(string name) => b.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                    bool Flag(string name) => b.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;
                    var bindingId = Text("id"); var code = Text("code");
                    if (string.IsNullOrEmpty(bindingId) || string.IsNullOrEmpty(code)) throw new BridgeError("Each binding needs an id and a code.");
                    wanted.Add((bindingId, code, Flag("ctrl"), Flag("alt"), Flag("shift")));
                }
                return new { Unknown = hotkeys.Set(wanted) };
            }
            case "setBadge":
            {
                if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("count", out var c) || !c.TryGetInt32(out int count))
                    throw new BridgeError("setBadge takes a count.");
                badge.Set(count); ShowServerName();
                return null;
            }
            case "watchIdle":
            {
                if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("minutes", out var m) || !m.TryGetInt32(out int minutes))
                    throw new BridgeError("watchIdle takes a number of minutes (0 stops).");
                idleWatch.Watch(minutes);
                return null;
            }
            case "checkForUpdates":
                _ = updater.CheckAsync();
                return UpdateInfo();
            case "installUpdate":
                if (updater.Current.State != Updater.State.Ready) throw new BridgeError("There's no update downloaded yet.");
                BeginInvoke(() => InstallUpdate(relaunch: true));
                return null;
            case "changeServer":
                BeginInvoke(ChangeServer);
                return null;
            default:
                throw new BridgeError($"The desktop app doesn't know {method}.");
        }
    }

    private object BridgeSettings() => new { settings.StartWithWindows, settings.CloseToTray, settings.AutoUpdate };

    private void PostBridgeEvent(string name, object? data) =>
        PostBridge(new Dictionary<string, object?> { ["purrlor"] = 1, ["event"] = name, ["data"] = data });

    private void PostBridge(Dictionary<string, object?> message)
    {
        try { webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, BridgeJson)); }
        catch (Exception ex) { AppPaths.LogError("bridge post", ex); }
    }

    private static void OpenExternal(string uri)
    {
        // Only hand real links to the shell, never file:, ms-settings: or other protocol handlers
        // a page could otherwise launch.
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return;
        if (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeMailto) return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    private static string GetUniquePath(string path)
    {
        if (!File.Exists(path)) return path; var dir = Path.GetDirectoryName(path)!; var name = Path.GetFileNameWithoutExtension(path); var ext = Path.GetExtension(path);
        for (int i = 1; i < 1000; i++) { var candidate = Path.Combine(dir, $"{name} ({i}){ext}"); if (!File.Exists(candidate)) return candidate; }
        return Path.Combine(dir, $"{name}-{Guid.NewGuid():N}{ext}");
    }

    private void ShowTrayMessage(string title, string text) { lastNotification = null; trayIcon.BalloonTipTitle = title; trayIcon.BalloonTipText = text; trayIcon.ShowBalloonTip(3000); }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.Style |= WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU; return cp; }
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_QUERYENDSESSION || m.Msg == WM_ENDSESSION) allowExit = true;
        if (m.Msg == 0x0024) // WM_GETMINMAXINFO: retain WinForms minimum sizes, override maximization.
        {
            base.WndProc(ref m);
            WindowWorkArea.Apply(Handle, m.LParam);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == 0x001A || m.Msg == 0x007E) // taskbar/work-area or display configuration changed
        {
            base.WndProc(ref m);
            if (WindowState == FormWindowState.Maximized)
                BeginInvoke(() => WindowWorkArea.Refit(Handle));
            return;
        }
        // WS_THICKFRAME (kept for Snap and resizing) would otherwise add a system frame that
        // WinForms miscounts, leaving the content short of the window's bottom edge.
        if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
        // With no frame of its own, Windows' default handling of these still paints the old
        // unthemed caption bar (title, small buttons) straight over the top of the window: on
        // focus changes, and whenever the title changes, which the page's title (unread counts)
        // does all the time. The same workarounds Chromium uses for its frameless windows:
        // WM_NCACTIVATE with lParam -1 changes the active state without painting anything, and
        // the title and icon are set with the window briefly marked invisible, so nothing is drawn.
        if (m.Msg == WM_NCACTIVATE) { m.LParam = new IntPtr(-1); base.WndProc(ref m); return; }
        if ((m.Msg == WM_SETTEXT || m.Msg == WM_SETICON) && IsHandleCreated)
        {
            int style = GetWindowLong(Handle, GWL_STYLE);
            if ((style & WS_VISIBLE) != 0)
            {
                SetWindowLong(Handle, GWL_STYLE, style & ~WS_VISIBLE);
                try { base.WndProc(ref m); } finally { SetWindowLong(Handle, GWL_STYLE, style); }
                return;
            }
        }
        if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
        {
            base.WndProc(ref m);
            if ((int)m.Result == HTCLIENT)
            {
                var p = PointToClient(Cursor.Position); var client = RealClientSize();
                bool left = p.X <= ResizeGrip, right = p.X >= client.Width - ResizeGrip, top = p.Y <= ResizeGrip, bottom = p.Y >= client.Height - ResizeGrip;
                if (left && top) { m.Result = (IntPtr)HTTOPLEFT; return; } if (right && top) { m.Result = (IntPtr)HTTOPRIGHT; return; }
                if (left && bottom) { m.Result = (IntPtr)HTBOTTOMLEFT; return; } if (right && bottom) { m.Result = (IntPtr)HTBOTTOMRIGHT; return; }
                if (left) { m.Result = (IntPtr)HTLEFT; return; } if (right) { m.Result = (IntPtr)HTRIGHT; return; }
                if (top) { m.Result = (IntPtr)HTTOP; return; } if (bottom) { m.Result = (IntPtr)HTBOTTOM; return; }
            }
            return;
        }
        base.WndProc(ref m);
    }
    private void ApplyDarkDwmFrame()
    {
        try
        {
            int color = ToColorRef(ChromeColor); DwmSetWindowAttribute(Handle, DWMWA_BORDER_COLOR, ref color, 4); DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref color, 4);
            int text = ToColorRef(Color.FromArgb(235, 238, 242)); DwmSetWindowAttribute(Handle, DWMWA_TEXT_COLOR, ref text, 4);
        }
        catch { }
    }
    private static int ToColorRef(Color c) => c.R | (c.G << 8) | (c.B << 16);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    private const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020;
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
