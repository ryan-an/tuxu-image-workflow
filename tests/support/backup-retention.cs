using System;
using System.IO;
using System.Text;

internal static class RetentionHarness
{
    private static void Main(string[] args)
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        if (args.Length > 2)
            using (var locked = File.Open(args[2], FileMode.Open, FileAccess.Read, FileShare.None))
                Console.WriteLine(BackupRetention.Prune(args[0], args[1]));
        else Console.WriteLine(BackupRetention.Prune(args[0], args[1]));
    }
}
