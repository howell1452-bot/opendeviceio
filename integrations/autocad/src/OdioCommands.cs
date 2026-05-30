using System;
using System.Net.Http;
using System.Collections.Generic;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;
using Newtonsoft.Json;

[assembly: CommandClass(typeof(OpenDeviceIO.AutoCAD.OdioCommands))]

namespace OpenDeviceIO.AutoCAD
{
    /// <summary>
    /// ODIOIMPORT command: pull a device's DrawProgram from the OpenDeviceIO API
    /// (?format=draw) and draw its schematic block(s) into the active drawing.
    /// Layout is computed server-side from the .odio file (single source), so this
    /// add-in only translates DrawOps -> AutoCAD entities. 1 drawing unit = 1 mm.
    /// </summary>
    public class OdioCommands
    {
        private static readonly HttpClient Http = new HttpClient();

        private static string ApiBase =>
            Environment.GetEnvironmentVariable("ODIO_API_BASE") ?? "https://opendeviceio.org";

        [CommandMethod("ODIOIMPORT")]
        public void OdioImport()
        {
            Document doc = Application.DocumentManager.MdiActiveDocument;
            if (doc == null) return;
            Editor ed = doc.Editor;
            Database db = doc.Database;

            var idRes = ed.GetString(new PromptStringOptions("\nOpenDeviceIO device id (e.g. crestron/dm-md8x8): ") { AllowSpaces = false });
            if (idRes.Status != PromptStatus.OK || string.IsNullOrWhiteSpace(idRes.StringResult)) return;
            string id = idRes.StringResult.Trim();

            DocumentPrograms doc2;
            try
            {
                string url = $"{ApiBase}/api/v1/devices/{Uri.EscapeUriString(id)}?format=draw";
                ed.WriteMessage($"\nFetching {url} ...");
                string json = Http.GetStringAsync(url).GetAwaiter().GetResult();
                doc2 = JsonConvert.DeserializeObject<DocumentPrograms>(json);
            }
            catch (Exception ex)
            {
                ed.WriteMessage($"\nODIO: fetch/parse failed: {ex.Message}");
                return;
            }
            if (doc2 == null || doc2.Programs == null || doc2.Programs.Count == 0)
            {
                ed.WriteMessage("\nODIO: no blocks returned for that id.");
                return;
            }

            var ptRes = ed.GetPoint("\nInsertion point: ");
            if (ptRes.Status != PromptStatus.OK) return;
            Point3d basePt = ptRes.Value;

            const double blockGapMm = 40.0;
            int drawn = 0;
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                EnsureLayer(db, tr, "DEVICE", 7);
                EnsureLayer(db, tr, "PORTS", 5);
                EnsureLayer(db, tr, "TEXT", 4);

                var bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                var ms = (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace], OpenMode.ForWrite);

                double cursorX = 0.0;
                foreach (DrawProgram program in doc2.Programs)
                {
                    ObjectId btrId = BuildBlock(db, tr, bt, program);
                    var br = new BlockReference(new Point3d(basePt.X + cursorX, basePt.Y, 0), btrId) { Layer = "DEVICE" };
                    ms.AppendEntity(br);
                    tr.AddNewlyCreatedDBObject(br, true);
                    cursorX += program.Width + blockGapMm;
                    drawn++;
                }

                // Cable annotations beneath the row.
                double cy = -16.0;
                foreach (CableAnnotation c in doc2.Cables ?? new List<CableAnnotation>())
                {
                    var t = new MText
                    {
                        Contents = c.Label ?? "",
                        TextHeight = 2.0,
                        Location = new Point3d(basePt.X, basePt.Y + cy, 0),
                        Attachment = AttachmentPoint.TopLeft,
                        Layer = "TEXT"
                    };
                    ms.AppendEntity(t);
                    tr.AddNewlyCreatedDBObject(t, true);
                    cy -= 7.2;
                }

                tr.Commit();
            }
            ed.WriteMessage($"\nODIO: imported {drawn} block(s) for '{id}'.");
        }

        /// <summary>Create a BlockTableRecord from a DrawProgram and return its id.</summary>
        private static ObjectId BuildBlock(Database db, Transaction tr, BlockTable bt, DrawProgram program)
        {
            string name = UniqueBlockName(bt, BlockName(program.Title));
            var btr = new BlockTableRecord { Name = name, Origin = Point3d.Origin };
            bt.UpgradeOpen();
            ObjectId btrId = bt.Add(btr);
            tr.AddNewlyCreatedDBObject(btr, true);

            foreach (DrawOp op in program.Ops)
            {
                Entity e = ToEntity(op);
                if (e == null) continue;
                btr.AppendEntity(e);
                tr.AddNewlyCreatedDBObject(e, true);
            }
            return btrId;
        }

        private static Entity ToEntity(DrawOp op)
        {
            switch (op.Op)
            {
                case "rect":
                {
                    var pl = new Polyline();
                    pl.AddVertexAt(0, new Point2d(op.X, op.Y), 0, 0, 0);
                    pl.AddVertexAt(1, new Point2d(op.X + op.W, op.Y), 0, 0, 0);
                    pl.AddVertexAt(2, new Point2d(op.X + op.W, op.Y + op.H), 0, 0, 0);
                    pl.AddVertexAt(3, new Point2d(op.X, op.Y + op.H), 0, 0, 0);
                    pl.Closed = true;
                    pl.Layer = op.Layer ?? "DEVICE";
                    return pl;
                }
                case "line":
                    return new Line(new Point3d(op.X1, op.Y1, 0), new Point3d(op.X2, op.Y2, 0)) { Layer = op.Layer ?? "PORTS" };
                case "circle":
                    return new Circle(new Point3d(op.X, op.Y, 0), Vector3d.ZAxis, op.R) { Layer = op.Layer ?? "PORTS" };
                case "text":
                    return new MText
                    {
                        Contents = op.Value ?? "",
                        TextHeight = op.H,
                        Location = new Point3d(op.X, op.Y, 0),
                        Attachment = MapAttachment(op.Align, op.Valign),
                        // Native font metrics are narrower than the server's 0.95
                        // sizing estimate, so text fits without truncation/wrapping.
                        Layer = op.Layer ?? "TEXT"
                    };
                case "connection":
                    // AutoCAD has no connection-point primitive; the stub line +
                    // terminal circle already mark it.
                    return null;
                default:
                    return null;
            }
        }

        private static AttachmentPoint MapAttachment(string align, string valign)
        {
            bool middle = valign != "baseline";
            switch (align)
            {
                case "center": return middle ? AttachmentPoint.MiddleCenter : AttachmentPoint.BottomCenter;
                case "right": return middle ? AttachmentPoint.MiddleRight : AttachmentPoint.BottomRight;
                default: return middle ? AttachmentPoint.MiddleLeft : AttachmentPoint.BottomLeft;
            }
        }

        private static void EnsureLayer(Database db, Transaction tr, string name, short colorIndex)
        {
            var lt = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
            if (lt.Has(name)) return;
            lt.UpgradeOpen();
            var ltr = new LayerTableRecord
            {
                Name = name,
                Color = Autodesk.AutoCAD.Colors.Color.FromColorIndex(Autodesk.AutoCAD.Colors.ColorMethod.ByAci, colorIndex)
            };
            lt.Add(ltr);
            tr.AddNewlyCreatedDBObject(ltr, true);
        }

        private static string BlockName(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return "ODIO_DEVICE";
            var chars = title.ToUpperInvariant().ToCharArray();
            for (int i = 0; i < chars.Length; i++)
                if (!char.IsLetterOrDigit(chars[i])) chars[i] = '_';
            string s = new string(chars).Trim('_');
            return string.IsNullOrEmpty(s) ? "ODIO_DEVICE" : "ODIO_" + s;
        }

        private static string UniqueBlockName(BlockTable bt, string baseName)
        {
            string name = baseName;
            int n = 1;
            while (bt.Has(name)) name = $"{baseName}_{++n}";
            return name;
        }
    }
}
