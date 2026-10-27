using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("图序更新")]
[assembly: AssemblyProduct("图序 Windows 离线更新工具")]

internal static class Updater
{
    // Only these program entries can be replaced. User files, data and .env stay put.
    private static readonly string[] ProgramEntries = {
        "dist", "build-server", "node_modules", "runtime", "scripts", "图序.exe", "图序.ico",
        "启动图序.cmd", "放行局域网.cmd", "使用说明.txt", "数据迁移说明.md", "更新说明.md", "第三方许可", "package.json", "manifest.json"
    };
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static bool headless;
    internal static Action<int, string> Progress;
    internal static string BackupCleanupWarning = "";

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    internal static int Run(string[] args)
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        headless = Array.IndexOf(args, "--noninteractive") >= 0;
        try
        {
            if (headless) DesktopBootstrap.RedirectConsole();
            string target = null;
            for (int i = 0; i < args.Length; i++)
                if (args[i] == "--target" && i + 1 < args.Length) target = args[++i];
            var info = ReadResourceInfo();
            if (!headless)
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
            }
            if (target == null)
            {
                if (headless) throw new Exception("缺少 --target 程序目录。");
                target = AppDomain.CurrentDomain.BaseDirectory;
            }
            target = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar);
            if (!headless)
            {
                using (var window = new UpdateWindow(target, info))
                {
                    Application.Run(window);
                    return window.ResultCode;
                }
            }
            string backup = Apply(target, info);
            string message = "更新完成。请双击原目录的图序.exe 启动。\n\n数据和原 .env 已保留。\n备份：" + DisplayPath(backup);
            Console.WriteLine(message);
            if (BackupCleanupWarning.Length > 0) Console.WriteLine(BackupCleanupWarning);
            if (!headless) MessageBox.Show(message, "图序更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            if (!headless) MessageBox.Show(error.Message, "图序更新未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static UpdateInfo ReadResourceInfo()
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("tuxu.update.info"))
        using (var reader = new StreamReader(stream, Encoding.UTF8))
            return Json.Deserialize<UpdateInfo>(reader.ReadToEnd());
    }

    internal static string Apply(string target, UpdateInfo info)
    {
        BackupCleanupWarning = "";
        target = FullPath(target);
        var current = ReadInstallation(target);
        if (new Version(Get(current, "version")) > new Version(info.version))
            throw new Exception("更新包比已安装版本旧，已拒绝降级。数据库回退需使用升级前备份。");
        if (Get(current, "buildId") == info.buildId)
            throw new Exception("当前已经是此更新包对应的版本，无需重复更新。");
        if (System.Text.RegularExpressions.Regex.IsMatch(Get(current, "buildId"), @"^[0-9]{8}T[0-9]{9}Z$") &&
            String.CompareOrdinal(Get(current, "buildId"), info.buildId) > 0)
            throw new Exception("更新包构建时间早于当前程序，已拒绝降级。");
        string data = Path.Combine(target, "data");
        string env = Path.Combine(target, ".env");
        CheckDataConfiguration(target, false);
        Directory.CreateDirectory(data);
        string work = Path.Combine(data, ".update-work");
        string history = Path.Combine(data, "backups");
        if (Directory.Exists(work)) RequirePlainDirectory(work);
        if (Directory.Exists(history)) RequirePlainDirectory(history);
        string id = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        string stage = Path.Combine(work, id);
        string backup = Path.Combine(history, "update-" + id);
        string programBackup = Path.Combine(backup, "program");
        string lockPath = Path.Combine(data, ".update.lock");
        if (File.Exists(lockPath)) throw new Exception("另一个更新正在执行，请等待完成。");
        // DeleteOnClose removes the lock even if the updater is interrupted.
        using (var updateLock = new FileStream(lockPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose))
        {
            EnsureStopped(target);
            foreach (string name in ProgramEntries)
            {
                string path = Path.Combine(target, name);
                if (File.Exists(path) || Directory.Exists(path)) RejectLink(path);
            }
            try
            {
                Report(1, "检查并释放更新文件…");
                Unpack(stage, info);
                var next = ReadJson(Path.Combine(stage, "manifest.json"));
                if (Get(next, "buildId") != info.buildId || Get(next, "platform") != "win32-x64")
                    throw new Exception("更新包版本信息不一致，已停止。");
                Report(2, "备份原数据和配置，图片较多时请耐心等待…");
                Directory.CreateDirectory(backup);
                WriteState(backup, "backing-up", info);
                CopyData(data, Path.Combine(backup, "data"), true);
                if (File.Exists(env)) { RejectLink(env); File.Copy(env, Path.Combine(backup, ".env")); }
                EnsureStopped(target);
                WriteState(backup, "backup-complete", info);
                Directory.CreateDirectory(programBackup);
                Report(3, "替换程序文件…");
                var saved = new List<string>();
                var installed = new List<string>();
                try
                {
                    foreach (string name in ProgramEntries)
                    {
                        string path = Path.Combine(target, name);
                        if (File.Exists(path) || Directory.Exists(path))
                        {
                            Move(path, Path.Combine(programBackup, name));
                            saved.Add(name);
                        }
                        Move(Path.Combine(stage, name), path);
                        installed.Add(name);
                    }
                }
                catch (Exception failure)
                {
                    Report(0, "替换未完成，正在恢复原程序…");
                    try
                    {
                        installed.Reverse();
                        foreach (string name in installed) DeleteProgramEntry(target, name);
                        saved.Reverse();
                        foreach (string name in saved) Move(Path.Combine(programBackup, name), Path.Combine(target, name));
                        WriteState(backup, "program-restored", info);
                    }
                    catch
                    {
                        WriteState(backup, "restore-required", info);
                        throw new Exception("更新和程序恢复未完成。请勿启动；原数据未替换，请从此目录恢复程序：" + programBackup);
                    }
                    throw new Exception("更新未完成，已恢复原程序；data 和 .env 未替换。原因：" + failure.Message);
                }
                WriteState(backup, "complete", info);
                BackupCleanupWarning = BackupRetention.Prune(history, backup);
                Report(4, "程序更新完成，原数据和配置已保留。");
                return backup;
            }
            finally
            {
                // This is an updater-created GUID directory, never the user's data root.
                if (Path.GetDirectoryName(FullPath(stage)) != FullPath(work))
                    throw new Exception("更新临时目录校验失败。");
                try { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
                catch (IOException) { Report(0, "临时文件暂未清理，可在关闭程序后清理 data/.update-work。"); }
            }
        }
    }

    internal static string BackupData(string target)
    {
        BackupCleanupWarning = "";
        target = FullPath(target);
        Report(1, "检查程序与数据目录…");
        var current = ReadInstallation(target);
        CheckDataConfiguration(target, true);
        Version installedVersion;
        if (!Version.TryParse(Get(current, "version"), out installedVersion))
            throw new Exception("原程序版本信息无效，请先恢复 manifest.json。");
        var snapshotInfo = new UpdateInfo { version = Get(current, "version"), buildId = Get(current, "buildId") };
        string data = Path.Combine(target, "data");
        string history = Path.Combine(data, "backups");
        string lockPath = Path.Combine(data, ".update.lock");
        if (File.Exists(lockPath)) throw new Exception("另一个更新或备份正在执行，请等待完成。");
        using (var backupLock = new FileStream(lockPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose))
        {
            EnsureStopped(target);
            Directory.CreateDirectory(history);
            RequirePlainDirectory(history);
            string id = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            string backup = Path.Combine(history, "manual-" + id);
            Directory.CreateDirectory(backup);
            WriteState(backup, "backing-up", snapshotInfo, "manual");
            Report(2, "备份数据与原配置，图片较多时请耐心等待…");
            CopyData(data, Path.Combine(backup, "data"), true);
            string env = Path.Combine(target, ".env");
            RejectLink(env);
            File.Copy(env, Path.Combine(backup, ".env"));
            EnsureStopped(target);
            WriteState(backup, "complete", snapshotInfo, "manual");
            Report(3, "整理历史备份…");
            BackupCleanupWarning = BackupRetention.Prune(history, backup);
            Report(4, "数据备份完成。");
            return backup;
        }
    }

    private static Dictionary<string, object> ReadInstallation(string target)
    {
        RequirePlainDirectory(target);
        var package = ReadJson(Path.Combine(target, "package.json"));
        var current = ReadJson(Path.Combine(target, "manifest.json"));
        if (Get(package, "name") != "tuxu-image-workflow" || Get(current, "platform") != "win32-x64"
            || !File.Exists(Path.Combine(target, "runtime", "node.exe")) || !Directory.Exists(Path.Combine(target, "dist")))
            throw new Exception("请选择已解压的图序 Windows 程序目录。");
        return current;
    }

    private static void CheckDataConfiguration(string target, bool requireExisting)
    {
        string data = Path.Combine(target, "data"), env = Path.Combine(target, ".env");
        if (requireExisting && (!Directory.Exists(data) || !File.Exists(env)))
            throw new Exception("尚未找到完整的 data 和 .env，请先确认原程序目录与配置。");
        if (Directory.Exists(data)) RequirePlainDirectory(data);
        if (File.Exists(env)) { RejectLink(env); CheckDataPaths(target, File.ReadAllText(env, Encoding.UTF8)); }
        if (File.Exists(Path.Combine(data, "workspace.sqlite")) && !File.Exists(env))
            throw new Exception("已有数据库但缺少原 .env，请先恢复配置和加密主密钥。");
        if (File.Exists(Path.Combine(data, "workspace.sqlite")))
        {
            string contents = File.ReadAllText(env, Encoding.UTF8);
            if (!System.Text.RegularExpressions.Regex.IsMatch(contents, @"(?m)^[ \t]*(?:export[ \t]+)?CREDENTIAL_SECRET[ \t]*=[ \t]*[""']?[a-fA-F0-9]{64}[""']?[ \t]*(?:#[^\r\n]*)?\r?$"))
                throw new Exception("原 .env 的 CREDENTIAL_SECRET 缺失或无效，请先恢复原加密主密钥。");
        }
    }

    private static void Unpack(string stage, UpdateInfo info)
    {
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("tuxu.update.payload"))
        using (var sha = SHA256.Create())
        {
            string digest = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
            if (digest != info.sha256) throw new Exception("更新包校验失败，请重新获取完整更新文件。");
        }
        Directory.CreateDirectory(stage);
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("tuxu.update.payload"))
        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                string prefix = info.archiveRoot + "/";
                if (!name.StartsWith(prefix, StringComparison.Ordinal)) throw new Exception("更新包根目录无效。");
                name = name.Substring(prefix.Length);
                if (name.Length == 0) continue;
                string[] parts = name.Split('/');
                if (Array.IndexOf(ProgramEntries, parts[0]) < 0) throw new Exception("更新包包含程序目录之外的文件。");
                for (int i = 0; i < parts.Length; i++)
                    if (parts[i] == "." || parts[i] == ".." || parts[i].Contains(":") || parts[i].EndsWith(".") || parts[i].EndsWith(" "))
                        throw new Exception("更新包包含无效路径。");
                string output = FullPath(Path.Combine(stage, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!output.StartsWith(FullPath(stage) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("更新包路径越界。");
                if (name.EndsWith("/")) { Directory.CreateDirectory(output); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                using (Stream input = entry.Open())
                using (var file = new FileStream(output, FileMode.CreateNew)) input.CopyTo(file);
            }
        }
        foreach (string name in ProgramEntries)
            if (!File.Exists(Path.Combine(stage, name)) && !Directory.Exists(Path.Combine(stage, name)))
                throw new Exception("更新包缺少程序文件：" + name);
    }

    private static void EnsureStopped(string root)
    {
        int ownPid = Process.GetCurrentProcess().Id;
        foreach (Process process in Process.GetProcesses())
        {
            string executable = null;
            try
            {
                if (process.Id != ownPid)
                {
                    ProcessModule module = process.MainModule;
                    if (module != null) executable = module.FileName;
                }
            }
            catch (System.ComponentModel.Win32Exception) { }
            catch (InvalidOperationException) { }
            finally { process.Dispose(); }
            if (executable != null && FullPath(executable).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new Exception("图序仍在运行，请从右下角托盘菜单退出图序，再运行更新工具。");
        }
    }

    private static void CopyData(string source, string destination, bool top)
    {
        RequirePlainDirectory(source);
        Directory.CreateDirectory(destination);
        foreach (string file in Directory.GetFiles(source))
        {
            if (top && Path.GetFileName(file) == ".update.lock") continue;
            RejectLink(file);
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        }
        foreach (string folder in Directory.GetDirectories(source))
        {
            string name = Path.GetFileName(folder);
            if (top && (name.Equals("backups", StringComparison.OrdinalIgnoreCase) || name.Equals(".update-work", StringComparison.OrdinalIgnoreCase))) continue;
            CopyData(folder, Path.Combine(destination, name), false);
        }
    }

    private static void DeleteProgramEntry(string root, string name)
    {
        if (Array.IndexOf(ProgramEntries, name) < 0) throw new Exception("拒绝清理非程序目录。");
        string path = FullPath(Path.Combine(root, name));
        if (!String.Equals(Path.GetDirectoryName(path), root, StringComparison.OrdinalIgnoreCase)) throw new Exception("程序清理路径越界。");
        if (Directory.Exists(path)) { RejectLink(path); Directory.Delete(path, true); }
        else if (File.Exists(path)) File.Delete(path);
    }
    private static void Move(string from, string to)
    {
        // Use the long-path-aware Win32 rename directly. Antivirus scanners may
        // briefly hold a just-extracted DLL, so retry sharing/access failures.
        for (int attempt = 0; ; attempt++)
        {
            if (MoveFileEx(from, to, 0)) return;
            int error = Marshal.GetLastWin32Error();
            if ((error != 5 && error != 32 && error != 33) || attempt >= 7)
                throw new System.ComponentModel.Win32Exception(error, "无法替换程序项：" + DisplayPath(from) + "（Windows 错误 " + error + "）");
            System.Threading.Thread.Sleep(250);
        }
    }
    [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileEx(string from, string to, int flags);
    private static void RequirePlainDirectory(string path)
    {
        if (!Directory.Exists(path)) throw new Exception("目录不存在：" + path);
        RejectLink(path);
    }
    private static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new Exception("更新不支持符号链接或重定向目录：" + path);
    }
    private static Dictionary<string, object> ReadJson(string path) { return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8)); }
    private static string Get(Dictionary<string, object> value, string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    private static void WriteState(string backup, string state, UpdateInfo info, string kind = "update")
    {
        File.WriteAllText(Path.Combine(backup, "update.json"), Json.Serialize(new { state = state, kind = kind, version = info.version, buildId = info.buildId, time = DateTime.UtcNow.ToString("o") }), new UTF8Encoding(false));
    }
    private static void CheckDataPaths(string root, string contents)
    {
        var pattern = new System.Text.RegularExpressions.Regex(@"(?m)^[ \t]*(?:export[ \t]+)?(DATABASE_PATH|ASSET_DIRECTORY|TLS_CERT_FILE|TLS_KEY_FILE|TLS_CA_FILE)[ \t]*=[ \t]*([^\r\n]*)");
        foreach (System.Text.RegularExpressions.Match match in pattern.Matches(contents))
        {
            string key = match.Groups[1].Value;
            string value = match.Groups[2].Value.Trim();
            if (value.StartsWith("\"") || value.StartsWith("'")) value = value.Trim('"', '\'');
            else value = value.Split('#')[0].Trim();
            if (value.Length == 0) continue;
            string path = FullPath(Path.Combine(root, value));
            string expected = Path.Combine(root, key == "DATABASE_PATH" ? "data/workspace.sqlite" : "data/assets");
            if (key.StartsWith("TLS_"))
            {
                if (!path.StartsWith(Path.Combine(root, "data") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("证书位于 data 之外，请先按迁移文档整理数据后再更新。");
            }
            else if (!String.Equals(path, FullPath(expected), StringComparison.OrdinalIgnoreCase))
                throw new Exception("数据库或素材路径不在固定 data 目录，请先按迁移文档整理数据后再更新。");
        }
    }
    private static string FullPath(string path)
    {
        string full = Path.GetFullPath(DisplayPath(path));
        return full.StartsWith(@"\\") ? @"\\?\UNC\" + full.Substring(2) : @"\\?\" + full;
    }
    internal static string DisplayPath(string path)
    {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + path.Substring(8);
        return path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase) ? path.Substring(4) : path;
    }
    private static void Report(int step, string message)
    {
        if (headless) Console.WriteLine(message);
        if (Progress != null) Progress(step, message);
    }
    public sealed class UpdateInfo
    {
        public string version { get; set; }
        public string buildId { get; set; }
        public string archiveRoot { get; set; }
        public string sha256 { get; set; }
    }
}

internal static class UpdaterEntry
{
    [STAThread]
    private static int Main(string[] args)
    {
        DesktopBootstrap.Install();
        return Updater.Run(args);
    }
}

internal sealed class UpdateWindow : DesktopWindow
{
    internal int ResultCode;
    private bool busy;
    private bool backingUp;
    private readonly Updater.UpdateInfo updateInfo;
    private readonly AntdUI.TStepState initialStepState;
    private readonly AntdUI.Button backupButton;
    private string target;
    private readonly AntdUI.Label state;
    private readonly AntdUI.Tag badge;
    private readonly AntdUI.Progress progress;
    private readonly AntdUI.Steps steps;
    private readonly AntdUI.Input path;
    private readonly AntdUI.Input details;
    private readonly AntdUI.Panel safety;
    private readonly AntdUI.Button browse;
    private readonly AntdUI.Button start;
    private readonly AntdUI.Button close;

    internal UpdateWindow(string directory, Updater.UpdateInfo info)
        : base("图序 · 程序更新", "程序更新", 652, 640)
    {
        target = directory;
        updateInfo = info;
        TextLabel(this, "更新图序", 24, 82, 400, 34, 19F, true);
        TextLabel(this, "更新程序，原数据与配置保留。", 24, 120, 500, 24, 9F, false, true);
        badge = StatusTag(this, "v" + info.version, 504, 88, 112, DesktopTokens.ColorBrand, DesktopTokens.ColorBrandSoft);

        var location = Card(this, 24, 156, 592, 124);
        TextLabel(location, "程序目录", 20, 14, 250, 26, 10.5F, true);
        TextLabel(location, "选择原图序.exe 所在文件夹", 20, 40, 540, 22, 9F, false, true);
        path = ReadField(location, 20, 68, 454);
        path.Text = target;
        browse = ActionButton(location, "选择", "FolderOpenOutlined", 482, 68, 90);
        browse.Click += delegate
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择原图序.exe 所在文件夹";
                dialog.ShowNewFolderButton = false;
                dialog.SelectedPath = target;
                if (dialog.ShowDialog(this) == DialogResult.OK) { target = dialog.SelectedPath; path.Text = target; }
            }
        };

        var processCard = Card(this, 24, 292, 592, 128);
        steps = new AntdUI.Steps { Location = new Point(20, 16), Size = new Size(552, 44), Font = new Font(Font.FontFamily, 8.5F), Current = -1 };
        foreach (string title in new string[] { "检查程序", "备份数据", "替换文件", "完成更新" }) steps.Items.Add(new AntdUI.StepsItem(title));
        processCard.Controls.Add(steps);
        initialStepState = steps.Status;
        progress = new AntdUI.Progress { Location = new Point(20, 70), Size = new Size(552, 8), Radius = DesktopTokens.RadiusSm, Back = DesktopTokens.ColorNeutralSoft, Fill = DesktopTokens.ColorBrand, UseSystemText = true, Text = null, Animation = 150 };
        processCard.Controls.Add(progress);
        state = TextLabel(processCard, "准备就绪，请先从托盘退出图序。", 20, 88, 552, 24, 9F, false, true);

        safety = Card(this, 24, 432, 592, 116);
        var shield = TextLabel(safety, " ", 20, 20, 32, 32);
        shield.PrefixSvg = "SafetyCertificateOutlined";
        shield.PrefixColor = DesktopTokens.ColorBrand;
        shield.IconRatio = 1.3F;
        TextLabel(safety, "更新前自动备份", 64, 18, 440, 26, 10.5F, true);
        TextLabel(safety, "成功备份保留 2 份，异常备份保留。", 64, 50, 506, 48, 9F, false, true);
        details = ReadField(this, 24, 432, 592, 116, true);
        details.Visible = false;

        var footer = new System.Windows.Forms.Panel { Dock = DockStyle.Bottom, Height = 80, BackColor = DesktopTokens.ColorSurface };
        Controls.Add(footer);
        backupButton = ActionButton(footer, "备份数据", "DatabaseOutlined", 24, 20, 136);
        close = ActionButton(footer, "取消", "", 380, 20, 92);
        start = ActionButton(footer, "开始更新", "ArrowRightOutlined", 480, 20, 136, true);
        close.Click += delegate { Close(); };
        Updater.Progress = delegate(int step, string message) { Ui(delegate { OnProgress(step, message); }); };
        start.Click += delegate { BeginOperation(false); };
        backupButton.Click += delegate { BeginOperation(true); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) { if (busy) args.Cancel = true; };
        FormClosed += delegate { Updater.Progress = null; };
    }

    private void BeginOperation(bool manual)
    {
            if (busy) return;
            backingUp = manual;
            busy = true;
            browse.Enabled = false;
            backupButton.Enabled = false;
            start.Visible = true;
            start.Enabled = false;
            close.Enabled = false;
            details.Visible = false;
            safety.Visible = true;
            steps.Status = initialStepState;
            steps.Current = -1;
            steps.Items.Clear();
            foreach (string title in manual
                ? new string[] { "检查程序", "备份数据", "整理备份", "完成备份" }
                : new string[] { "检查程序", "备份数据", "替换文件", "完成更新" }) steps.Items.Add(new AntdUI.StepsItem(title));
            progress.Value = 0;
            progress.Loading = true;
            badge.Text = manual ? "备份中" : "更新中";
            badge.ForeColor = DesktopTokens.ColorBrand;
            badge.BackColor = DesktopTokens.ColorBrandSoft;
            state.ForeColor = DesktopTokens.ColorText;
            close.Location = new Point((int)(380 * Dpi), (int)(20 * Dpi));
            close.Width = (int)(92 * Dpi);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    string backup = manual ? Updater.BackupData(target) : Updater.Apply(target, updateInfo);
                    Ui(delegate { ShowResult(true, (manual ? "数据与原配置已备份。" : "原数据和配置已保留。") + "手动与自动备份合计保留最近 2 份成功备份。\r\n备份位置：\r\n" + Updater.DisplayPath(backup) + (Updater.BackupCleanupWarning.Length > 0 ? "\r\n" + Updater.BackupCleanupWarning : "")); });
                }
                catch (Exception error)
                {
                    Ui(delegate { ShowResult(false, error.Message); });
                }
            });
    }

    private void OnProgress(int step, string message)
    {
        steps.Current = Math.Min(3, Math.Max(0, step - 1));
        // This indicates the current stage; it is not an estimated byte percentage.
        progress.Value = step <= 0 ? 0 : Math.Min(0.9F, (step - 1) / 4F);
        state.Text = message;
    }

    private void ShowResult(bool success, string message)
    {
        busy = false;
        ResultCode = success ? 0 : 1;
        progress.Loading = false;
        if (success) { progress.Value = 1F; steps.Current = 4; }
        else steps.Status = AntdUI.TStepState.Error;
        string operation = backingUp ? "备份" : "更新";
        badge.Text = operation + (success ? "完成" : "未完成");
        badge.ForeColor = success ? DesktopTokens.ColorSuccess : DesktopTokens.ColorDanger;
        badge.BackColor = success ? DesktopTokens.ColorSuccessSoft : DesktopTokens.ColorDangerSoft;
        state.Text = success ? (backingUp ? "备份完成，数据与原配置已保存。" : "更新完成，原数据和配置已保留。") : operation + "未完成，请查看下方说明。";
        state.ForeColor = success ? DesktopTokens.ColorSuccess : DesktopTokens.ColorDanger;
        safety.Visible = false;
        details.Text = message;
        details.BackColor = success ? DesktopTokens.ColorSuccessSoft : DesktopTokens.ColorDangerSoft;
        details.ForeColor = success ? DesktopTokens.ColorText : DesktopTokens.ColorDanger;
        details.Visible = true;
        browse.Enabled = true;
        backupButton.Enabled = true;
        start.Visible = backingUp;
        start.Enabled = true;
        close.Location = new Point((int)((backingUp ? 380 : 480) * Dpi), (int)(20 * Dpi));
        close.Width = (int)((backingUp ? 92 : 136) * Dpi);
        close.Enabled = true;
        close.Text = success ? "完成" : "关闭";
        close.Type = AntdUI.TTypeMini.Primary;
        close.ForeColor = DesktopTokens.ColorSurface;
        close.BackHover = DesktopTokens.ColorBrandHover;
        close.ForeHover = DesktopTokens.ColorSurface;
    }
    private void Ui(Action action) { if (!IsDisposed && IsHandleCreated) BeginInvoke(action); }
}
