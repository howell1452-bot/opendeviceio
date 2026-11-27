import { NextResponse } from "next/server";
import {
  normalizeManufacturer,
  validateDocument,
  type OdioDocument
} from "@opendeviceio/sdk";
import { resolveCaller, touchToken } from "@/lib/server-auth";
import { membershipsForUser } from "@/lib/membership";
import { deriveRegistryRow, documentManufacturer } from "@/lib/odio-row";
import { CONTRIBUTOR_TERMS_PATH, CONTRIBUTOR_TERMS_VERSION } from "@/lib/data-license";
import {
  MAX_SUBMISSION_BYTES,
  RECORD_ID_PATTERN,
  restampAsDraft
} from "@/lib/submission-doc";
import { idPrefixErrorMessage, idPrefixProblem } from "@/lib/id-prefix";
import { decideSubmission, type BrandSubmissionPolicy } from "@/lib/conflict-rules";
import {
  insertRevision,
  loadContributor,
  loadRecordState,
  publishRevision
} from "@/lib/revisions";
import { vendorOrgsForUser } from "@/lib/orgs";

// POST /api/v1/submissions: any signed-in user submits a .odio file to the
// registry (provenance brief, item 4). Auth: cookie session (/submit,
// /author) or `Authorization: Bearer <token>`.
//
// Body (JSON syntax), either the document itself or an envelope:
//   {
//     "document": { ...the .odio document... },
//     "accept_terms": "<contributor terms version>",   // required
//     "change_note": "what changed and where it came from",  // optional, <= 2000 chars
//     "as_org": "<design-vendor org slug>",           // optional
//     "base_revision_id": "<uuid>"                     // optional
//   }
// A bare document must carry ?accept_terms=<version> in the query string.
//
// The file's provenance.validation is discarded and re-stamped as draft; the
// registry decides verification. Response:
//   { revision_id, record_id, status: "published"|"pending"|"suggested", source_type, message }
//
// 400 invalid / 401 unauthenticated / 403 suspended, blocked brand or org not
// joined / 413 too large / 429 rate limited / 503 not configured.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(status: number, message: string, details?: unknown) {
  return NextResponse.json(
    { error: message, ...(details ? { details } : {}) },
    { status }
  );
}

interface Envelope {
  document: unknown;
  accept_terms?: unknown;
  change_note?: unknown;
  as_org?: unknown;
  base_revision_id?: unknown;
}

function isEnvelope(body: unknown): body is Envelope {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    "document" in body &&
    typeof (body as Envelope).document === "object"
  );
}

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_SUBMISSION_BYTES) {
    return err(413, `The request is larger than ${MAX_SUBMISSION_BYTES / 1024} KB.`);
  }

  const resolved = await resolveCaller(req);
  if (!resolved.ok) {
    return err(
      resolved.status,
      resolved.status === 503
        ? "Submissions are not configured on this deployment (server key missing)."
        : resolved.error
    );
  }
  const { caller, service } = resolved;

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_SUBMISSION_BYTES) {
    return err(413, `The request is larger than ${MAX_SUBMISSION_BYTES / 1024} KB.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return err(400, "The request body has a JSON syntax error.");
  }

  const url = new URL(req.url);
  const env: Envelope = isEnvelope(body)
    ? body
    : { document: body, accept_terms: url.searchParams.get("accept_terms") ?? undefined };

  if (env.accept_terms !== CONTRIBUTOR_TERMS_VERSION) {
    return err(
      400,
      `Accept the contributor terms first: set "accept_terms": "${CONTRIBUTOR_TERMS_VERSION}" (see ${CONTRIBUTOR_TERMS_PATH}).`
    );
  }
  const changeNote =
    typeof env.change_note === "string" && env.change_note.trim()
      ? env.change_note.trim()
      : null;
  if (changeNote && changeNote.length > 2000) {
    return err(400, "change_note is longer than 2000 characters.");
  }

  // ---- the document ----------------------------------------------------------
  const validation = validateDocument(env.document);
  if (!validation.valid) {
    return err(
      400,
      "Document failed ODIO schema validation.",
      validation.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    );
  }
  const doc = env.document as OdioDocument;
  const rawManufacturer = documentManufacturer(doc);
  if (!rawManufacturer) return err(400, "Document does not name a manufacturer.");
  const manufacturer = normalizeManufacturer(rawManufacturer) ?? rawManufacturer;
  const id = (doc as { id?: unknown }).id;
  if (typeof id !== "string" || !RECORD_ID_PATTERN.test(id)) {
    return err(400, 'Document id must look like "manufacturer/model" (lowercase, e.g. "crestron/dm-md8x8").');
  }
  // The id's prefix must be the brand slug ("qsc/…" for QSC, never "qsys/…").
  // The database rejects anything else too (id_prefix_mismatch).
  const prefixProblem = await idPrefixProblem(service, id, manufacturer);
  if (prefixProblem) return err(400, idPrefixErrorMessage(prefixProblem));

  // ---- who is submitting -----------------------------------------------------
  const contributor = await loadContributor(service, caller.userId);
  if (contributor.suspended) {
    return err(403, "This account can no longer submit records. Contact the maintainers if you think this is a mistake.");
  }

  const brands = (await membershipsForUser(service, caller.userId)).map(
    (b) => normalizeManufacturer(b) ?? b
  );
  if (brands.includes(manufacturer)) {
    return err(
      400,
      `You're a verified publisher for ${manufacturer}. Publish it as manufacturer-verified at /publish or with POST /api/v1/devices instead.`
    );
  }

  let orgId: string | null = null;
  if (typeof env.as_org === "string" && env.as_org.trim()) {
    const orgs = await vendorOrgsForUser(service, caller.userId);
    const org = orgs.find((o) => o.slug === (env.as_org as string).trim());
    if (!org) {
      return err(403, `You're not a member of a verified design-vendor organization "${env.as_org}".`);
    }
    orgId = org.id;
  }
  const sourceType = orgId ? "design-vendor" : "community";

  // ---- the record it targets -------------------------------------------------
  const state = await loadRecordState(service, id);
  if (state.exists) {
    const existing = state.manufacturer
      ? normalizeManufacturer(state.manufacturer) ?? state.manufacturer
      : null;
    if (existing && existing !== manufacturer) {
      return err(400, `Record ${id} belongs to ${existing}, but this document names ${manufacturer}.`);
    }
  }

  let baseRevisionId = state.currentRevisionId;
  if (typeof env.base_revision_id === "string" && UUID.test(env.base_revision_id)) {
    const { data: base } = await service
      .from("record_revisions")
      .select("id")
      .eq("id", env.base_revision_id)
      .eq("record_id", id)
      .maybeSingle();
    if (base) baseRevisionId = (base as { id: string }).id;
  }

  // ---- brand controls and removals -------------------------------------------
  const [{ data: brandRow }, { data: removal }] = await Promise.all([
    service
      .from("brand_settings")
      .select("community_submissions,hidden_until_opt_in")
      .eq("manufacturer", manufacturer)
      .maybeSingle(),
    service
      .from("registry_removals")
      .select("seq")
      .eq("id", id)
      .not("reason", "is", null)
      .limit(1)
  ]);
  const brand = brandRow as {
    community_submissions: BrandSubmissionPolicy;
    hidden_until_opt_in: boolean;
  } | null;
  const removedOnRequest =
    Boolean(brand?.hidden_until_opt_in) || Boolean(removal && removal.length > 0);

  const decision = decideSubmission(
    {
      sourceType,
      userId: caller.userId,
      orgId,
      trusted: contributor.trusted,
      brandPolicy: brand?.community_submissions ?? "allowed",
      removedOnRequest
    },
    state.current
  );
  if (decision.outcome === "blocked") return err(403, decision.reason);

  // ---- re-stamp, derive, store -----------------------------------------------
  const restamped = restampAsDraft(doc);
  const recheck = validateDocument(restamped);
  if (!recheck.valid) {
    return err(400, "Document failed ODIO schema validation after re-stamping its provenance.");
  }
  const row = deriveRegistryRow(restamped, recheck.kind);
  row.validation_status = "draft";

  const inserted = await insertRevision(service, {
    record_id: id,
    document: row.document,
    manufacturer: row.manufacturer,
    source_type: sourceType,
    source_org_id: orgId,
    submitted_by: caller.userId,
    // An auto-published revision is inserted pending and flipped by publishRevision.
    status: decision.outcome === "published" ? "pending" : decision.outcome,
    base_revision_id: baseRevisionId,
    is_new_record: !state.exists,
    change_note: changeNote,
    terms_version: CONTRIBUTOR_TERMS_VERSION
  });
  if (!inserted.ok) return err(inserted.status, inserted.error);

  if (decision.outcome === "published") {
    const { error: pubErr } = await publishRevision(service, {
      revisionId: inserted.id,
      row,
      sourceType,
      sourceOrgId: orgId
    });
    if (pubErr) return err(500, `Saving the record failed: ${pubErr}`);
  }

  await touchToken(service, caller);

  return NextResponse.json(
    {
      revision_id: inserted.id,
      record_id: id,
      status: decision.outcome,
      source_type: sourceType,
      message: decision.reason
    },
    { status: 201 }
  );
}
