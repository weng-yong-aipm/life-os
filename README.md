# life-os

Personal life dashboard. Vanilla HTML/CSS/JS, no build step, installable PWA.
Currently live: the **Finance** module (receipt scanning + nutrition/spend
tracking, OT pay calculator). Other modules (career, learning, invest,
health) are planned but not built yet.

## Setup

1. Create a new Supabase project (separate from any other personal project).
2. Project Settings -> API: copy the Project URL and `anon` key into `config.js`.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`.
4. Supabase SQL Editor: run `supabase/schema.sql`.
5. Install the Supabase CLI (`brew install supabase/tap/supabase`), `supabase login`,
   `supabase link --project-ref <ref>`.
6. `supabase secrets set ANTHROPIC_API_KEY=<your key>`
7. `supabase functions deploy parse-receipt`
8. Serve locally: `python3 -m http.server 8080`, open `http://localhost:8080`.

## Tests

`npm test` runs the pure-logic unit tests (pay calculation, day classification,
holiday lookup). UI flows (receipt scan, OT pay entry) are verified manually
against the running app — see the plan doc for the exact checklist.

## Updating Malaysia public holidays

`finance/malaysia-holidays.js` is a static list, not a live API (Malaysia isn't
covered by the free public-holiday APIs checked during planning). Add a new
`MALAYSIA_HOLIDAYS_<year>` array every December and spread it into `ALL_HOLIDAYS`.
