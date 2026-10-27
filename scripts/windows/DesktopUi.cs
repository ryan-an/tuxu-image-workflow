using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal class DesktopWindow : AntdUI.BorderlessForm
{
    private int logicalHeight;
    private readonly int logicalWidth;
    internal DesktopWindow(string caption, string section, int height, int width = 640)
    {
        logicalHeight = height;
        logicalWidth = width;
        AntdUI.Config.Mode = AntdUI.TMode.Light;
        AntdUI.Config.TextRenderingHighQuality = true;
        AntdUI.Config.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        AntdUI.Style.SetPrimary(DesktopTokens.ColorBrand);
        AntdUI.Style.Set(AntdUI.Colour.PrimaryHover, DesktopTokens.ColorBrandHover);
        AntdUI.Style.Set(AntdUI.Colour.PrimaryBg, DesktopTokens.ColorBrandSoft);
        AntdUI.Style.Set(AntdUI.Colour.PrimaryBorder, DesktopTokens.ColorBrandBorder);
        AntdUI.Style.Set(AntdUI.Colour.Text, DesktopTokens.ColorText);
        AntdUI.Style.Set(AntdUI.Colour.TextSecondary, DesktopTokens.ColorMuted);
        AntdUI.Style.Set(AntdUI.Colour.TextTertiary, DesktopTokens.ColorMuted);
        AntdUI.Style.Set(AntdUI.Colour.TextQuaternary, DesktopTokens.ColorMuted);
        AntdUI.Style.Set(AntdUI.Colour.BorderColor, DesktopTokens.ColorBorder);
        AntdUI.Style.SetSuccess(DesktopTokens.ColorSuccess);
        AntdUI.Style.SetError(DesktopTokens.ColorDanger);
        Text = caption;
        Font = new Font("Microsoft YaHei UI", 9F);
        ForeColor = DesktopTokens.ColorText;
        BackColor = DesktopTokens.ColorCanvas;
        BorderColor = DesktopTokens.ColorBorder;
        Resizable = false;
        Radius = DesktopTokens.RadiusLg;
        Shadow = 8;
        BorderWidth = 1;
        ClientSize = new Size(width, height);
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        // AntdUI performs per-monitor scaling, so disable WinForms' second pass.
        AutoScaleMode = AutoScaleMode.None;
        AutoHandDpi = true;
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
        string svg;
        using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("tuxu.desktop.logo"))) svg = reader.ReadToEnd();
        Controls.Add(new AntdUI.PageHeader {
            Text = "图序", SubText = section, Font = new Font(Font.FontFamily, 12F, FontStyle.Bold),
            SubFont = new Font(Font.FontFamily, 9F), UseTitleFont = false,
            IconSvg = svg, IconRatio = 1.25F, ShowIcon = true, ShowButton = true,
            MaximizeBox = false, MinimizeBox = true, EnableDoubleClickMaximize = false,
            DragMove = true, DividerShow = true, DividerColor = DesktopTokens.ColorBorder,
            BackColor = DesktopTokens.ColorSurface, ForeColor = DesktopTokens.ColorText,
            Padding = new Padding(16, 0, 0, 0), Dock = DockStyle.Top, Height = 52,
            CloseSize = 42
        });
    }

    protected override void OnShown(EventArgs args)
    {
        // .NET Framework reports framed client metrics during the first handle
        // callback. Preserve the full borderless content area after UI scaling.
        ClientSize = new Size((int)(logicalWidth * Dpi), (int)(logicalHeight * Dpi));
        base.OnShown(args);
    }

    protected void SetContentHeight(int height)
    {
        logicalHeight = height;
        float scale = IsHandleCreated ? Dpi : 1F;
        ClientSize = new Size((int)(logicalWidth * scale), (int)(height * scale));
    }

    internal static AntdUI.Label TextLabel(Control parent, string text, int x, int y, int width, int height = 24, float size = 9F, bool bold = false, bool muted = false)
    {
        var label = new AntdUI.Label {
            Text = text, Location = new Point(x, y), Size = new Size(width, height),
            Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
            ForeColor = muted ? DesktopTokens.ColorMuted : DesktopTokens.ColorText,
            BackColor = Color.Transparent, TextMultiLine = true
        };
        parent.Controls.Add(label);
        return label;
    }

    internal static AntdUI.Panel Card(Control parent, int x, int y, int width, int height)
    {
        var panel = new AntdUI.Panel {
            Location = new Point(x, y), Size = new Size(width, height), Radius = DesktopTokens.RadiusLg,
            Back = DesktopTokens.ColorSurface, BorderColor = DesktopTokens.ColorBorder, BorderWidth = 1,
            BackColor = Color.Transparent
        };
        parent.Controls.Add(panel);
        return panel;
    }

    internal static AntdUI.Button ActionButton(Control parent, string text, string icon, int x, int y, int width, bool primary = false, bool ghost = false)
    {
        var button = new AntdUI.Button {
            Text = text, IconSvg = icon, Location = new Point(x, y), Size = new Size(width, 40),
            Radius = DesktopTokens.RadiusMd, WaveSize = 2, BorderWidth = ghost || primary ? 0 : 1,
            Type = primary ? AntdUI.TTypeMini.Primary : AntdUI.TTypeMini.Default,
            ForeColor = primary ? DesktopTokens.ColorSurface : DesktopTokens.ColorText,
            DefaultBack = ghost ? DesktopTokens.ColorCanvas : DesktopTokens.ColorSurface,
            DefaultBorderColor = DesktopTokens.ColorBorder,
            BackHover = primary ? DesktopTokens.ColorBrandHover : DesktopTokens.ColorBrandSoft,
            ForeHover = primary ? DesktopTokens.ColorSurface : DesktopTokens.ColorBrand,
            Cursor = Cursors.Hand, AccessibleName = text
        };
        parent.Controls.Add(button);
        return button;
    }

    internal static AntdUI.Input ReadField(Control parent, int x, int y, int width, int height = 40, bool multiline = false)
    {
        var input = new AntdUI.Input {
            Location = new Point(x, y), Size = new Size(width, height), Radius = DesktopTokens.RadiusMd,
            ReadOnly = true, Multiline = multiline, BorderWidth = 0, WaveSize = 0,
            BackColor = DesktopTokens.ColorCanvas, ForeColor = DesktopTokens.ColorText,
            BorderActive = DesktopTokens.ColorBrand, Padding = new Padding(10, 0, 10, 0),
            Font = new Font("Microsoft YaHei UI", 9F)
        };
        parent.Controls.Add(input);
        return input;
    }

    internal static AntdUI.Tag StatusTag(Control parent, string text, int x, int y, int width, Color fore, Color back)
    {
        var tag = new AntdUI.Tag { Text = text, Location = new Point(x, y), Size = new Size(width, 28),
            ForeColor = fore, BackColor = back, BorderWidth = 0, Radius = DesktopTokens.RadiusSm, Font = new Font("Microsoft YaHei UI", 8.5F) };
        parent.Controls.Add(tag);
        return tag;
    }

    internal static void CopyText(string text, AntdUI.Button button)
    {
        if (String.IsNullOrEmpty(text)) return;
        try
        {
            Clipboard.SetText(text);
            string original = button.AccessibleName;
            button.Text = "已复制";
            var timer = new System.Windows.Forms.Timer { Interval = 1600 };
            timer.Tick += delegate { timer.Stop(); timer.Dispose(); if (!button.IsDisposed) button.Text = original; };
            timer.Start();
        }
        catch (System.Runtime.InteropServices.ExternalException) { MessageBox.Show("剪贴板正被其他程序使用，请稍后重试。", "图序"); }
    }
}
