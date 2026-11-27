// Public "correct / remove / verify a record" requests (filed from /correct,
// handled on /admin). Backed by public.record_requests
// (supabase/migrations/0005_record_requests.sql).

export type RecordRequestType = "correction" | "removal" | "verify";
export type RecordRequestStatus = "new" | "in-progress" | "resolved" | "declined";

export interface RecordRequest {
  id: string;
  request_type: RecordRequestType;
  record_ids: string[];
  name: string;
  company: string;
  email: string;
  details: string | null;
  status: RecordRequestStatus;
  admin_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export const RECORD_REQUEST_COLUMNS =
  "id,request_type,record_ids,name,company,email,details,status,admin_note,resolved_by,resolved_at,created_at";

export const REQUEST_TYPE_LABEL: Record<RecordRequestType, string> = {
  correction: "Correction",
  removal: "Removal",
  verify: "Verify / publish"
};
