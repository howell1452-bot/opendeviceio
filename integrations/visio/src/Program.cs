using System;
using System.Net.Http;
using System.Runtime.InteropServices;
using Newtonsoft.Json;
using Visio = Microsoft.Office.Interop.Visio;

namespace OpenDeviceIO.Visio
{
    // OdioToVisio: attach to a running Visio (or launch one), fetch a device's
    // DrawProgram from the OpenDeviceIO API, and draw the schematic block onto the
    // active page via the Visio COM API. Draws live shapes — no .vssx stencil.
    //
    // Usage:  OdioToVisio <device-id>            e.g. OdioToVisio crestron/dm-nvx-360
    // Env:    ODIO_API_BASE (default https://opendeviceio.org)
    //
    // DEVELOPER PREVIEW — not compiled/tested here. Visio COM cell names/units are the
    // most likely things to adjust. mm -> inches via /25.4; Visio Y is already up.
    internal static class Program
    {
        private static readonly HttpClient Http = new HttpClient();
        private const double MmToIn = 1.0 / 25.4;

        private static int Main(string[] args)
        {
            // Accept the id as an argument, or prompt (so a Start-menu shortcut works).
            string id = args.Length >= 1 ? args[0] : null;
            if (string.IsNullOrWhiteSpace(id))
            {
                Console.Write("OpenDeviceIO device id (e.g. crestron/dm-nvx-360): ");
                id = (Console.ReadLine() ?? "").Trim();
            }
            if (string.IsNullOrWhiteSpace(id))
            {
                Console.Error.WriteLine("No device id given.");
                return 2;
            }
            string apiBase = Environment.GetEnvironmentVariable("ODIO_API_BASE") ?? "https://opendeviceio.org";

            DocumentPrograms doc;
            try
            {
                string url = $"{apiBase}/api/v1/devices/{Uri.EscapeUriString(id)}?format=draw";
                Console.WriteLine($"Fetching {url} ...");
                string json = Http.GetStringAsync(url).GetAwaiter().GetResult();
                doc = JsonConvert.DeserializeObject<DocumentPrograms>(json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Fetch/parse failed: {ex.Message}");
                return 1;
            }
            if (doc?.Programs == null || doc.Programs.Count == 0)
            {
                Console.Error.WriteLine("No blocks returned for that id.");
                return 1;
            }

            Visio.Application app = GetOrStartVisio();
            if (app == null) { Console.Error.WriteLine("Could not start/attach to Visio."); return 1; }
            Visio.Page page = app.ActivePage ?? app.Documents.Add("").Pages[1];

            const double blockGapMm = 40.0;
            double cursorMm = 0.0;
            int drawn = 0;
            foreach (DrawProgram program in doc.Programs)
            {
                DrawProgramOnPage(page, program, cursorMm);
                cursorMm += program.Width + blockGapMm;
                drawn++;
            }

            double cyMm = -16.0;
            foreach (CableAnnotation c in doc.Cables ?? new System.Collections.Generic.List<CableAnnotation>())
            {
                DrawText(page, c.Label ?? "", 0, cyMm, 2.0, "left", "baseline", maxWidthMm: 80);
                cyMm -= 7.2;
            }

            Console.WriteLine($"Imported {drawn} block(s) for '{id}'.");
            return 0;
        }

        private static Visio.Application GetOrStartVisio()
        {
            try { return (Visio.Application)Marshal.GetActiveObject("Visio.Application"); }
            catch { /* none running */ }
            try { return new Visio.Application { Visible = true }; }
            catch { return null; }
        }

        private static void DrawProgramOnPage(Visio.Page page, DrawProgram program, double offsetXmm)
        {
            foreach (DrawOp op in program.Ops)
            {
                switch (op.Op)
                {
                    case "rect":
                    {
                        var s = page.DrawRectangle(
                            In(offsetXmm + op.X), In(op.Y), In(offsetXmm + op.X + op.W), In(op.Y + op.H));
                        if (!string.IsNullOrEmpty(op.Fill)) SetFill(s, op.Fill);
                        else NoFill(s);
                        break;
                    }
                    case "line":
                        page.DrawLine(In(offsetXmm + op.X1), In(op.Y1), In(offsetXmm + op.X2), In(op.Y2));
                        break;
                    case "circle":
                        page.DrawOval(
                            In(offsetXmm + op.X - op.R), In(op.Y - op.R),
                            In(offsetXmm + op.X + op.R), In(op.Y + op.R));
                        break;
                    case "text":
                        DrawText(page, op.Value ?? "", offsetXmm + op.X, op.Y, op.H, op.Align, op.Valign, op.MaxWidth ?? 0);
                        break;
                    case "connection":
                        // Visio connection points could be added to the body shape's
                        // Connection-Points section; omitted in this preview.
                        break;
                }
            }
        }

        // Place a text shape whose box is positioned so the text aligns to (xMm,yMm).
        private static void DrawText(Visio.Page page, string text, double xMm, double yMm,
            double hMm, string align, string valign, double maxWidthMm)
        {
            double wMm = maxWidthMm > 0 ? maxWidthMm : Math.Max(20, text.Length * hMm * 0.6);
            double left, right;
            switch (align)
            {
                case "center": left = xMm - wMm / 2; right = xMm + wMm / 2; break;
                case "right": left = xMm - wMm; right = xMm; break;
                default: left = xMm; right = xMm + wMm; break;
            }
            bool middle = valign != "baseline";
            double bottom = middle ? yMm - hMm / 2 : yMm;
            double top = middle ? yMm + hMm / 2 : yMm + hMm;

            var s = page.DrawRectangle(In(left), In(bottom), In(right), In(top));
            s.Text = text;
            NoFill(s);
            NoLine(s);
            try { s.CellsU["Char.Size"].FormulaU = $"{In(hMm)} in"; } catch { /* cell name varies */ }
            try { s.CellsU["Para.HorzAlign"].FormulaU = align == "center" ? "1" : align == "right" ? "2" : "0"; } catch { }
            try { s.CellsU["VerticalAlign"].FormulaU = middle ? "1" : "0"; } catch { }
        }

        private static double In(double mm) => mm * MmToIn;

        private static void NoFill(Visio.Shape s) { try { s.CellsU["FillPattern"].FormulaU = "0"; } catch { } }
        private static void NoLine(Visio.Shape s) { try { s.CellsU["LinePattern"].FormulaU = "0"; } catch { } }
        private static void SetFill(Visio.Shape s, string hex)
        {
            try { s.CellsU["FillForegnd"].FormulaU = $"RGB({HexToRgb(hex)})"; s.CellsU["FillPattern"].FormulaU = "1"; }
            catch { }
        }

        private static string HexToRgb(string hex)
        {
            hex = hex.TrimStart('#');
            if (hex.Length != 6) return "242,169,59";
            int r = Convert.ToInt32(hex.Substring(0, 2), 16);
            int g = Convert.ToInt32(hex.Substring(2, 2), 16);
            int b = Convert.ToInt32(hex.Substring(4, 2), 16);
            return $"{r},{g},{b}";
        }
    }
}
