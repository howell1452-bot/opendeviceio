import { describe, expect, it } from "vitest";
import {
  RECORD_ID_PATTERN,
  claimedValidationStatus,
  idMatchesManufacturer,
  manufacturerSlug,
  restampAsDraft
} from "../lib/submission-doc";

describe("restampAsDraft", () => {
  it("replaces a claimed manufacturer-verified status with a bare draft", () => {
    const doc = {
      id: "acme/x1",
      provenance: {
        method: "manufacturer",
        generator: "manual",
        sourceDocuments: [{ title: "x1.pdf" }],
        validation: { status: "manufacturer-verified", by: "Acme", date: "2026-01-01" }
      }
    };
    const out = restampAsDraft(doc);
    expect(out.provenance.validation).toEqual({ status: "draft" });
    // The submitter's description of how the data was made is kept.
    expect(out.provenance.method).toBe("manufacturer");
    expect(out.provenance.generator).toBe("manual");
    expect(out.provenance.sourceDocuments).toEqual([{ title: "x1.pdf" }]);
    // Input untouched.
    expect(doc.provenance.validation.status).toBe("manufacturer-verified");
  });

  it("adds a draft validation when the file has no provenance", () => {
    const out = restampAsDraft({ id: "acme/x1" }) as { provenance?: unknown };
    expect(out.provenance).toEqual({ validation: { status: "draft" } });
  });

  it("drops extension keys inside validation too", () => {
    const out = restampAsDraft({
      provenance: { validation: { status: "reviewed", "x-reviewer": "me" } }
    });
    expect(out.provenance.validation).toEqual({ status: "draft" });
  });
});

describe("claimedValidationStatus", () => {
  it("reads the claim without trusting it", () => {
    expect(claimedValidationStatus({ provenance: { validation: { status: "reviewed" } } })).toBe(
      "reviewed"
    );
    expect(claimedValidationStatus({})).toBeNull();
    expect(claimedValidationStatus(null)).toBeNull();
  });
});

describe("record ids", () => {
  it("accepts the schema id shape", () => {
    for (const id of ["crestron/dm-md8x8", "qsc/core-110f@v2", "a/b.c_d-e"]) {
      expect(RECORD_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ["Crestron/x", "crestron", "crestron/", "/x", "a/b/c", "a/-b"]) {
      expect(RECORD_ID_PATTERN.test(id)).toBe(false);
    }
  });

  it("slugs manufacturer names", () => {
    expect(manufacturerSlug("Extron Electronics")).toBe("extron-electronics");
    expect(manufacturerSlug("Audio-Technica")).toBe("audio-technica");
    expect(manufacturerSlug("AT&T")).toBe("at-and-t");
    expect(manufacturerSlug("Société Générale")).toBe("societe-generale");
  });

  it("matches the id prefix to the manufacturer, ignoring hyphens", () => {
    expect(idMatchesManufacturer("crestron/dm-md8x8", "Crestron")).toBe(true);
    expect(idMatchesManufacturer("audio-technica/atnd971", "Audio-Technica")).toBe(true);
    expect(idMatchesManufacturer("audiotechnica/atnd971", "Audio-Technica")).toBe(true);
    expect(idMatchesManufacturer("crestron/x", "Extron")).toBe(false);
    expect(idMatchesManufacturer("qsys/core", "QSC")).toBe(false);
  });
});
