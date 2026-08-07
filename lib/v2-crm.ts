import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmOpportunity = {
  id: string;
  name: string;
  company: string;
  email: string;
  title: string;
  category: string;
  rawStatus: string;
  replied: boolean;
  lastEmailedAt: string | null;
  followUpOn: string | null;
  linkedinUrl: string | null;
  website: string | null;
  stage: string;
  nextAction: string;
  urgency: number;
  reason: string;
  daysSinceContact: number | null;
};

export async function loadCrmOpportunities(client: SupabaseClient) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("Sign in to load CRM opportunities.");
  const response = await fetch("/api/crm/opportunities", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Unable to load CRM opportunities.") as Error & { code?: string };
    error.code = data.code;
    throw error;
  }
  return data as { opportunities: CrmOpportunity[]; total: number };
}
