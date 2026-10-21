using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PurrlorPlus;

/// <summary>
/// The call's keybinds (push-to-talk, mute, deafen), watched system-wide so they work while another
/// window, a game say, is in front. The page sets them over the bridge (`setHotkeys`) when a call
/// starts and clears them when it ends.
///
/// Windows' low-level keyboard (and, for a mouse side button, mouse) hook sees every key pressed
/// anywhere, so what it does with them is kept narrow: each press is compared with the bound keys
/// and forgotten. Only a bound key going down or up is reported, as the binding's id; no other key
/// is stored, logged or sent. Nothing is swallowed either: the game still gets the key. The hooks
/// exist only while something is bound, so outside a call PurrlorPlus isn't watching at all.
///
/// Windows doesn't pass input from a window running as administrator to a hook in a program that
/// isn't, so a game run as administrator doesn't trigger these (PurrlorPlus would have to be too).
/// </summary>
internal sealed class GlobalHotkeys : IDisposable
{
    public sealed record Binding(string Id, int VirtualKey, bool Extended, bool Ctrl, bool Alt, bool Shift)
    {
        public bool HasModifiers => Ctrl || Alt || Shift;
    }

    private const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
    private const int LLKHF_EXTENDED = 0x01;
    private const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
    // Not real virtual keys: what the page's "Mouse4"/"Mouse5" map to here.
    private const int MOUSE4 = -4, MOUSE5 = -5;

    private readonly Action<string, bool> report;
    private readonly HookProc keyboardProc, mouseProc; // held so the GC can't collect them under the hooks
    private readonly HashSet<string> held = new();
    private List<Binding> bindings = new();
    private IntPtr keyboardHook, mouseHook;

    /// <param name="report">Called on the UI thread with a binding's id and whether it went down.</param>
    public GlobalHotkeys(Action<string, bool> report)
    {
        this.report = report;
        keyboardProc = OnKeyboard;
        mouseProc = OnMouse;
    }

    /// <summary>Replaces the bindings. Returns the ids of any whose key this doesn't know.</summary>
    public List<string> Set(IEnumerable<(string Id, string Code, bool Ctrl, bool Alt, bool Shift)> wanted)
    {
        var unknown = new List<string>();
        var next = new List<Binding>();
        foreach (var w in wanted)
        {
            if (TryVirtualKey(w.Code, out int vk, out bool extended)) next.Add(new Binding(w.Id, vk, extended, w.Ctrl, w.Alt, w.Shift));
            else unknown.Add(w.Id);
        }
        // Anything held under the old bindings is let go of, so push-to-talk can't stick open.
        foreach (var id in held) report(id, false);
        held.Clear();
        bindings = next;

        bool wantKeyboard = bindings.Any(b => b.VirtualKey > 0), wantMouse = bindings.Any(b => b.VirtualKey < 0);
        if (wantKeyboard && keyboardHook == IntPtr.Zero) keyboardHook = Install(WH_KEYBOARD_LL, keyboardProc);
        if (!wantKeyboard) Unhook(ref keyboardHook);
        if (wantMouse && mouseHook == IntPtr.Zero) mouseHook = Install(WH_MOUSE_LL, mouseProc);
        if (!wantMouse) Unhook(ref mouseHook);
        return unknown;
    }

    public void Clear() => Set(Array.Empty<(string, string, bool, bool, bool)>());

    public void Dispose()
    {
        Unhook(ref keyboardHook);
        Unhook(ref mouseHook);
    }

    private static IntPtr Install(int kind, HookProc proc)
    {
        using var module = Process.GetCurrentProcess().MainModule;
        var hook = SetWindowsHookEx(kind, proc, GetModuleHandle(module?.ModuleName), 0);
        if (hook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        return hook;
    }

    private static void Unhook(ref IntPtr hook)
    {
        if (hook == IntPtr.Zero) return;
        UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
    }

    // Windows quietly removes a hook that takes too long, so these only compare and queue.
    private IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var info = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(data);
            int msg = (int)message;
            bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN, up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            // Keys sent by software count too: a Stream Deck or a macro key is how plenty of people push to talk.
            if (down || up)
                Handle((int)info.vkCode, (info.flags & LLKHF_EXTENDED) != 0, down);
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int msg = (int)message;
            if (msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP)
            {
                var info = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(data);
                int button = (int)(info.mouseData >> 16); // 1 back, 2 forward
                if (button is 1 or 2) Handle(button == 1 ? MOUSE4 : MOUSE5, false, msg == WM_XBUTTONDOWN);
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private void Handle(int vk, bool extended, bool down)
    {
        foreach (var b in bindings)
        {
            if (b.VirtualKey != vk) continue;
            // Enter and the number pad's Enter are the same virtual key; the extended flag tells them apart.
            if (vk == 0x0D && b.Extended != extended) continue;
            if (down)
            {
                if (held.Contains(b.Id)) continue; // key repeat
                if (b.HasModifiers && !ModifiersMatch(b)) continue;
                held.Add(b.Id);
                report(b.Id, true);
            }
            else if (held.Remove(b.Id))
            {
                report(b.Id, false);
            }
        }
    }

    // A binding without modifiers ignores them (Shift held to run doesn't stop push-to-talk); one
    // with modifiers needs exactly those, the same as the page's matchesKey.
    private static bool ModifiersMatch(Binding b) =>
        IsDown(VK_CONTROL) == b.Ctrl && IsDown(VK_MENU) == b.Alt && IsDown(VK_SHIFT) == b.Shift;

    private static bool IsDown(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    /// <summary>KeyboardEvent.code (a physical key, the same whatever the layout) to a Windows virtual key.</summary>
    internal static bool TryVirtualKey(string code, out int vk, out bool extended)
    {
        extended = false;
        vk = 0;
        if (code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z') { vk = code[3]; return true; }
        if (code.Length == 6 && code.StartsWith("Digit") && char.IsAsciiDigit(code[5])) { vk = code[5]; return true; }
        if (code.Length == 7 && code.StartsWith("Numpad") && char.IsAsciiDigit(code[6])) { vk = 0x60 + (code[6] - '0'); return true; }
        if (code.StartsWith('F') && int.TryParse(code.AsSpan(1), out int f) && f is >= 1 and <= 24) { vk = 0x6F + f; return true; }
        if (code == "NumpadEnter") { vk = 0x0D; extended = true; return true; }
        vk = code switch
        {
            "Mouse4" => MOUSE4, "Mouse5" => MOUSE5,
            "ControlLeft" => 0xA2, "ControlRight" => 0xA3, "ShiftLeft" => 0xA0, "ShiftRight" => 0xA1,
            "AltLeft" => 0xA4, "AltRight" => 0xA5, "MetaLeft" => 0x5B, "MetaRight" => 0x5C, "ContextMenu" => 0x5D,
            "Space" => 0x20, "Enter" => 0x0D, "Tab" => 0x09, "Backspace" => 0x08, "Escape" => 0x1B, "CapsLock" => 0x14,
            "Insert" => 0x2D, "Delete" => 0x2E, "Home" => 0x24, "End" => 0x23, "PageUp" => 0x21, "PageDown" => 0x22,
            "ArrowLeft" => 0x25, "ArrowUp" => 0x26, "ArrowRight" => 0x27, "ArrowDown" => 0x28,
            "Pause" => 0x13, "ScrollLock" => 0x91, "NumLock" => 0x90, "PrintScreen" => 0x2C,
            "NumpadAdd" => 0x6B, "NumpadSubtract" => 0x6D, "NumpadMultiply" => 0x6A, "NumpadDivide" => 0x6F, "NumpadDecimal" => 0x6E,
            "Backquote" => 0xC0, "Minus" => 0xBD, "Equal" => 0xBB, "BracketLeft" => 0xDB, "BracketRight" => 0xDD,
            "Backslash" => 0xDC, "IntlBackslash" => 0xE2, "Semicolon" => 0xBA, "Quote" => 0xDE, "Comma" => 0xBC,
            "Period" => 0xBE, "Slash" => 0xBF,
            _ => 0,
        };
        return vk != 0;
    }

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT { public int x, y; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}
