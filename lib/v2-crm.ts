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
  const { data, error } = await client.functions.invoke("crm-api", { body: { action: "activeOpportunities" } });
  if (error) {
    const context = (error as unknown as { context?: Response }).context;
    if (context?.status === 503) {
      const detail = await context.clone().json().catch(() => ({}));
      if (detail?.code === "crm_not_configured") {
        const missing = new Error(detail.error) as Error & { code?: string };
        missing.code = detail.code;
        throw missing;
      }
    }
    throw error;
  }
  if (data?.error) {
    const detail = new Error(data.error) as Error & { code?: string };
    detail.code = data.code;
    throw detail;
  }
  return data as { opportunities: CrmOpportunity[]; total: number };
}
