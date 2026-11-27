import type { SupabaseClient } from "@supabase/supabase-js";

// Integration registrations: software vendors that CONSUME registry data.
// (Manufacturers that PUBLISH data use access_requests / manufacturer_members;
// see lib/membership.ts.) Backed by public.integration_requests
// (supabase/migrations/0003_integration_requests.sql).

export interface IntegrationRequest {
  id: string;
  user_id?: string;
  email: string | null;
  company: string;
  product: string | null;
  website: string | null;
  use_case: string;
  includes_drafts: boolean;
  note: string | null;
  terms_version: string;
  status: "pending" | "approved" | "declined";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string | null;
}

export const INTEGRATION_COLUMNS =
  "id,user_id,email,company,product,website,use_case,includes_drafts,note,terms_version,status,reviewed_by,reviewed_at,created_at";

/** The signed-in user's own registrations (via RLS). */
export async function listMyIntegrationRequests(
  client: SupabaseClient
): Promise<IntegrationRequest[]> {
  const { data, error } = await client
    .from("integration_requests")
    .select(INTEGRATION_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as IntegrationRequest[];
}
