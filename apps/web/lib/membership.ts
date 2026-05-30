import type { SupabaseClient } from "@supabase/supabase-js";

// Helpers for reading a user's manufacturer memberships and access requests.
// These run under whichever client is passed (authenticated user client for
// own-row reads via RLS, or the service client for admin/token paths).

export interface Membership {
  manufacturer: string;
  role: string | null;
  created_at: string | null;
}

export interface AccessRequest {
  id: string;
  manufacturer: string;
  email: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string | null;
  user_id?: string;
}

/** Manufacturers the given user (the client's identity, via RLS) belongs to. */
export async function listMyMemberships(
  client: SupabaseClient
): Promise<Membership[]> {
  const { data, error } = await client
    .from("manufacturer_members")
    .select("manufacturer,role,created_at")
    .order("manufacturer", { ascending: true });
  if (error || !data) return [];
  return data as Membership[];
}

/** Manufacturer names for a specific user_id (service client; bypasses RLS). */
export async function membershipsForUser(
  service: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("manufacturer_members")
    .select("manufacturer")
    .eq("user_id", userId);
  if (error || !data) return [];
  return (data as Array<{ manufacturer: string }>).map((r) => r.manufacturer);
}

/** The current user's own access requests (via RLS). */
export async function listMyAccessRequests(
  client: SupabaseClient
): Promise<AccessRequest[]> {
  const { data, error } = await client
    .from("access_requests")
    .select("id,manufacturer,email,note,status,created_at")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as AccessRequest[];
}
