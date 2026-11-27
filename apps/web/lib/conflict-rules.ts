// Conflict and precedence rules for registry submissions (provenance brief,
// item 5). Pure: no I/O, no framework imports, so it is unit-tested directly
// (test/conflict-rules.test.ts). Server code gathers the inputs, calls
// decideSubmission(), and stores the revision with the returned status.
//
// Precedence: manufacturer-verified > reviewed > design-vendor > community > machine-draft.
//
// Manufacturer publishes (/publish, /author, Bearer POST /api/v1/devices) do
// not go through decideSubmission: they always replace the record. See
// MANUFACTURER_PUBLISH below.

export type SourceType = "machine-draft" | "community" | "design-vendor" | "manufacturer";

/** Rank of a record's source. Verification is checked separately and outranks all of these. */
export const SOURCE_RANK: Readonly<Record<SourceType, number>> = {
  "machine-draft": 0,
  community: 1,
  "design-vendor": 2,
  manufacturer: 3
};

export type BrandSubmissionPolicy = "allowed" | "suggestions-only" | "blocked";

/** Who a non-published revision is waiting on. */
export type ReviewRoute = "none" | "admins" | "brand";

export interface SubmissionInput {
  /** The tier the submitter qualifies for (worked out server-side, never from the file). */
  sourceType: "community" | "design-vendor";
  userId: string;
  /** The verified design-vendor org the user is submitting as, if any. */
  orgId: string | null;
  /** contributor_status.trusted */
  trusted: boolean;
  /** brand_settings.community_submissions for the document's manufacturer. */
  brandPolicy: BrandSubmissionPolicy;
  /**
   * The id was taken down on request (a removal-feed entry with a reason), or
   * the brand's drafts are hidden at its request. Never republished automatically.
   */
  removedOnRequest: boolean;
}

/** The registry record the submission targets, or null when the id is new. */
export interface CurrentRecord {
  validationStatus: string | null;
  sourceType: SourceType;
  sourceOrgId: string | null;
  /** Submitter of the record's current revision (null for seeded / manufacturer rows). */
  submittedBy: string | null;
}

export type SubmissionDecision =
  | { outcome: "blocked"; reason: string }
  | {
      outcome: "published" | "pending" | "suggested";
      route: ReviewRoute;
      reason: string;
    };

const published = (reason: string): SubmissionDecision => ({
  outcome: "published",
  route: "none",
  reason
});
const pending = (reason: string): SubmissionDecision => ({
  outcome: "pending",
  route: "admins",
  reason
});
const suggested = (route: ReviewRoute, reason: string): SubmissionDecision => ({
  outcome: "suggested",
  route,
  reason
});

/** Decide what happens to a community or design-vendor submission. */
export function decideSubmission(
  input: SubmissionInput,
  current: CurrentRecord | null
): SubmissionDecision {
  // An org tier only counts with an org behind it.
  const tier: "community" | "design-vendor" =
    input.sourceType === "design-vendor" && input.orgId ? "design-vendor" : "community";

  if (input.brandPolicy === "blocked") {
    return {
      outcome: "blocked",
      reason: "This brand maintains its own records and does not accept community submissions."
    };
  }

  // Verification outranks every source.
  if (current?.validationStatus === "manufacturer-verified") {
    return suggested("brand", "The record is manufacturer-verified; changes go to the brand as a suggestion.");
  }
  if (current?.validationStatus === "reviewed") {
    return suggested("admins", "The record has been reviewed; changes go to OpenDeviceIO as a suggestion.");
  }

  if (input.brandPolicy === "suggestions-only") {
    return suggested("brand", "This brand takes community changes as suggestions only.");
  }
  if (input.removedOnRequest) {
    return suggested("admins", "This record was taken down on request; it is not republished without review.");
  }

  if (!current) {
    if (tier === "design-vendor") return published("New record from a verified design vendor.");
    if (input.trusted) return published("New record from a trusted contributor.");
    return pending("New record from a contributor who isn't trusted yet; waiting for review.");
  }

  // The record is an unverified draft.
  const sameSubmitter = current.submittedBy !== null && current.submittedBy === input.userId;
  const sameOrg =
    tier === "design-vendor" && current.sourceOrgId !== null && current.sourceOrgId === input.orgId;
  if (sameSubmitter || sameOrg) {
    return published("An update to your own draft.");
  }

  if (SOURCE_RANK[tier] >= SOURCE_RANK[current.sourceType]) {
    if (tier === "design-vendor") {
      return published("A design vendor update to an unverified draft.");
    }
    return input.trusted
      ? published("A trusted contributor's update to an unverified draft.")
      : pending("An update from a contributor who isn't trusted yet; waiting for review.");
  }

  return suggested("admins", "The current draft comes from a higher-ranked source; this goes in as a suggestion.");
}

/**
 * What a manufacturer publish does to a record's revisions: it always replaces
 * the record, marks the previously published revision superseded, and leaves
 * open suggestions (pending / suggested) for the brand to work through.
 */
export const MANUFACTURER_PUBLISH = {
  replacesRecord: true,
  supersedeStatuses: ["published"] as const,
  keepOpenStatuses: ["pending", "suggested"] as const
};

// Auto-trust (item 6): starting numbers, for Austin to adjust.
export const AUTO_TRUST_ACCEPTED = 3;
export const AUTO_TRUST_WINDOW_DAYS = 30;

/** True when a contributor's recent record earns `trusted`. */
export function earnsTrust(acceptedInWindow: number, rejectedInWindow: number): boolean {
  return acceptedInWindow >= AUTO_TRUST_ACCEPTED && rejectedInWindow === 0;
}
