using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace PurrlorPlus;

/// <summary>
/// The count of what's waiting for you (the page's `setBadge`: unread DMs and mentions) on the
/// taskbar button, as a red badge, and as a red dot on the tray icon, since PurrlorPlus often lives
/// there.
/// </summary>
internal sealed class Badge : IDisposable
{
    private readonly Form window;
    private readonly NotifyIcon tray;
    private readonly Icon trayIcon;
    private ITaskbarList3? taskbar;
    private Icon? overlay, trayWithDot;
    private int count;

    public Badge(Form window, NotifyIcon tray, Icon trayIcon)
    {
        this.window = window;
        this.tray = tray;
        this.trayIcon = trayIcon;
        // The taskbar button goes away while PurrlorPlus is in the tray and comes back without its badge.
        window.VisibleChanged += (_, _) => { if (window.Visible) ApplyOverlay(); };
    }

    public int Count => count;

    public void Set(int value)
    {
        value = Math.Max(0, value);
        if (value == count) return;
        bool hadOne = count > 0;
        count = value;

        var oldOverlay = overlay;
        overlay = count > 0 ? DrawOverlay(count) : null;
        ApplyOverlay();
        oldOverlay?.Dispose();

        if (count > 0 != hadOne)
        {
            var oldTray = trayWithDot;
            trayWithDot = count > 0 ? DrawTrayDot(trayIcon) : null;
            tray.Icon = trayWithDot ?? trayIcon;
            oldTray?.Dispose();
        }
    }

    private void ApplyOverlay()
    {
        if (!window.IsHandleCreated) return;
        try
        {
            if (taskbar == null)
            {
                taskbar = (ITaskbarList3)new TaskbarList();
                taskbar.HrInit();
            }
            taskbar.SetOverlayIcon(window.Handle, overlay?.Handle ?? IntPtr.Zero, count > 0 ? $"{count} unread" : "");
        }
        catch (Exception ex) { AppPaths.LogError("taskbar badge", ex); }
    }

    private static Icon DrawOverlay(int n)
    {
        const int size = 32;
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using var red = new SolidBrush(Color.FromArgb(237, 66, 69));
            g.FillEllipse(red, 0, 0, size - 1, size - 1);
            string text = n > 99 ? "99+" : n.ToString();
            float fontSize = text.Length == 1 ? 19 : text.Length == 2 ? 15 : 11;
            using var font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
            using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString(text, font, Brushes.White, new RectangleF(0, 1, size, size), format);
        }
        return OwnedIcon(bmp);
    }

    private static Icon DrawTrayDot(Icon baseIcon)
    {
        using var bmp = new Icon(baseIcon, 32, 32).ToBitmap();
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var red = new SolidBrush(Color.FromArgb(237, 66, 69));
            using var ring = new Pen(Color.FromArgb(13, 15, 19), 2);
            g.FillEllipse(red, 17, 17, 14, 14);
            g.DrawEllipse(ring, 17, 17, 14, 14);
        }
        return OwnedIcon(bmp);
    }

    // Icon.FromHandle doesn't own the handle it's given; a copy does, so Dispose frees it.
    private static Icon OwnedIcon(Bitmap bmp)
    {
        IntPtr handle = bmp.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }

    public void Dispose()
    {
        overlay?.Dispose();
        trayWithDot?.Dispose();
    }

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);

    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
    private class TaskbarList { }

    // Only SetOverlayIcon is used; the rest are here to keep the vtable in order.
    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
        void SetProgressState(IntPtr hwnd, int flags);
        void RegisterTab(IntPtr tab, IntPtr mdi);
        void UnregisterTab(IntPtr tab);
        void SetTabOrder(IntPtr tab, IntPtr insertBefore);
        void SetTabActive(IntPtr tab, IntPtr mdi, uint reserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
        void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string tip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr clip);
    }
}
