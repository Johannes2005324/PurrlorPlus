namespace PurrlorPlus;

/// <summary>Asks which PurrlorPlus server to connect to. Shown on first run and from "Change server…".</summary>
internal sealed class ServerDialog : Form
{
    private readonly TextBox addressBox = new();
    private readonly Label statusLabel = new();
    private readonly Button connectButton = new();
    private readonly Button cancelButton = new();

    public Uri? Server { get; private set; }

    public ServerDialog(string? current, bool firstRun)
    {
        Text = firstRun ? "Welcome to PurrlorPlus" : "Change server";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        ShowInTaskbar = firstRun;
        StartPosition = firstRun ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent;
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9.5f);
        BackColor = MainForm.ChromeColor;
        ForeColor = Color.FromArgb(235, 238, 242);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(20, 16, 20, 16);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        // Laid out in a table so the text wraps and everything scales with the display's DPI.
        const int width = 440;
        var layout = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Dock = DockStyle.Fill };
        var heading = new Label
        {
            Text = "Which PurrlorPlus server do you use?",
            Font = new Font("Segoe UI Semibold", 12f),
            AutoSize = true, Margin = new Padding(0, 0, 0, 4),
        };
        var hint = new Label
        {
            Text = "Enter the address you open PurrlorPlus at in your browser. If that server lets you " +
                   "choose, the sign-in screen will then ask for your Matrix homeserver.",
            ForeColor = Color.FromArgb(170, 176, 186),
            AutoSize = true, MaximumSize = new Size(width, 0), Margin = new Padding(0, 0, 0, 12),
        };
        addressBox.Width = width;
        addressBox.Margin = new Padding(0);
        addressBox.Text = current ?? ServerAddress.Default;
        addressBox.BackColor = Color.FromArgb(30, 33, 39);
        addressBox.ForeColor = ForeColor;
        addressBox.BorderStyle = BorderStyle.FixedSingle;

        statusLabel.AutoSize = true;
        statusLabel.MaximumSize = new Size(width, 0);
        statusLabel.MinimumSize = new Size(width, 36);
        statusLabel.Margin = new Padding(0, 6, 0, 6);
        statusLabel.ForeColor = Color.FromArgb(240, 128, 120);

        connectButton.Text = "Connect";
        StyleButton(connectButton, Color.FromArgb(88, 101, 242));
        connectButton.Click += async (_, _) => await ConnectAsync();

        cancelButton.Text = firstRun ? "Quit" : "Cancel";
        StyleButton(cancelButton, Color.FromArgb(42, 45, 52));
        cancelButton.DialogResult = DialogResult.Cancel;

        var buttons = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Width = width,
            Anchor = AnchorStyles.Right, Margin = new Padding(0), WrapContents = false,
        };
        buttons.Controls.Add(cancelButton);
        buttons.Controls.Add(connectButton);

        layout.Controls.Add(heading);
        layout.Controls.Add(hint);
        layout.Controls.Add(addressBox);
        layout.Controls.Add(statusLabel);
        layout.Controls.Add(buttons);
        Controls.Add(layout);
        AcceptButton = connectButton;
        CancelButton = cancelButton;
        Shown += (_, _) => { Activate(); addressBox.Focus(); addressBox.SelectAll(); };
    }

    private static void StyleButton(Button b, Color back)
    {
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0;
        b.BackColor = back;
        b.ForeColor = Color.White;
        b.AutoSize = true;
        b.MinimumSize = new Size(92, 32);
        b.Margin = new Padding(6, 0, 0, 0);
    }

    private async Task ConnectAsync()
    {
        if (!ServerAddress.TryNormalize(addressBox.Text, out var server, out var error))
        {
            statusLabel.Text = error; return;
        }
        statusLabel.ForeColor = Color.FromArgb(170, 176, 186);
        statusLabel.Text = $"Checking {ServerAddress.DisplayName(server)}…";
        connectButton.Enabled = false; addressBox.Enabled = false;
        var problem = await ServerAddress.ProbeAsync(server);
        connectButton.Enabled = true; addressBox.Enabled = true;
        if (problem != null)
        {
            statusLabel.ForeColor = Color.FromArgb(240, 128, 120);
            statusLabel.Text = problem;
            var answer = MessageBox.Show(this, $"{problem}\n\nConnect to {ServerAddress.DisplayName(server)} anyway?",
                "PurrlorPlus", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return;
        }
        Server = server;
        DialogResult = DialogResult.OK;
    }
}
