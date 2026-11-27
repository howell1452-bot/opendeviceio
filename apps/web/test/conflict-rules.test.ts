import { describe, expect, it } from "vitest";
import {
  AUTO_TRUST_ACCEPTED,
  MANUFACTURER_PUBLISH,
  SOURCE_RANK,
  decideSubmission,
  earnsTrust,
  type CurrentRecord,
  type SubmissionInput
} from "../lib/conflict-rules";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";
const VENDOR_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const VENDOR_B = "bbbbbbbb-0000-0000-0000-00000000000b";

function community(over: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    sourceType: "community",
    userId: ALICE,
    orgId: null,
    trusted: false,
    brandPolicy: "allowed",
    removedOnRequest: false,
    ...over
  };
}

function vendor(over: Partial<SubmissionInput> = {}): SubmissionInput {
  return community({ sourceType: "design-vendor", orgId: VENDOR_A, ...over });
}

function record(over: Partial<CurrentRecord> = {}): CurrentRecord {
  return {
    validationStatus: "draft",
    sourceType: "machine-draft",
    sourceOrgId: null,
    submittedBy: null,
    ...over
  };
}

describe("precedence", () => {
  it("ranks sources machine-draft < community < design-vendor < manufacturer", () => {
    expect(SOURCE_RANK["machine-draft"]).toBeLessThan(SOURCE_RANK.community);
    expect(SOURCE_RANK.community).toBeLessThan(SOURCE_RANK["design-vendor"]);
    expect(SOURCE_RANK["design-vendor"]).toBeLessThan(SOURCE_RANK.manufacturer);
  });
});

describe("brand policy", () => {
  it("blocked brand rejects every submission, even for a new id", () => {
    expect(decideSubmission(community({ brandPolicy: "blocked" }), null).outcome).toBe("blocked");
    expect(decideSubmission(vendor({ brandPolicy: "blocked" }), record()).outcome).toBe("blocked");
    expect(
      decideSubmission(community({ brandPolicy: "blocked", trusted: true }), record()).outcome
    ).toBe("blocked");
  });

  it("suggestions-only brand always saves a suggestion routed to the brand", () => {
    for (const current of [null, record(), record({ sourceType: "community", submittedBy: ALICE })]) {
      const d = decideSubmission(vendor({ brandPolicy: "suggestions-only" }), current);
      expect(d).toMatchObject({ outcome: "suggested", route: "brand" });
    }
    expect(
      decideSubmission(community({ brandPolicy: "suggestions-only", trusted: true }), null)
    ).toMatchObject({ outcome: "suggested", route: "brand" });
  });
});

describe("record is manufacturer-verified", () => {
  const verified = record({ validationStatus: "manufacturer-verified", sourceType: "manufacturer" });

  it("any submission becomes a suggestion for the brand", () => {
    for (const input of [community(), community({ trusted: true }), vendor()]) {
      expect(decideSubmission(input, verified)).toMatchObject({ outcome: "suggested", route: "brand" });
    }
  });

  it("a file claiming verification cannot overwrite it (the claim is not an input)", () => {
    // decideSubmission never sees the file's provenance; even a trusted vendor
    // submitter can only suggest.
    expect(decideSubmission(vendor(), verified).outcome).toBe("suggested");
  });
});

describe("record is reviewed", () => {
  it("any submission becomes a suggestion for admins", () => {
    const reviewed = record({ validationStatus: "reviewed" });
    for (const input of [community(), community({ trusted: true }), vendor()]) {
      expect(decideSubmission(input, reviewed)).toMatchObject({ outcome: "suggested", route: "admins" });
    }
  });
});

describe("removed on request", () => {
  it("saves a suggestion for admins instead of republishing", () => {
    expect(decideSubmission(vendor({ removedOnRequest: true }), null)).toMatchObject({
      outcome: "suggested",
      route: "admins"
    });
    expect(
      decideSubmission(community({ removedOnRequest: true, trusted: true }), record())
    ).toMatchObject({ outcome: "suggested", route: "admins" });
  });
});

describe("record does not exist", () => {
  it("verified design vendor publishes", () => {
    expect(decideSubmission(vendor(), null)).toMatchObject({ outcome: "published", route: "none" });
  });
  it("trusted community contributor publishes", () => {
    expect(decideSubmission(community({ trusted: true }), null).outcome).toBe("published");
  });
  it("untrusted community contributor goes to moderation", () => {
    expect(decideSubmission(community(), null)).toMatchObject({ outcome: "pending", route: "admins" });
  });
  it("a design-vendor tier without an org is treated as community", () => {
    expect(decideSubmission(vendor({ orgId: null }), null).outcome).toBe("pending");
  });
});

describe("record is an unverified draft", () => {
  it("the same submitter's update publishes, even if untrusted", () => {
    const own = record({ sourceType: "community", submittedBy: ALICE });
    expect(decideSubmission(community(), own).outcome).toBe("published");
  });

  it("the same org's update publishes, whoever in the org sends it", () => {
    const orgDraft = record({ sourceType: "design-vendor", sourceOrgId: VENDOR_A, submittedBy: BOB });
    expect(decideSubmission(vendor(), orgDraft).outcome).toBe("published");
  });

  it("vendor over machine draft publishes", () => {
    expect(decideSubmission(vendor(), record()).outcome).toBe("published");
  });

  it("vendor over community draft publishes", () => {
    const c = record({ sourceType: "community", submittedBy: BOB });
    expect(decideSubmission(vendor(), c).outcome).toBe("published");
  });

  it("vendor over another vendor's draft publishes (same tier)", () => {
    const other = record({ sourceType: "design-vendor", sourceOrgId: VENDOR_B, submittedBy: BOB });
    expect(decideSubmission(vendor(), other).outcome).toBe("published");
  });

  it("community over machine draft needs a trusted contributor", () => {
    expect(decideSubmission(community({ trusted: true }), record()).outcome).toBe("published");
    expect(decideSubmission(community(), record())).toMatchObject({ outcome: "pending", route: "admins" });
  });

  it("community over another contributor's community draft needs trust too", () => {
    const c = record({ sourceType: "community", submittedBy: BOB });
    expect(decideSubmission(community({ trusted: true }), c).outcome).toBe("published");
    expect(decideSubmission(community(), c).outcome).toBe("pending");
  });

  it("community over a vendor draft is a suggestion", () => {
    const v = record({ sourceType: "design-vendor", sourceOrgId: VENDOR_A, submittedBy: BOB });
    expect(decideSubmission(community({ trusted: true }), v)).toMatchObject({
      outcome: "suggested",
      route: "admins"
    });
  });

  it("anything over a manufacturer-sourced draft is a suggestion", () => {
    const m = record({ sourceType: "manufacturer" });
    expect(decideSubmission(vendor(), m).outcome).toBe("suggested");
    expect(decideSubmission(community({ trusted: true }), m).outcome).toBe("suggested");
  });

  it("a null validation status counts as a draft", () => {
    expect(decideSubmission(vendor(), record({ validationStatus: null })).outcome).toBe("published");
  });
});

describe("manufacturer publish", () => {
  it("replaces the record, supersedes the published revision, keeps suggestions open", () => {
    expect(MANUFACTURER_PUBLISH.replacesRecord).toBe(true);
    expect(MANUFACTURER_PUBLISH.supersedeStatuses).toEqual(["published"]);
    expect(MANUFACTURER_PUBLISH.keepOpenStatuses).toEqual(["pending", "suggested"]);
  });
});

describe("auto-trust", () => {
  it(`trusts at ${AUTO_TRUST_ACCEPTED} accepted with none rejected`, () => {
    expect(earnsTrust(AUTO_TRUST_ACCEPTED, 0)).toBe(true);
    expect(earnsTrust(AUTO_TRUST_ACCEPTED + 4, 0)).toBe(true);
  });
  it("not below the threshold, and not with any rejection", () => {
    expect(earnsTrust(AUTO_TRUST_ACCEPTED - 1, 0)).toBe(false);
    expect(earnsTrust(AUTO_TRUST_ACCEPTED + 5, 1)).toBe(false);
  });
});
