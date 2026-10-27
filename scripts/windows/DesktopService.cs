using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class DesktopService : IDisposable
{
    private readonly string root;
    private Process process;
    private readonly ManualResetEvent finished = new ManualResetEvent(false);
    private bool started;
    private int exitCode;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    internal event Action<Dictionary<string, object>> State;
    internal event Action<string, bool> Output;
    internal event Action<int> Stopped;
    internal string LastError = "";

    internal DesktopService(string directory) { root = directory; }

    internal void Start()
    {
        string node = Path.Combine(root, "runtime", "node.exe");
        string script = Path.Combine(root, "scripts", "windows-start.mjs");
        if (!File.Exists(node) || !File.Exists(script))
            throw new FileNotFoundException("请完整解压部署包，保留同目录中的 runtime、scripts 和程序文件。");
        var start = new ProcessStartInfo(node, "\"" + script + "\"");
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardInput = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        start.EnvironmentVariables["TUXU_DESKTOP"] = "1";
        process = new Process();
        process.StartInfo = start;
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Read(e.Data, false); };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Read(e.Data, true); };
        process.Start();
        started = true;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        ThreadPool.QueueUserWorkItem(delegate
        {
            process.WaitForExit();
            exitCode = process.ExitCode;
            finished.Set();
            if (Stopped != null) Stopped(exitCode);
        });
    }

    private void Read(string line, bool error)
    {
        if (line == null) return;
        const string prefix = "TUXU_DESKTOP:";
        if (!error && line.StartsWith(prefix, StringComparison.Ordinal))
        {
            var state = json.Deserialize<Dictionary<string, object>>(line.Substring(prefix.Length));
            if (State != null) State(state);
            // Bootstrap passwords are only sent to the desktop UI, never the log stream.
            return;
        }
        if (error)
        {
            LastError += line + Environment.NewLine;
            if (LastError.Length > 5000) LastError = LastError.Substring(LastError.Length - 5000);
        }
        if (Output != null) Output(line, error);
    }

    internal void Stop()
    {
        try
        {
            if (process != null && !process.HasExited)
            {
                process.StandardInput.WriteLine("stop");
                process.StandardInput.Flush();
            }
        }
        catch (IOException) { }
        catch (InvalidOperationException) { }
    }

    internal int WaitForExit()
    {
        finished.WaitOne();
        return exitCode;
    }

    internal bool WaitForExit(int milliseconds) { return finished.WaitOne(milliseconds); }

    public void Dispose()
    {
        Stop();
        if (process != null)
        {
            // During OS shutdown the worker may still be waiting; do not dispose
            // its Process handle from underneath that thread.
            if (started && !finished.WaitOne(0)) return;
            process.Dispose();
        }
    }
}
