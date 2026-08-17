/* One sentence in, rows out.
 *
 * Why this module exists at all: every table a human was supposed to fill is
 * empty, and the reason is not the schema — it is that logging a meal costs
 * "open the app, sign in, pick a module, fill a form". Four steps for one line
 * of data. This path removes the middle two: type what happened, press once.
 *
 * The network half (asking Claude) lives in the edge function. Everything here
 * is pure so the part that decides what reaches the database can be tested
 * without a key, which is also the part that would quietly corrupt six weeks of
 * history if it were wrong.
 */

export const KINDS = ["meal", "sleep", "expense", "learning"];

/* The prompt is NOT here. It lives in supabase/functions/parse-log/index.ts,
 * because a prompt the client supplies is a prompt anyone with a session can
 * point at the owner's Anthropic key. One copy, server side.
 *
 * What stays here is everything that decides what actually reaches the tables. */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* A date the model invented, or omitted, must not become "now" silently — a row
 * filed on the wrong day is worse than a row that was refused, because nothing
 * downstream can tell it was guessed. Anything unusable falls back to today and
 * is reported, so the preview can show which date was assumed. */
function day(v, today) {
  const s = str(v);
  return s && ISO_DAY.test(s) ? s : today;
}

const CATEGORIES = ["food", "transport", "grocery", "bills", "health", "shopping", "other"];
const SOURCES = ["douyin", "instagram", "youtube", "book", "article", "other"];

function normaliseRow(raw, today) {
  if (!raw || typeof raw !== "object") return null;
  const on = day(raw.on, today);
  const assumedDate = day(raw.on, today) === today && !ISO_DAY.test(String(raw.on || ""));

  switch (raw.kind) {
    case "meal": {
      const name = str(raw.name);
      if (!name) return null; // a meal with no dish is not a meal
      return {
        kind: "meal", on, assumedDate, name,
        calories: num(raw.calories), protein_g: num(raw.protein_g),
        carbs_g: num(raw.carbs_g), fat_g: num(raw.fat_g),
      };
    }
    case "sleep": {
      const q = num(raw.quality);
      return {
        kind: "sleep", on, assumedDate,
        duration_min: num(raw.duration_min),
        // The column has a 1..5 check constraint; sending 0 or 9 would fail the
        // insert for the whole batch, so an out-of-range score becomes "unknown"
        // rather than taking the other rows down with it.
        quality: q != null && q >= 1 && q <= 5 ? Math.round(q) : null,
        note: str(raw.note),
      };
    }
    case "expense": {
      const amount = num(raw.amount);
      if (amount == null || amount <= 0) return null; // an expense with no money is not one
      const category = str(raw.category)?.toLowerCase();
      return {
        kind: "expense", on, assumedDate, amount,
        category: CATEGORIES.includes(category) ? category : "other",
        note: str(raw.note),
      };
    }
    case "learning": {
      const title = str(raw.title);
      if (!title) return null;
      const source = str(raw.source)?.toLowerCase();
      return {
        kind: "learning", on, assumedDate, title,
        source: SOURCES.includes(source) ? source : "other",
        link: str(raw.link),
      };
    }
    default:
      return null;
  }
}

/* Anything the model returned that we refused becomes `dropped`, and anything
 * it admitted it could not read stays in `unparsed`. Both are shown. The whole
 * failure mode this project keeps hitting is a green result over work that did
 * not happen, and "your sentence produced nothing, but here is a tick" is
 * exactly that shape. */
export function parseResult(raw, today) {
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return { rows: [], unparsed: [], dropped: [], error: "model did not return JSON" }; }
  }
  if (!obj || typeof obj !== "object") return { rows: [], unparsed: [], dropped: [], error: "model did not return an object" };

  const incoming = Array.isArray(obj.rows) ? obj.rows : [];
  const rows = [];
  const dropped = [];
  for (const r of incoming) {
    const ok = normaliseRow(r, today);
    if (ok) rows.push(ok);
    else dropped.push(r);
  }
  const unparsed = (Array.isArray(obj.unparsed) ? obj.unparsed : []).map(str).filter(Boolean);
  return { rows, unparsed, dropped, error: null };
}

/* The preview line. Deliberately counts by kind rather than listing every row:
 * the point of the screen is to confirm "it understood me" in one glance, not
 * to become another form to read. */
export function summarize({ rows = [], unparsed = [], dropped = [] } = {}) {
  const by = {};
  for (const r of rows) by[r.kind] = (by[r.kind] || 0) + 1;
  const parts = KINDS.filter((k) => by[k]).map((k) => `${by[k]} ${k}${by[k] > 1 ? "s" : ""}`);
  const head = parts.length ? parts.join(", ") : "nothing";
  const tail = [];
  if (unparsed.length) tail.push(`${unparsed.length} not understood`);
  if (dropped.length) tail.push(`${dropped.length} incomplete`);
  return tail.length ? `${head} — ${tail.join(", ")}` : head;
}

/* Rows → the exact insert payload per table. Kept here, next to the parsing,
 * so a column rename breaks one file and one test rather than surfacing as a
 * silent 400 on the phone at the moment of use. */
export function toInserts(rows, userId) {
  const out = { meals: [], sleep: [], expenses: [], learning_sessions: [] };
  for (const r of rows) {
    if (r.kind === "meal") {
      out.meals.push({
        user_id: userId, eaten_at: r.on, name: r.name, source: "quick-log",
        calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
      });
    } else if (r.kind === "sleep") {
      out.sleep.push({
        user_id: userId, slept_on: r.on, duration_min: r.duration_min,
        quality: r.quality, note: r.note, source: "quick-log",
      });
    } else if (r.kind === "expense") {
      out.expenses.push({
        user_id: userId, spent_at: r.on, amount: r.amount, category: r.category, note: r.note,
      });
    } else if (r.kind === "learning") {
      out.learning_sessions.push({
        user_id: userId, learned_on: r.on, title: r.title, source: r.source,
        link: r.link, verdict: "considering",
      });
    }
  }
  return out;
}
