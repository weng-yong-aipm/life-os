// Deploy: supabase functions deploy parse-receipt
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RECEIPT_PROMPT = `You are extracting structured data from a photo of a purchase receipt.
Return ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{
  "merchant": string | null,
  "purchased_at": string | null,
  "items": [
    {
      "name": string,
      "price": number | null,
      "category": string,
      "calories": number | null,
      "protein_g": number | null,
      "carbs_g": number | null,
      "fat_g": number | null
    }
  ]
}
"purchased_at" must be YYYY-MM-DD if you can read a date on the receipt, else null.
"category" must be one of: groceries, dining, transport, other.
Calorie/macro fields are your best estimate for that line item, or null if it isn't food.
If the image isn't a legible receipt, return {"merchant": null, "purchased_at": null, "items": []}.`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  const { storagePath, mediaType } = body;
  if (!storagePath) {
    return new Response(JSON.stringify({ error: 'storagePath is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing auth' }), { status: 401, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401, headers: corsHeaders });
  }
  if (!storagePath.startsWith(`${userData.user.id}/`)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders });
  }

  const { data: fileData, error: downloadErr } = await admin.storage.from('receipts').download(storagePath);
  if (downloadErr || !fileData) {
    return new Response(JSON.stringify({ error: 'could not read image' }), { status: 404, headers: corsHeaders });
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64Image = btoa(binary);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64Image } },
            { type: 'text', text: RECEIPT_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: 'claude request failed', detail: errText }), { status: 502, headers: corsHeaders });
  }

  const claudeJson = await claudeRes.json();
  const textBlock = claudeJson.content?.find((b: { type: string }) => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text ?? '{}');
  } catch {
    return new Response(JSON.stringify({ error: 'unparseable response', raw: textBlock?.text }), { status: 502, headers: corsHeaders });
  }

  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (typeof parsed.merchant !== 'string') parsed.merchant = null;
  if (typeof parsed.purchased_at !== 'string') parsed.purchased_at = null;

  return new Response(JSON.stringify(parsed), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
});
