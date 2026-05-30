using System.Collections.Generic;
using Newtonsoft.Json;

namespace OpenDeviceIO.AutoCAD
{
    // POCO mirror of the OpenDeviceIO DrawProgram JSON (packages/adapters/src/drawops.ts),
    // returned by GET /api/v1/devices/{id}?format=draw. Coordinates are millimetres
    // with the origin at the block's bottom-left and Y up — the same convention as an
    // AutoCAD drawing in mm, so points map straight through.

    public sealed class DocumentPrograms
    {
        [JsonProperty("programs")] public List<DrawProgram> Programs { get; set; } = new List<DrawProgram>();
        [JsonProperty("cables")] public List<CableAnnotation> Cables { get; set; } = new List<CableAnnotation>();
        [JsonProperty("warnings")] public List<string> Warnings { get; set; } = new List<string>();
        [JsonProperty("fileBase")] public string FileBase { get; set; }
    }

    public sealed class CableAnnotation
    {
        [JsonProperty("label")] public string Label { get; set; }
    }

    public sealed class DrawProgram
    {
        [JsonProperty("units")] public string Units { get; set; }
        [JsonProperty("width")] public double Width { get; set; }
        [JsonProperty("height")] public double Height { get; set; }
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("ops")] public List<DrawOp> Ops { get; set; } = new List<DrawOp>();
    }

    // A flat DTO covering every DrawOp variant (discriminated by `op`). Unused fields
    // stay null/0 per op kind — pragmatic vs. a custom polymorphic converter.
    public sealed class DrawOp
    {
        [JsonProperty("op")] public string Op { get; set; }

        // rect
        [JsonProperty("x")] public double X { get; set; }
        [JsonProperty("y")] public double Y { get; set; }
        [JsonProperty("w")] public double W { get; set; }
        [JsonProperty("h")] public double H { get; set; }
        [JsonProperty("fill")] public string Fill { get; set; }
        [JsonProperty("stroke")] public bool Stroke { get; set; }

        // line
        [JsonProperty("x1")] public double X1 { get; set; }
        [JsonProperty("y1")] public double Y1 { get; set; }
        [JsonProperty("x2")] public double X2 { get; set; }
        [JsonProperty("y2")] public double Y2 { get; set; }

        // circle
        [JsonProperty("r")] public double R { get; set; }

        // text
        [JsonProperty("value")] public string Value { get; set; }
        [JsonProperty("align")] public string Align { get; set; }   // left | center | right
        [JsonProperty("valign")] public string Valign { get; set; } // middle | baseline
        [JsonProperty("bold")] public bool Bold { get; set; }
        [JsonProperty("maxWidth")] public double? MaxWidth { get; set; }

        // connection
        [JsonProperty("label")] public string Label { get; set; }

        [JsonProperty("layer")] public string Layer { get; set; }
    }
}
