using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("图序")]
[assembly: AssemblyProduct("图序 · 批量生图工作台")]
[assembly: AssemblyDescription("图序 Windows 便携版启动入口")]

internal static class Launcher
{
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    internal static int Run(string[] args)
    {
        bool headless = Array.IndexOf(args, "--noninteractive") >= 0;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            if (Array.IndexOf(args, "--firewall") >= 0) return ConfigureFirewall(args);
            if (headless)
            {
                DesktopBootstrap.RedirectConsole();
                using (var service = new DesktopService(root))
                {
                    service.State += delegate(Dictionary<string, object> state)
                    {
                        if (Convert.ToString(state["type"]) != "bootstrap")
                            Console.WriteLine("TUXU_DESKTOP:" + new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(state));
                    };
                    service.Output += delegate(string line, bool error) { if (error) Console.Error.WriteLine(line); else Console.WriteLine(line); };
                    service.Start();
                    var input = new Thread(delegate()
                    {
                        string line;
                        while ((line = Console.ReadLine()) != null)
                            if (line == "stop") { service.Stop(); return; }
                        service.Stop();
                    });
                    input.IsBackground = true;
                    input.Start();
                    return service.WaitForExit();
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            return RunWindow(root);
        }
        catch (Exception error)
        {
            if (headless) Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message, "图序启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int RunWindow(string root)
    {
        string key;
        using (var hash = System.Security.Cryptography.SHA256.Create())
            key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).ToUpperInvariant()))).Replace("-", "").Substring(0, 32);
        using (var activation = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Tuxu-Show-" + key))
        using (var instance = new Mutex(false, @"Local\Tuxu-Instance-" + key))
        {
            bool owned;
            try { owned = instance.WaitOne(0, false); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned) { activation.Set(); return 0; }
            RegisteredWaitHandle wake = null;
            try
            {
                using (var window = new LauncherWindow(root))
                {
                    window.Shown += delegate
                    {
                        if (wake == null) wake = ThreadPool.RegisterWaitForSingleObject(activation, delegate(object state, bool timeout) { window.ActivateWindow(); }, null, Timeout.Infinite, false);
                    };
                    Application.Run(window);
                }
                return 0;
            }
            finally { if (wake != null) wake.Unregister(null); instance.ReleaseMutex(); }
        }
    }

    private static int ConfigureFirewall(string[] args)
    {
        int port = 3001;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--port" && (!Int32.TryParse(args[i + 1], out port) || port < 1 || port > 65535))
                throw new Exception("端口无效。");
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new Exception("请从图序窗口点击“允许局域网访问”，并允许 Windows 管理员授权。");
        string name = "Tuxu-LAN-" + port;
        string command = "$ErrorActionPreference='Stop'; if (-not (Get-NetFirewallRule -Name '" + name + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name '" + name + "' -DisplayName '图序局域网访问 (" + port + ")' -Direction Inbound -Action Allow -Protocol TCP -LocalPort " + port + " -Profile Private -RemoteAddress LocalSubnet | Out-Null }";
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile -NonInteractive -Command \"" + command + "\"");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardError = true;
        using (var process = Process.Start(start))
        {
            string error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception("无法设置局域网访问：" + error);
        }
        MessageBox.Show("已允许专用网络中本地子网访问端口 " + port + "。\n\n请确保当前办公网络设为 Windows 专用网络。", "图序 · 局域网访问", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }
}

internal static class LauncherEntry
{
    [STAThread]
    private static int Main(string[] args)
    {
        DesktopBootstrap.Install();
        return Launcher.Run(args);
    }
}

internal sealed class LauncherWindow : DesktopWindow
{
    private readonly DesktopService service;
    private readonly string root;
    private readonly AntdUI.Label status;
    private readonly AntdUI.Label hint;
    private readonly AntdUI.Tag badge;
    private readonly AntdUI.Input accessAddress;
    private readonly AntdUI.Input password;
    private readonly AntdUI.Panel credentials;
    private readonly AntdUI.Input details;
    private readonly System.Windows.Forms.Panel actions;
    private readonly AntdUI.Button open;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip trayMenu;
    private readonly ContextMenuStrip networkMenu;
    private readonly ContextMenuStrip moreMenu;
    private readonly ToolStripMenuItem trayOpen;
    private readonly ToolStripMenuItem trayExit;
    private string origin;
    private string[] lanAddresses = new string[0];
    private bool stopped;
    private bool exiting;

    internal LauncherWindow(string directory, bool startService = true)
        : this(directory, startService, true) { }

    internal LauncherWindow(string directory, bool startService, bool showTray)
        : base("图序 · 工作台", "本机服务", 340, 480)
    {
        root = directory;
        stopped = !startService;
        var card = Card(this, 16, 68, 448, 176);
        badge = StatusTag(card, "●  启动中", 16, 16, 96, DesktopTokens.ColorBrand, DesktopTokens.ColorBrandSoft);
        status = TextLabel(card, "正在准备工作台…", 124, 16, 308, 28, 9F, false, true);
        open = ActionButton(card, "打开工作台", "ExportOutlined", 16, 56, 416, true);
        open.Enabled = false;
        open.Click += delegate { OpenWorkbench(); };
        accessAddress = ReadField(card, 16, 112, 320);
        accessAddress.PlaceholderText = "等待访问地址";
        var copy = ActionButton(card, "复制", "CopyOutlined", 340, 112, 92, false, true);
        copy.Click += delegate { CopyText(accessAddress.Text, copy); };

        credentials = Card(this, 16, 256, 448, 104);
        credentials.Visible = false;
        TextLabel(credentials, "首次登录 · admin", 16, 10, 416, 28, 9.5F, true);
        password = ReadField(credentials, 16, 50, 238);
        password.UseSystemPasswordChar = true;
        var reveal = ActionButton(credentials, "显示", "EyeOutlined", 258, 50, 70, false, true);
        reveal.Click += delegate { password.UseSystemPasswordChar = !password.UseSystemPasswordChar; reveal.Text = password.UseSystemPasswordChar ? "显示" : "隐藏"; };
        var copyPassword = ActionButton(credentials, "复制密码", "CopyOutlined", 332, 50, 100);
        copyPassword.Click += delegate { CopyText(password.Text, copyPassword); };
        details = ReadField(this, 16, 256, 448, 104, true);
        details.Visible = false;
        details.BackColor = DesktopTokens.ColorDangerSoft;
        details.ForeColor = DesktopTokens.ColorDanger;

        actions = new System.Windows.Forms.Panel { Location = new Point(16, 256), Size = new Size(448, 40), BackColor = Color.Transparent };
        Controls.Add(actions);
        var network = ActionButton(actions, "局域网访问", "GlobalOutlined", 0, 0, 136);
        var hide = ActionButton(actions, "隐藏到托盘", "MinusOutlined", 144, 0, 160, false, true);
        var more = ActionButton(actions, "更多", "MoreOutlined", 312, 0, 136, false, true);
        hide.Click += delegate { HideToTray(); };
        hint = TextLabel(this, "关闭或最小化后，图序继续在托盘运行", 16, 304, 448, 22, 8.5F, false, true);

        networkMenu = CreateMenu();
        network.Click += delegate { BuildNetworkMenu(); networkMenu.Show(network, new Point(0, network.Height)); };
        moreMenu = CreateMenu();
        moreMenu.Items.Add("查看日志", null, delegate { OpenLogs(); });
        moreMenu.Items.Add("打开数据目录", null, delegate { OpenData(); });
        moreMenu.Items.Add("允许局域网访问", null, delegate { ConfigureLan(); });
        moreMenu.Items.Add(new ToolStripSeparator());
        moreMenu.Items.Add("退出图序并停止服务", null, delegate { RequestExit(); });
        more.Click += delegate { moreMenu.Show(more, new Point(0, more.Height)); };

        trayMenu = CreateMenu();
        trayOpen = new ToolStripMenuItem("打开工作台", null, delegate { OpenWorkbench(); }) { Enabled = false };
        trayMenu.Items.Add(trayOpen);
        trayMenu.Items.Add("显示服务窗口", null, delegate { RestoreWindow(); });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("查看日志", null, delegate { OpenLogs(); });
        trayMenu.Items.Add("打开数据目录", null, delegate { OpenData(); });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayExit = new ToolStripMenuItem("退出图序并停止服务", null, delegate { RequestExit(); });
        trayMenu.Items.Add(trayExit);
        tray = new NotifyIcon { Icon = Icon, Text = "图序 · 正在启动", ContextMenuStrip = trayMenu, Visible = startService && showTray };
        tray.DoubleClick += delegate { RestoreWindow(); };

        service = new DesktopService(root);
        service.State += delegate(Dictionary<string, object> state) { Ui(delegate { OnState(state); }); };
        service.Stopped += delegate(int code)
        {
            Ui(delegate
            {
                stopped = true;
                open.Enabled = trayOpen.Enabled = false;
                if (exiting) { Close(); return; }
                SetStatus(code == 0 ? "服务已停止" : "请查看日志或下方说明", code == 0 ? "已停止" : "运行异常", code != 0);
                if (code != 0)
                {
                    ShowError(String.IsNullOrWhiteSpace(service.LastError) ? "请通过“更多 → 查看日志”查看运行情况。" : service.LastError);
                    RestoreWindow();
                }
            });
        };
        Shown += delegate
        {
            if (!startService) return;
            try { service.Start(); }
            catch (Exception error) { stopped = true; SetStatus("请查看下方说明", "启动失败", true); ShowError(error.Message); }
        };
        Resize += delegate { if (WindowState == FormWindowState.Minimized && !exiting) HideToTray(); };
        FormClosing += delegate(object sender, FormClosingEventArgs args)
        {
            if (exiting || stopped) return;
            if (args.CloseReason == CloseReason.WindowsShutDown)
            {
                exiting = true;
                service.Stop();
                service.WaitForExit(4000);
                return;
            }
            args.Cancel = true;
            if (args.CloseReason == CloseReason.UserClosing) HideToTray();
            else RequestExit();
        };
    }

    private static ContextMenuStrip CreateMenu()
    {
        return new ContextMenuStrip { Font = new Font("Microsoft YaHei UI", 9F), ShowImageMargin = false };
    }
    private void OpenWorkbench()
    {
        if (origin != null && open.Enabled) Process.Start(new ProcessStartInfo(origin) { UseShellExecute = true });
    }
    private void OpenLogs()
    {
        string path = Path.Combine(root, "data", "logs", "server.log");
        if (File.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        else MessageBox.Show("暂时没有日志文件。", "图序");
    }
    private void OpenData()
    {
        string path = Path.Combine(root, "data");
        if (Directory.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }
    private void ConfigureLan()
    {
        try
        {
            int port = origin == null ? 3001 : new Uri(origin).Port;
            Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--firewall --port " + port) { UseShellExecute = true, Verb = "runas" });
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            if (error.NativeErrorCode != 1223) MessageBox.Show(error.Message, "图序 · 局域网访问");
        }
    }
    private void BuildNetworkMenu()
    {
        networkMenu.Items.Clear();
        foreach (string address in lanAddresses)
        {
            string value = address;
            networkMenu.Items.Add(value + "  ·  点击复制", null, delegate
            {
                try { Clipboard.SetText(value); }
                catch (System.Runtime.InteropServices.ExternalException) { MessageBox.Show("剪贴板正忙，请稍后重试。", "图序"); }
            });
        }
        if (lanAddresses.Length == 0) networkMenu.Items.Add(new ToolStripMenuItem("暂未发现局域网地址") { Enabled = false });
        networkMenu.Items.Add(new ToolStripSeparator());
        networkMenu.Items.Add("允许局域网访问", null, delegate { ConfigureLan(); });
    }
    private void HideToTray()
    {
        if (exiting) return;
        Hide();
    }
    private void RestoreWindow()
    {
        if (IsDisposed || exiting) return;
        WindowState = FormWindowState.Normal;
        Show();
        if (ShowInTaskbar) Activate();
    }
    protected override bool ShowWithoutActivation { get { return !ShowInTaskbar; } }
    internal void ActivateWindow()
    {
        Ui(delegate { RestoreWindow(); });
    }
    private void RequestExit()
    {
        if (exiting) return;
        exiting = true;
        if (stopped) { Close(); return; }
        SetStatus("正在安全停止服务…", "停止中", false);
        open.Enabled = trayOpen.Enabled = trayExit.Enabled = false;
        actions.Enabled = false;
        service.Stop();
    }
    private void ExpandContent()
    {
        float scale = IsHandleCreated ? Dpi : 1F;
        actions.Top = (int)(372 * scale);
        hint.Top = (int)(420 * scale);
        SetContentHeight(452);
    }
    private void ShowError(string message)
    {
        credentials.Visible = false;
        details.Text = message;
        details.Visible = true;
        ExpandContent();
    }
    private void SetStatus(string text, string shortText, bool error)
    {
        status.Text = text;
        badge.Text = "●  " + shortText;
        badge.ForeColor = error ? DesktopTokens.ColorDanger : DesktopTokens.ColorMuted;
        badge.BackColor = error ? DesktopTokens.ColorDangerSoft : DesktopTokens.ColorNeutralSoft;
        tray.Text = "图序 · " + shortText;
    }
    private void OnState(Dictionary<string, object> state)
    {
        string kind = Convert.ToString(state["type"]);
        if (kind == "bootstrap")
        {
            password.Text = Convert.ToString(state["password"]);
            credentials.Visible = true;
            ExpandContent();
        }
        if (kind == "configuration")
        {
            origin = Convert.ToString(state["origin"]);
            var lan = new List<string>();
            foreach (string address in Convert.ToString(state["addresses"]).Replace("\r", "").Split('\n'))
                if (!String.IsNullOrWhiteSpace(address) && address.Trim() != origin) lan.Add(address.Trim());
            lanAddresses = lan.ToArray();
            if (lanAddresses.Length > 0) origin = lanAddresses[0];
            accessAddress.Text = origin;
        }
        if (kind == "ready" && !exiting)
        {
            status.Text = "工作台已就绪";
            badge.Text = "●  运行中";
            badge.ForeColor = DesktopTokens.ColorSuccess;
            badge.BackColor = DesktopTokens.ColorSuccessSoft;
            tray.Text = "图序 · 运行中";
            open.Enabled = trayOpen.Enabled = true;
        }
    }
    private void Ui(Action action)
    {
        try { if (!IsDisposed && IsHandleCreated) BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (tray != null) { tray.Visible = false; tray.Dispose(); }
            if (trayMenu != null) trayMenu.Dispose();
            if (networkMenu != null) networkMenu.Dispose();
            if (moreMenu != null) moreMenu.Dispose();
            if (service != null) service.Dispose();
        }
        base.Dispose(disposing);
    }
}
