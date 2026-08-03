/* Books module — a curated reading library for the FDE + AI-PM path, mapped into
 * learning_sessions (source='book') so it tracks + shows alongside other learning.
 * Pure data + a deterministic mapper (no I/O), mirroring douyin-import.js.
 *
 * Triage the `verdict` in the Learning UI: considering → applied/reviewed as you read. */

const SOURCE = 'book';

export const BOOKS = [
  // Habits / Productivity
  { title: 'Atomic Habits', author: 'James Clear', category: 'habits', why: 'The system for compounding 1% daily improvements.' },
  { title: 'Deep Work', author: 'Cal Newport', category: 'habits', why: 'Protect focus as your scarcest, highest-leverage asset.' },
  { title: 'Getting Things Done', author: 'David Allen', category: 'habits', why: 'Canonical stress-free capture + task system.' },
  { title: "So Good They Can't Ignore You", author: 'Cal Newport', category: 'habits', why: 'Build rare, valuable career capital over "passion".' },
  { title: 'The 7 Habits of Highly Effective People', author: 'Stephen R. Covey', category: 'habits', why: 'Timeless principles for proactive effectiveness.' },
  // Product / Business / Strategy
  { title: 'Inspired', author: 'Marty Cagan', category: 'product', why: 'How great product teams actually work — the PM bible.' },
  { title: 'Empowered', author: 'Marty Cagan & Chris Jones', category: 'product', why: 'Leading + coaching product teams (the sequel).' },
  { title: 'The Lean Startup', author: 'Eric Ries', category: 'product', why: 'Build-measure-learn + MVP thinking.' },
  { title: 'Hooked', author: 'Nir Eyal', category: 'product', why: 'How habit-forming product loops are engineered.' },
  { title: 'Crossing the Chasm', author: 'Geoffrey Moore', category: 'product', why: 'Taking tech from early adopters to the mainstream.' },
  { title: 'Good Strategy Bad Strategy', author: 'Richard Rumelt', category: 'strategy', why: 'Diagnosis + coherent action vs strategic fluff.' },
  { title: 'Zero to One', author: 'Peter Thiel', category: 'strategy', why: 'Contrarian 0→1 monopoly-building thinking.' },
  { title: "The Innovator's Dilemma", author: 'Clayton Christensen', category: 'strategy', why: 'Why great companies get disrupted.' },
  { title: 'Competing Against Luck', author: 'Clayton Christensen', category: 'product', why: 'Jobs-to-be-Done: why customers "hire" a product.' },
  { title: 'Measure What Matters', author: 'John Doerr', category: 'strategy', why: 'OKRs — the tech goal-setting operating system.' },
  { title: 'The Hard Thing About Hard Things', author: 'Ben Horowitz', category: 'leadership', why: 'Honest operating wisdom for building/running companies.' },
  // AI / Engineering
  { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', category: 'engineering', why: 'The systems behind scalable, reliable backends.' },
  { title: 'The Pragmatic Programmer', author: 'Hunt & Thomas', category: 'engineering', why: 'Career-long software craft principles.' },
  { title: 'Designing Machine Learning Systems', author: 'Chip Huyen', category: 'ai', why: 'Production ML end-to-end — the FDE/AI-PM bridge.' },
  { title: 'AI Engineering', author: 'Chip Huyen', category: 'ai', why: 'Building on foundation models — the current playbook.' },
  { title: 'Hands-On Machine Learning', author: 'Aurélien Géron', category: 'ai', why: 'Practical, code-first ML/DL foundations.' },
  // Investing / Money
  { title: 'The Psychology of Money', author: 'Morgan Housel', category: 'investing', why: 'Behavior, not spreadsheets, drives outcomes.' },
  { title: 'The Intelligent Investor', author: 'Benjamin Graham', category: 'investing', why: 'Value investing + margin of safety classic.' },
  { title: 'A Random Walk Down Wall Street', author: 'Burton Malkiel', category: 'investing', why: 'The case for index investing.' },
  { title: 'The Almanack of Naval Ravikant', author: 'Eric Jorgenson', category: 'investing', why: 'Leverage, wealth, and judgment distilled.' },
  { title: "Poor Charlie's Almanack", author: 'Charlie Munger', category: 'investing', why: 'Multidisciplinary mental models.' },
  // Thinking / Influence
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', category: 'thinking', why: 'Foundational text on cognitive biases.' },
  { title: 'Influence', author: 'Robert Cialdini', category: 'thinking', why: 'The six levers of persuasion — vital for PMs.' },
  { title: 'Never Split the Difference', author: 'Chris Voss', category: 'thinking', why: 'Tactical high-stakes negotiation.' },
  // Career / Leadership
  { title: "The Manager's Path", author: 'Camille Fournier', category: 'leadership', why: 'The clearest engineering-leadership ladder guide.' },
  { title: 'Staff Engineer', author: 'Will Larson', category: 'leadership', why: 'Growing beyond senior into technical leadership.' },
  { title: 'Radical Candor', author: 'Kim Scott', category: 'leadership', why: 'Care personally, challenge directly.' },
  { title: 'Extreme Ownership', author: 'Willink & Babin', category: 'leadership', why: 'Leadership through total accountability.' },
];

/* title → stable slug used as external_id (dedup key with user_id, source). */
export function bookSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* Map books → learning_sessions insert rows. Deterministic (no dates set here;
 * synced_at/learned_on are stamped at write time), matching douyin-import.js. */
export function toLearningRows(books, userId) {
  if (!Array.isArray(books)) return [];
  return books
    .filter((b) => b && b.title)
    .map((b) => ({
      external_id: bookSlug(b.title),
      source: SOURCE,
      user_id: userId,
      title: b.author ? `${b.title} — ${b.author}` : b.title,
      summary: b.why || null,
      link: `https://www.goodreads.com/search?q=${encodeURIComponent(`${b.title} ${b.author || ''}`.trim())}`,
      verdict: 'considering',
      tags: b.category ? [b.category] : null,
    }));
}
