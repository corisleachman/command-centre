# Planner tasks edge function

This Supabase Edge Function exposes a minimal, read-only view of the signed-in owner's Command Centre state for calendar planning.

It reads `command_centre_state.state`, which is where the current app stores tasks, notes, links and ideas.

## Required secrets

Set these in the Supabase project before deploying:

```bash
supabase secrets set PLANNER_ACCESS_TOKEN="generate-a-long-random-value"
supabase secrets set PLANNER_USER_ID="the-auth-user-uuid"
supabase secrets set PLANNER_ALLOWED_ORIGIN="https://corisleachman.github.io"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically to deployed Edge Functions by Supabase.

Never put `PLANNER_ACCESS_TOKEN` or the service-role key in the GitHub Pages frontend, repository variables or client-side code.

## Deploy

```bash
supabase functions deploy planner-tasks --no-verify-jwt
```

The function performs its own bearer-token check because it is intended for a narrowly scoped planner integration rather than a browser user's Supabase JWT.

## Request

```bash
curl \
  -H "Authorization: Bearer $PLANNER_ACCESS_TOKEN" \
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/planner-tasks"
```

## Response shape

```json
{
  "generated_at": "2026-08-02T17:00:00.000Z",
  "source_updated_at": "2026-08-02T16:58:00.000Z",
  "active_tasks": [
    {
      "id": 7,
      "title": "Define the Song Room founding-member offer",
      "category": "build",
      "priority": "normal",
      "points": 2,
      "status": "next",
      "is_complete": false,
      "is_today": false,
      "week_number": 1,
      "estimated_minutes": 30,
      "notes": null,
      "links": []
    }
  ],
  "completed_tasks": [],
  "ideas": []
}
```

## Security notes

- The endpoint is read-only.
- It returns only one configured user's state.
- Responses are marked `no-store`.
- The service-role key stays inside Supabase.
- Rotate `PLANNER_ACCESS_TOKEN` immediately if it is exposed.
