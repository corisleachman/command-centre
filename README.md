# Life Command Centre

A calm, visual personal operating system that converts long-term plans into three focused daily actions.

## Local development

```bash
npm install
npm run dev
```

The first release stores progress in the browser so it works immediately. The Supabase schema is available at `supabase/schema.sql`. Add the project URL and anon key from `.env.example` when connecting authentication and cloud persistence.

## GitHub Pages

The repository includes a Pages deployment workflow. In repository settings, set **Pages > Build and deployment > Source** to **GitHub Actions**.

The site will deploy to:

`https://corisleachman.github.io/command-centre/`

To pass Supabase configuration into the build:

1. Add repository variable `SUPABASE_URL`.
2. Add repository secret `SUPABASE_ANON_KEY`.

The Supabase anon key is designed for browser use when Row Level Security is enabled. Never add the service-role key.

## Product specification

See `life-command-centre-build-brief.md` for the complete roadmap and acceptance criteria.
