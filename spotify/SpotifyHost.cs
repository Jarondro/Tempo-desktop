using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class SpotifyHost : Form
{
    private const string SpotifyUrl = "https://open.spotify.com/";
    private static readonly Color Background = Color.FromArgb(19, 19, 21);
    private static readonly Color Surface = Color.FromArgb(29, 29, 32);
    private readonly IntPtr parent;
    private readonly string profile;
    private readonly int header;
    private readonly WebView2 player = new WebView2();
    private readonly Label status = new Label();
    private readonly ToolTip tips = new ToolTip();
    private readonly FlowLayoutPanel recovery = new FlowLayoutPanel();
    private readonly System.Windows.Forms.Timer follow = new System.Windows.Forms.Timer();
    private CoreWebView2Environment environment;
    private bool initialized;
    private bool wasVisible;
    private bool wasForeground;
    private int focusRetryTicks;
    private Uri spotifyPage = new Uri(SpotifyUrl);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetTopWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr order, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [STAThread]
    private static void Main(string[] args)
    {
        long hwnd;
        int header;
        if (args.Length != 3 || !long.TryParse(args[0], out hwnd) || !int.TryParse(args[2], out header))
            return;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new SpotifyHost(new IntPtr(hwnd), args[1], header))
        {
            if (!window.Attach())
            {
                Console.Error.WriteLine("Could not attach Spotify to the Tempo window: " + Marshal.GetLastWin32Error());
                Environment.ExitCode = 1;
                return;
            }
            var watchdog = new Thread(() => {
                try
                {
                    string command;
                    while ((command = Console.ReadLine()) != null)
                    {
                        if (command == "focus") window.BeginInvoke(new Action(() => window.UpdateActivation(true)));
                    }
                    window.BeginInvoke(new Action(window.Close));
                }
                catch (InvalidOperationException) { }
            });
            watchdog.IsBackground = true;
            watchdog.Start();
            Application.Run(window);
        }
    }

    private bool Attach()
    {
        var handle = Handle;
        const int styleIndex = -16;
        var style = GetWindowLongPtr(handle, styleIndex).ToInt64();
        SetWindowLongPtr(handle, styleIndex, new IntPtr((style & ~0x80000000L) | 0x46000000L));
        SetParent(handle, parent);
        return GetParent(handle) == parent;
    }

    private SpotifyHost(IntPtr parent, string profile, int header)
    {
        this.parent = parent;
        this.profile = profile;
        this.header = header;
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        BackColor = Background;
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);
        Text = "Tempo Desktop · Spotify";
        Size = new Size(1100, 720);

        var returnButton = TextButton("YouTube Music", Close);
        tips.SetToolTip(returnButton, "Zpět do YouTube Music");
        using (var image = Image.FromFile(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "youtube.png")))
            returnButton.Image = new Bitmap(image, 20, 20);
        returnButton.TextImageRelation = TextImageRelation.ImageBeforeText;
        recovery.Dock = DockStyle.Bottom;
        recovery.Height = 44;
        recovery.Padding = new Padding(8, 6, 0, 0);
        recovery.Controls.Add(returnButton);
        recovery.Controls.Add(TextButton("Obnovit", async () => {
            if (initialized) player.CoreWebView2.Reload();
            else await StartPlayer();
        }));
        recovery.Controls.Add(TextButton("V prohlížeči", () => OpenExternal(spotifyPage)));
        player.Dock = DockStyle.Fill;
        player.DefaultBackgroundColor = Background;
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleCenter;
        status.ForeColor = Color.FromArgb(220, 224, 220);
        Controls.Add(player);
        Controls.Add(status);
        Controls.Add(recovery);

        follow.Interval = 33;
        follow.Tick += (sender, args) => UpdateActivation();
        Load += async (sender, args) => {
            FitParent();
            if (parent != IntPtr.Zero) follow.Start();
            await StartPlayer();
        };
        FormClosed += (sender, args) => {
            follow.Dispose();
            tips.Dispose();
        };
    }

    private Button TextButton(string text, Action action)
    {
        var button = new Button();
        button.Text = text;
        button.AutoSize = true;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = Surface;
        button.ForeColor = Color.White;
        button.Cursor = Cursors.Hand;
        button.Click += (sender, args) => action();
        return button;
    }

    private Rect lastBounds;
    private Rect lastParentPosition;
    private uint lastDpi;

    private void UpdateActivation(bool restoreFocus = false)
    {
        if (!IsWindow(parent)) { Close(); return; }
        var visible = IsWindowVisible(parent) && !IsIconic(parent);
        var restored = visible && !wasVisible;
        var foreground = visible && GetForegroundWindow() == parent;
        var activated = foreground && (!wasForeground || restored || restoreFocus);
        wasVisible = visible;
        wasForeground = foreground;

        if (!visible)
        {
            focusRetryTicks = 0;
            player.Visible = false;
            return;
        }

        // The Electron child window can be raised after the parent has already been restored.
        FitParent(restored || GetTopWindow(parent) != Handle);
        player.Visible = true;
        Rect parentPosition;
        if (GetWindowRect(parent, out parentPosition) &&
            (restored || parentPosition.Left != lastParentPosition.Left || parentPosition.Top != lastParentPosition.Top))
        {
            lastParentPosition = parentPosition;
            // The WinForms WebView listens to LocationChanged on this form, not on its native Electron parent.
            OnLocationChanged(EventArgs.Empty);
        }

        if (activated) focusRetryTicks = 4;
        if (!foreground || !initialized || focusRetryTicks == 0) return;

        // Windows can finish restoring keyboard focus after the initial activation message.
        focusRetryTicks--;
        if (!ContainsFocus) player.Focus();
    }

    private void FitParent(bool raise = false)
    {
        if (parent == IntPtr.Zero) return;
        Rect size;
        if (!IsWindow(parent) || !GetClientRect(parent, out size)) { Close(); return; }
        var dpi = GetDpiForWindow(parent);
        if (!raise && dpi == lastDpi && size.Right == lastBounds.Right && size.Bottom == lastBounds.Bottom) return;
        var inset = header * (int)dpi / 96;
        const uint noActivate = 0x0010;
        if (SetWindowPos(Handle, IntPtr.Zero, 0, inset, size.Right, Math.Max(1, size.Bottom - inset), noActivate))
        {
            lastBounds = size;
            lastDpi = dpi;
        }
    }

    private async System.Threading.Tasks.Task StartPlayer()
    {
        if (initializing) return;
        initializing = true;
        ShowStatus("Načítám Spotify…");
        try
        {
            if (environment == null)
                environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (IsDisposed) return;
            await player.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            var web = player.CoreWebView2;
            web.Settings.IsWebMessageEnabled = true;
            web.Settings.AreHostObjectsAllowed = false;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.NavigationStarting += (sender, args) => {
                Uri uri;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) && uri.Scheme == "https") return;
                args.Cancel = true;
            };
            web.SourceChanged += (sender, args) => {
                Uri uri;
                if (Uri.TryCreate(web.Source, UriKind.Absolute, out uri) && uri.Host == "open.spotify.com")
                    spotifyPage = uri;
            };
            web.NavigationCompleted += (sender, args) => {
                if (args.IsSuccess)
                {
                    status.Visible = false;
                    recovery.Visible = !IsSpotifyPage(web.Source);
                }
                else if (args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    ShowStatus("Spotify se nepodařilo načíst. Zkus stránku obnovit nebo otevřít v prohlížeči.");
            };
            web.NewWindowRequested += (sender, args) => {
                Uri uri;
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) && uri.Scheme == "https") web.Navigate(uri.AbsoluteUri);
            };
            web.ProcessFailed += (sender, args) =>
                ShowStatus("Přehrávač Spotify se zastavil. Zavři režim Spotify a zkus ho znovu otevřít.");
            var blocker = new SpotifyAdBlock(web, environment, profile);
            var adblockScriptId = await web.AddScriptToExecuteOnDocumentCreatedAsync(blocker.BuildClientScript());
            web.WebMessageReceived += async (sender, args) => {
                if (!IsSpotifyPage(args.Source) || !IsSpotifyPage(web.Source)) return;
                switch (args.WebMessageAsJson)
                {
                    case "\"tempo:youtube-music\"":
                        BeginInvoke(new Action(Close));
                        return;
                    case "\"tempo:adblock:on\"":
                    case "\"tempo:adblock:off\"":
                        var saved = blocker.TrySetEnabled(args.WebMessageAsJson == "\"tempo:adblock:on\"");
                        if (saved)
                        {
                            try
                            {
                                if (!string.IsNullOrEmpty(adblockScriptId))
                                    web.RemoveScriptToExecuteOnDocumentCreated(adblockScriptId);
                                adblockScriptId = await web.AddScriptToExecuteOnDocumentCreatedAsync(blocker.BuildClientScript());
                            }
                            catch (Exception ex) { Console.Error.WriteLine(ex.Message); }
                        }
                        web.PostWebMessageAsString(!saved ? "tempo:adblock:error" :
                            blocker.Enabled ? "tempo:adblock:on" : "tempo:adblock:off");
                        return;
                    case "\"tempo:adblock:get\"":
                        web.PostWebMessageAsString(blocker.Enabled ? "tempo:adblock:on" : "tempo:adblock:off");
                        return;
                }
            };
            var icon = Convert.ToBase64String(File.ReadAllBytes(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "youtube.png")));
            var switcher = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "spotify-switch.js"));
            await web.AddScriptToExecuteOnDocumentCreatedAsync(switcher.Replace("__TEMPO_YOUTUBE_ICON__", icon));
            if (IsDisposed) return;
            initialized = true;
            web.Navigate(SpotifyUrl);
            UpdateActivation(true);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowStatus("Pro Spotify v Tempu chybí Microsoft Edge WebView2. Spotify můžeš otevřít v prohlížeči.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            if (!IsDisposed) ShowStatus("Spotify se nepodařilo spustit. Zkus ho otevřít v prohlížeči.");
        }
        finally
        {
            initializing = false;
        }
    }

    private void ShowStatus(string text)
    {
        status.Text = text;
        status.BackColor = Background;
        status.Visible = true;
        recovery.Visible = true;
    }

    private bool initializing;

    internal static bool IsSpotifyPage(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host == "open.spotify.com" && uri.IsDefaultPort;
    }

    private static void OpenExternal(Uri url)
    {
        try { Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception ex) { Console.Error.WriteLine(ex.Message); }
    }
}
