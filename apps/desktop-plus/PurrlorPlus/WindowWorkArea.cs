using System;
using System.Runtime.InteropServices;

namespace PurrlorPlus;

/// <summary>Native monitor coordinates prevent frameless maximization from covering the taskbar.</summary>
internal static class WindowWorkArea
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    private static bool Read(IntPtr hwnd, out MonitorInfo info)
    {
        info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        var monitor = MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
        return monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info);
    }
    public static void Apply(IntPtr hwnd, IntPtr pointer)
    {
        if (pointer == IntPtr.Zero || !Read(hwnd, out var monitor)) return;
        var limits = Marshal.PtrToStructure<MinMaxInfo>(pointer);
        var bounds = Calculate(monitor.Monitor.Left, monitor.Monitor.Top,
            monitor.Work.Left, monitor.Work.Top, monitor.Work.Right, monitor.Work.Bottom);
        limits.MaxPosition = new Point { X = bounds.X, Y = bounds.Y };
        limits.MaxSize = new Point { X = bounds.Width, Y = bounds.Height };
        Marshal.StructureToPtr(limits, pointer, false);
    }
    internal static (int X, int Y, int Width, int Height) Calculate(int monitorLeft, int monitorTop,
        int workLeft, int workTop, int workRight, int workBottom) =>
        (workLeft - monitorLeft, workTop - monitorTop, workRight - workLeft, workBottom - workTop);
    public static void Refit(IntPtr hwnd)
    {
        if (!Read(hwnd, out var monitor)) return;
        SetWindowPos(hwnd, IntPtr.Zero, monitor.Work.Left, monitor.Work.Top,
            monitor.Work.Right - monitor.Work.Left, monitor.Work.Bottom - monitor.Work.Top, 0x0004 | 0x0010);
    }
}
