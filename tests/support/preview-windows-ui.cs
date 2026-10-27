using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class PreviewWindowsUi
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string root = Path.GetDirectoryName(Path.GetFullPath(args[0]));
        Directory.CreateDirectory(args[2]);
        Assembly launcher = Assembly.LoadFrom(args[0]);
        launcher.GetType("DesktopBootstrap").GetMethod("Install", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
        Type config = Assembly.Load("AntdUI").GetType("AntdUI.Config");
        config.GetProperty("Animation").SetValue(null, false, null);
        config.GetMethod("SetDpi").Invoke(null, new object[] { (float?)1F });
        using (var window = (Form)Create(launcher.GetType("LauncherWindow"), new object[] { root, false }))
        {
            MethodInfo state = window.GetType().GetMethod("OnState", BindingFlags.NonPublic | BindingFlags.Instance);
            state.Invoke(window, new object[] { new Dictionary<string, object> { { "type", "configuration" }, { "origin", "http://127.0.0.1:3001" }, { "addresses", "http://127.0.0.1:3001\nhttp://192.168.1.100:3001" } } });
            state.Invoke(window, new object[] { new Dictionary<string, object> { { "type", "bootstrap" }, { "password", "example-preview-only" } } });
            state.Invoke(window, new object[] { new Dictionary<string, object> { { "type", "ready" } } });
            Render(window, Path.Combine(args[2], "launcher-first-start.png"));
        }
        Assembly updater = Assembly.LoadFrom(args[1]);
        updater.GetType("DesktopBootstrap").GetMethod("Install", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
        Type infoType = updater.GetType("Updater+UpdateInfo");
        object info = Activator.CreateInstance(infoType);
        infoType.GetProperty("version").SetValue(info, "0.2.1", null);
        using (var window = (Form)Create(updater.GetType("UpdateWindow"), new object[] { @"D:\Tuxu", info }))
            Render(window, Path.Combine(args[2], "updater.png"));
        using (var window = (Form)Create(updater.GetType("UpdateWindow"), new object[] { @"D:\Tuxu", info }))
        {
            window.GetType().GetMethod("OnProgress", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(window, new object[] { 2, "备份原数据和配置，图片较多时请耐心等待…" });
            Render(window, Path.Combine(args[2], "updater-progress.png"));
        }
        using (var window = (Form)Create(updater.GetType("UpdateWindow"), new object[] { @"D:\Tuxu", info }))
        {
            Render(window, Path.Combine(args[2], "updater-success.png"), delegate { window.GetType().GetMethod("ShowResult", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(window, new object[] { true, "原数据和配置已保留，请从原目录启动新版。\r\n备份位置：\r\nD:\\Tuxu\\data\\backups\\update-example" }); });
        }
        using (var window = (Form)Create(updater.GetType("UpdateWindow"), new object[] { @"D:\Tuxu", info }))
        {
            Render(window, Path.Combine(args[2], "updater-failure.png"), delegate { window.GetType().GetMethod("ShowResult", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(window, new object[] { false, "检测到图序仍在运行。\r\n请先在图序窗口点击“退出并停止服务”，然后重新运行更新工具。" }); });
        }
        for (int scale = 1; scale <= 2; scale++)
        {
            config.GetMethod("SetDpi").Invoke(null, new object[] { (float?)(scale == 1 ? 1F : 1.5F) });
            using (var window = (Form)Create(launcher.GetType("LauncherWindow"), new object[] { root, false }))
            {
                MethodInfo state = window.GetType().GetMethod("OnState", BindingFlags.NonPublic | BindingFlags.Instance);
                state.Invoke(window, new object[] { new Dictionary<string, object> { { "type", "configuration" }, { "origin", "http://127.0.0.1:3001" }, { "addresses", "http://127.0.0.1:3001\nhttp://192.168.1.100:3001" } } });
                state.Invoke(window, new object[] { new Dictionary<string, object> { { "type", "ready" } } });
                Render(window, Path.Combine(args[2], scale == 1 ? "launcher.png" : "launcher-scale150.png"));
            }
            if (scale == 2)
                using (var window = (Form)Create(updater.GetType("UpdateWindow"), new object[] { @"D:\Tuxu", info }))
                    Render(window, Path.Combine(args[2], "updater-scale150.png"));
        }
        config.GetMethod("SetDpi").Invoke(null, new object[] { (float?)1F });
        using (var window = (Form)Create(launcher.GetType("LauncherWindow"), new object[] { root, false }))
        {
            window.StartPosition = FormStartPosition.Manual;
            window.Location = new Point(-20000, -20000);
            window.ShowInTaskbar = false;
            window.Show();
            Application.DoEvents();
            var stopped = window.GetType().GetField("stopped", BindingFlags.NonPublic | BindingFlags.Instance);
            stopped.SetValue(window, false);
            window.Close();
            if (window.IsDisposed || window.Visible) throw new Exception("Close must hide a running service window");
            window.GetType().GetMethod("RestoreWindow", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(window, null);
            if (!window.Visible) throw new Exception("Tray restore must show the service window");
            stopped.SetValue(window, true);
            window.GetType().GetMethod("RequestExit", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(window, null);
            if (!window.IsDisposed) throw new Exception("Explicit exit must close the service window");
        }
    }

    private static object Create(Type type, object[] args)
    {
        return Activator.CreateInstance(type, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, args, null);
    }
    private static void Render(Form window, string path, Action beforeSnapshot = null)
    {
        window.StartPosition = FormStartPosition.Manual;
        window.Location = new Point(-20000, -20000);
        window.ShowInTaskbar = false;
        window.Show();
        Application.DoEvents();
        window.CreateControl();
        window.PerformLayout();
        if (beforeSnapshot != null) { beforeSnapshot(); Application.DoEvents(); }
        using (var layout = new StreamWriter(path + ".layout.txt"))
        {
            layout.WriteLine("Window: " + window.Size + " Client: " + window.ClientSize);
            foreach (Control child in window.Controls) layout.WriteLine(child.GetType().Name + " " + child.Bounds + " " + child.Text);
        }
        CheckBounds(window);
        using (var bitmap = new Bitmap(window.Width, window.Height))
        {
            window.DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height));
            bitmap.Save(path, ImageFormat.Png);
        }
        window.Close();
    }
    private static void CheckBounds(Control parent)
    {
        foreach (Control child in parent.Controls)
        {
            if (!child.Visible) continue;
            if (child.Right > parent.ClientSize.Width + 1 || child.Bottom > parent.ClientSize.Height + 1)
                throw new Exception("Control exceeds window at " + child.GetType().Name + ": " + child.Bounds);
            CheckBounds(child);
        }
    }
}
