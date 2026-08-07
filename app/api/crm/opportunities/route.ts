import { NextRequest, NextResponse } from "next/server";

const COMMAND_CENTRE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const COMMAND_CENTRE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROSPECTS_URL = process.env.PROSPECTS_SUPABASE_URL || "https://paprxejgeepvtbqmfgvt.supabase.co";
const PROSPECTS_SERVICE_ROLE = process.env.PROSPECTS_SUPABASE_SERVICE_ROLE_KEY;

type Contact = Record<string, unknown> & {
  id?: string;
  name?: string;
  company?: string;
  email?: string;
  title?: string;
  category?: string;
  status?: string;
  replied?: boolean;
  bounced?: boolean;
  last_emailed_at?: string | null;
  follow_up_at?: string | null;
  linkedin_url?: string | null;
  website?: string | null;
  updated_at?: string | null;
};

function dayDiff(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function dateOnly(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function infer(contact: Contact) {
  const today = new Date().toISOString().slice(0, 10);
  const followUp = dateOnly(contact.follow_up_at);
  const days = dayDiff(contact.last_emailed_at);
  const raw = String(contact.status || "");
  const lower = raw.toLowerCase();

  if (contact.bounced || lower === "bounced") return null;
  if (/closed|lost|not pursuing|do not contact|dead/i.test(raw)) return null;

  let stage = "Active";
  let nextAction = "Review relationship and choose the next commercial action";
  let urgency = 1;
  let reason = raw || "Active prospect";

  if (contact.replied) {
    stage = "Engaged";
    nextAction = "Open the conversation and progress the opportunity";
    urgency = 5;
    reason = "They have replied";
  } else if (followUp && followUp < today) {
    stage = "Follow-up due";
    nextAction = "Follow up now";
    urgency = 5;
    reason = `Follow-up was due ${followUp}`;
  } else if (followUp === today) {
    stage = "Follow-up due";
    nextAction = "Follow up today";
    urgency = 5;
    reason = "Follow-up is due today";
  } else if (followUp) {
    stage = "Waiting on them";
    nextAction = `Follow up on ${followUp}`;
    urgency = 3;
    reason = "A follow-up is scheduled";
  } else if (lower === "contacted" || contact.last_emailed_at) {
    stage = "Waiting on them";
    if (days != null && days >= 4) {
      nextAction = "Send a chaser";
      urgency = 4;
      reason = `${days} days since last contact with no reply`;
    } else {
      nextAction = "Monitor for reply";
      urgency = 2;
      reason = days == null ? "Contacted" : `${days} day${days === 1 ? "" : "s"} since last contact`;
    }
  } else {
    return null;
  }

  return { stage, nextAction, urgency, reason, daysSinceContact: days, followUpOn: followUp };
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !COMMAND_CENTRE_URL || !COMMAND_CENTRE_ANON) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const userResponse = await fetch(`${COMMAND_CENTRE_URL}/auth/v1/user`, {
    headers: { apikey: COMMAND_CENTRE_ANON, Authorization: authorization },
    cache: "no-store",
  });
  if (!userResponse.ok) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  if (!PROSPECTS_SERVICE_ROLE) {
    return NextResponse.json({
      error: "CRM adapter is ready but the Prospects database credential has not been connected yet.",
      code: "crm_not_configured",
    }, { status: 503 });
  }

  const response = await fetch(`${PROSPECTS_URL}/rest/v1/contacts?select=*&order=updated_at.desc&limit=500`, {
    headers: {
      apikey: PROSPECTS_SERVICE_ROLE,
      Authorization: `Bearer ${PROSPECTS_SERVICE_ROLE}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return NextResponse.json({ error: `Prospects CRM request failed (${response.status}).` }, { status: 502 });
  }

  const contacts = await response.json() as Contact[];
  const opportunities = contacts.flatMap(contact => {
    const inferred = infer(contact);
    if (!inferred) return [];
    return [{
      id: String(contact.id || ""),
      name: String(contact.name || "Unknown contact"),
      company: String(contact.company || ""),
      email: String(contact.email || ""),
      title: String(contact.title || ""),
      category: String(contact.category || ""),
      rawStatus: String(contact.status || ""),
      replied: Boolean(contact.replied),
      lastEmailedAt: contact.last_emailed_at || null,
      linkedinUrl: contact.linkedin_url || null,
      website: contact.website || null,
      ...inferred,
    }];
  }).sort((a, b) => b.urgency - a.urgency || (a.followUpOn || "9999").localeCompare(b.followUpOn || "9999"));

  return NextResponse.json({ opportunities, total: opportunities.length });
}
