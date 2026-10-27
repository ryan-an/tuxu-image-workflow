using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class BackupRetention
{
    private const int KeepCompleted = 2;
    private static readonly Regex BackupName = new Regex(@"^(update|manual)-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$");

    // Unknown and failed snapshots remain available for manual recovery.
    internal static string Prune(string history, string current)
    {
        var warnings = new List<string>();
        try
        {
            history = Path.GetFullPath(history);
            current = Path.GetFullPath(current);
            Plain(history);
            DateTime currentTime;
            if (!Completed(history, current, out currentTime))
                return "未清理旧备份：本次完整备份状态未确认。";
            var completed = new List<KeyValuePair<string, DateTime>>();
            foreach (string folder in Directory.GetDirectories(history))
            {
                if (String.Equals(folder, current, StringComparison.OrdinalIgnoreCase)) continue;
                DateTime time;
                if (Completed(history, folder, out time)) completed.Add(new KeyValuePair<string, DateTime>(folder, time));
            }
            completed.Sort(delegate(KeyValuePair<string, DateTime> left, KeyValuePair<string, DateTime> right)
            {
                int order = right.Value.CompareTo(left.Value);
                return order == 0 ? String.CompareOrdinal(right.Key, left.Key) : order;
            });
            // Pin this update even if the system clock was moved back.
            for (int index = KeepCompleted - 1; index < completed.Count; index++)
            {
                string folder = completed[index].Key;
                try
                {
                    DateTime time;
                    if (!Completed(history, folder, out time)) continue;
                    VerifyTree(folder);
                    if (!DirectChild(history, folder)) throw new IOException("备份路径越界");
                    Directory.Delete(folder, true);
                }
                catch (Exception error)
                {
                    if (!(error is IOException) && !(error is UnauthorizedAccessException)) throw;
                    warnings.Add("旧备份暂未完全清理：" + Path.GetFileName(folder));
                }
            }
        }
        catch (Exception error)
        {
            // Failure to prune must not change a successful installation result.
            if (!(error is IOException) && !(error is UnauthorizedAccessException)) throw;
            warnings.Add("旧备份暂未清理，请检查目录权限或文件占用。");
        }
        return String.Join(Environment.NewLine, warnings.ToArray());
    }

    private static bool DirectChild(string history, string folder)
    {
        return String.Equals(Path.GetDirectoryName(Path.GetFullPath(folder)), history, StringComparison.OrdinalIgnoreCase)
            && BackupName.IsMatch(Path.GetFileName(folder));
    }
    private static bool Completed(string history, string folder, out DateTime time)
    {
        time = DateTime.MinValue;
        try
        {
            if (!DirectChild(history, folder)) return false;
            Plain(folder);
            string marker = Path.Combine(folder, "update.json");
            Plain(marker);
            var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(marker));
            Version version;
            if (Get(state, "state") != "complete" || !Version.TryParse(Get(state, "version"), out version)
                || !DateTime.TryParse(Get(state, "time"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out time)) return false;
            string kind = Get(state, "kind");
            bool manual = Path.GetFileName(folder).StartsWith("manual-", StringComparison.Ordinal);
            if (manual ? kind != "manual" : (kind != "" && kind != "update")) return false;
            if (!manual && !Regex.IsMatch(Get(state, "buildId"), @"^[0-9]{8}T[0-9]{9}Z$")) return false;
            string data = Path.Combine(folder, "data");
            if (!Directory.Exists(data)) return false;
            Plain(data);
            if (manual)
            {
                string env = Path.Combine(folder, ".env");
                if (!File.Exists(env)) return false;
                Plain(env);
            }
            else
            {
                string program = Path.Combine(folder, "program");
                if (!Directory.Exists(program)) return false;
                Plain(program);
            }
            return true;
        }
        catch (Exception error)
        {
            if (error is IOException || error is UnauthorizedAccessException || error is ArgumentException || error is InvalidOperationException) return false;
            throw;
        }
    }
    private static string Get(Dictionary<string, object> state, string name)
    {
        return state != null && state.ContainsKey(name) ? Convert.ToString(state[name]) : "";
    }
    private static void Plain(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("备份包含链接或重定向目录");
    }
    private static void VerifyTree(string directory)
    {
        Plain(directory);
        foreach (string file in Directory.GetFiles(directory)) Plain(file);
        foreach (string folder in Directory.GetDirectories(directory)) VerifyTree(folder);
    }
}
