using Microsoft.Win32;
using System.Runtime.InteropServices;

namespace PurrlorPlus;

/// <summary>
/// Whether you've left the computer, for the page's automatic Away (`watchIdle`): no keyboard or
/// mouse input anywhere for the page's number of minutes, or the PC locked. Windows' idle timer
/// only says when the last input was, never what it was, and the page only hears "idle" or "back".
/// </summary>
internal sealed class IdleWatch : IDisposable
{
    private readonly Action<bool> report;
    private readonly System.Windows.Forms.Timer timer = new();
    private uint thresholdMs;
    private bool idle, locked;

    /// <param name="report">Called on the UI thread when you go idle (true) or come back (false).</param>
    public IdleWatch(Action<bool> report)
    {
        this.report = report;
        timer.Tick += (_, _) => Check();
        SystemEvents.SessionSwitch += OnSessionSwitch;
    }

    /// <summary>Starts watching with this many minutes before idle; 0 stops.</summary>
    public void Watch(int minutes)
    {
        thresholdMs = (uint)Math.Clamp(minutes, 0, 24 * 60) * 60_000;
        idle = false;
        if (thresholdMs == 0) { timer.Stop(); return; }
        Check();
    }

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionLock) locked = true;
        else if (e.Reason == SessionSwitchReason.SessionUnlock) locked = false;
        else return;
        if (thresholdMs > 0) Check();
    }

    private void Check()
    {
        bool now = locked || IdleMilliseconds() >= thresholdMs;
        if (now != idle)
        {
            idle = now;
            report(now);
        }
        // While away, look often, so coming back shows Online straight away.
        timer.Interval = idle ? 2_000 : 15_000;
        timer.Start();
    }

    private static uint IdleMilliseconds()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return 0;
        // Both wrap at 49.7 days; unsigned subtraction still gives the gap.
        return unchecked((uint)Environment.TickCount - info.dwTime);
    }

    public void Dispose()
    {
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        timer.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
}
