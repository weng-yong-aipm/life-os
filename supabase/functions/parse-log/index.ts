// Deploy: supabase functions deploy parse-log
// Secrets: reuses ANTHROPIC_API_KEY (already set for parse-receipt / estimate-meal)
//
// One sentence in, candidate rows out. This function deliberately does NOT
// write to the database: it returns what the model understood, and the client
// normalises it with log/parse-log.js before inserting. That split is the whole
// safety story — the code that decides what reaches six weeks of history is
// pure, unit-tested, and runs where it can be read, rather than inside a
// deployed function nobody exercises.
//
// The prompt lives here rather than in the client on purpose: if the caller
// supplied it, anyone holding a session could spend the owner's Anthropic key
// on arbitrary text.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 2000;

function promptFor(today: string) {
  return `You turn one or two sentences of a personal daily log into structured rows.

Today is ${today} (ISO date, the user's local day).

Return ONLY strict minified JSON, no markdown fences and no commentary, shaped:
{"rows":[...],"unparsed":[...]}

Each element of "rows" is exactly one of these shapes:
{"kind":"meal","on":"YYYY-MM-DD","name":string,"calories":number|null,"protein_g":number|null,"carbs_g":number|null,"fat_g":number|null}
{"kind":"sleep","on":"YYYY-MM-DD","duration_min":number|null,"quality":1|2|3|4|5|null,"note":string|null}
{"kind":"expense","on":"YYYY-MM-DD","amount":number,"category":string,"note":string|null}
{"kind":"learning","on":"YYYY-MM-DD","title":string,"source":string,"link":string|null}

Rules:
- "on" is the date the thing happened, resolved against today. "yesterday" is the day before ${today}. Default to ${today}.
- For sleep, "on" is the date the user WOKE UP: a 23:00-07:00 night belongs to the morning.
- Estimate meal calories and macros when the dish is recognisable; use null when you genuinely cannot.
- expense "category" is one of: food, transport, grocery, bills, health, shopping, other.
- learning "source" is one of: douyin, instagram, youtube, book, article, other.
- Split a sentence covering several things into several rows.
- Put any part of the input you could NOT turn into a row into "unparsed", in the user's original wording. Never invent a row to avoid leaving something unparsed, and never drop text silently.
- The text may be in English or Chinese. Write "name", "note" and "title" in the language the user used.`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let body: { text?: string; today?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const text = (body.text || '').trim();
  const today = body.today || '';
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > MAX_TEXT) return json({ error: `text is longer than ${MAX_TEXT} characters` }, 400);
  // The client's own day, not the function's: this runs in UTC and Weng is in
  // MYT, so for eight hours every night the server's "today" is yesterday.
  if (!ISO_DAY.test(today)) return json({ error: 'today must be an ISO date (YYYY-MM-DD)' }, 400);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing auth' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'invalid session' }, 401);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        // Extraction against a fixed schema does not need deliberation, and
        // thinking blocks cost tokens and arrive BEFORE the answer.
        thinking: { type: 'disabled' },
        system: promptFor(today),
        messages: [{ role: 'user', content: text }],
      }),
    });
  } catch (err) {
    return json({ error: 'could not reach Anthropic', detail: String(err) }, 502);
  }

  // supabase-js flattens every non-2xx into one unreadable sentence on the
  // client, so the reason has to travel in the BODY to be visible at all. The
  // meal-photo path lost an hour to exactly this: "no key", "not food" and
  // "Anthropic is down" all looked identical from the phone.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: `Anthropic returned ${res.status}`, detail: detail.slice(0, 600) }, 502);
  }

  const payload = await res.json();

  /* Take the first TEXT block, not the first block.
   *
   * Found by calling this live: with thinking on, content[0] was a `thinking`
   * block whose .text is empty, so reading content[0].text returned "" and this
   * function answered 200 with nothing in it — the model had in fact parsed the
   * sentence perfectly. Thinking is disabled above, but the indexing bug is the
   * real defect and it is fixed here, because a future model that emits any
   * other leading block type would resurrect it. */
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const raw = blocks.find((b: { type?: string; text?: string }) => b?.type === 'text' && b?.text?.trim())?.text ?? '';

  /* An empty answer is a failure, not an empty success. Returning 200 with
   * raw:"" is precisely the shape this project keeps getting burned by, and it
   * would surface on the phone as "nothing understood" with no way to tell a
   * broken function from a genuinely unreadable sentence. */
  if (!raw) {
    return json({
      error: 'the model returned no text',
      detail: `stop_reason=${payload?.stop_reason ?? 'unknown'} blocks=${blocks.map((b: { type?: string }) => b?.type).join(',') || 'none'}`,
    }, 502);
  }

  // Handed back verbatim. The client parses it with the tested module; if the
  // model wandered off JSON, that module reports it as an error rather than as
  // an empty success.
  return json({ raw, model: payload?.model ?? null });
});
