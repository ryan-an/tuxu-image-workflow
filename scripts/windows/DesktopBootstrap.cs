using System;
using System.IO;
using System.Reflection;
using System.Text;

// Keep this type free of AntdUI references: the resolver must run before the
// CLR loads a window type. The updater remains a single, movable EXE.
internal static class DesktopBootstrap
{
    private static readonly object gate = new object();
    private static Assembly dependency;
    private static bool installed;
    internal static void Install()
    {
        if (installed) return;
        installed = true;
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs args)
        {
            if (new AssemblyName(args.Name).Name != "AntdUI") return null;
            lock (gate)
            {
                if (dependency != null) return dependency;
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("tuxu.desktop.antd"))
                using (var buffer = new MemoryStream())
                {
                    stream.CopyTo(buffer);
                    dependency = Assembly.Load(buffer.ToArray());
                    return dependency;
                }
            }
        };
    }

    internal static void RedirectConsole()
    {
        // GUI executables have no console code page. Use inherited pipes directly
        // for automated verification without allocating a visible console.
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
    }
}
