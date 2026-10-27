using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

internal static class TrayLifecycle
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string executable = Path.GetFullPath(args[0]);
        if (!executable.StartsWith(Path.GetFullPath("artifacts/tests/"), StringComparison.OrdinalIgnoreCase)) throw new Exception("Expected isolated test bundle");
        var assembly = Assembly.LoadFrom(executable);
        var flags = BindingFlags.NonPublic | BindingFlags.Instance;
        assembly.GetType("DesktopBootstrap").GetMethod("Install", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
        var type = assembly.GetType("LauncherWindow");
        using (var window = (Form)Activator.CreateInstance(type, flags | BindingFlags.Public, null, new object[] { Path.GetDirectoryName(executable), true, false }, null))
        using (var timer = new System.Windows.Forms.Timer { Interval = 150 })
        {
            window.StartPosition = FormStartPosition.Manual;
            window.Location = new Point(-20000, -20000);
            window.ShowInTaskbar = false;
            int phase = 0;
            string error = null;
            DateTime deadline = DateTime.UtcNow.AddSeconds(20);
            timer.Tick += delegate
            {
                try
                {
                    if (DateTime.UtcNow > deadline) throw new Exception("Tray lifecycle timed out");
                    if (phase == 0)
                    {
                        if (!((Control)type.GetField("open", flags).GetValue(window)).Enabled) return;
                        Health(args[1]);
                        var tray = (NotifyIcon)type.GetField("tray", flags).GetValue(window);
                        if (tray.Icon == null || tray.ContextMenuStrip == null) throw new Exception("Missing tray icon/menu");
                        window.WindowState = FormWindowState.Minimized;
                        if (window.Visible) throw new Exception("Minimize did not hide the window");
                        Health(args[1]);
                        type.GetMethod("RestoreWindow", flags).Invoke(window, null);
                        window.Close();
                        if (window.IsDisposed || window.Visible) throw new Exception("Close did not hide the running window");
                        Health(args[1]);
                        type.GetMethod("RestoreWindow", flags).Invoke(window, null);
                        if (!window.Visible || window.WindowState != FormWindowState.Normal) throw new Exception("Restore did not show the window");
                        phase = 1;
                    }
                    else if (phase == 1)
                    {
                        Health(args[1]);
                        phase = 2;
                        type.GetMethod("RequestExit", flags).Invoke(window, null);
                    }
                }
                catch (Exception failure)
                {
                    error = failure.ToString();
                    timer.Stop();
                    type.GetMethod("RequestExit", flags).Invoke(window, null);
                }
            };
            window.Shown += delegate { timer.Start(); };
            Application.Run(window);
            timer.Stop();
            if (error != null || phase != 2) { Console.Error.WriteLine(error ?? "Service stopped before tray lifecycle completed"); return 1; }
            Console.WriteLine("GUI close keeps HTTP alive; restore and graceful exit verified");
            return 0;
        }
    }
    private static void Health(string origin)
    {
        var request = WebRequest.Create(origin + "/health");
        request.Timeout = 2000;
        using (var response = (HttpWebResponse)request.GetResponse())
            if (response.StatusCode != HttpStatusCode.OK) throw new Exception("Service is unavailable");
    }
}
