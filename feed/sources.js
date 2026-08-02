import { PEOPLE } from './people.js';

/* Curated follow-list for the Feed module — the "top AI creators per platform"
 * the ingest script pulls from. Pure data, no I/O.
 *
 * Ranked best-first for an FDE + AI-PM target (not by raw follower count).
 * Sourced from the 2026 learning-os research pass; handles/URLs verified at
 * time of writing — re-verify before trusting a stale one.
 *
 * `channel` maps each platform to its agent-reach channel (see PLATFORMS).
 * The ingest script only pulls platforms whose PLATFORMS[...].ready === true;
 * the rest need a one-time `agent-reach install --channels opencli` + Chrome
 * login (or the Douyin CDP extractor) before they light up. */

/* Platform → agent-reach backend + readiness (from `agent-reach doctor`). */
export const PLATFORMS = {
  youtube:   { label: 'YouTube',        channel: 'youtube',     ready: true,  note: 'yt-dlp: video info + transcripts (long-form supported).' },
  bilibili:  { label: 'Bilibili / B站',  channel: 'bilibili',    ready: false, note: 'direct curl is risk-controlled (returns anti-bot HTML); needs bili-cli login or opencli.' },
  reddit:    { label: 'Reddit',         channel: 'reddit',      ready: false, note: 'agent-reach install --channels opencli + login reddit.com.' },
  rss:       { label: 'RSS / blogs',    channel: 'rss',         ready: true,  note: 'feedparser; use for newsletters (Simon Willison, Interconnects…).' },
  x:         { label: 'X / Twitter',    channel: 'twitter',     ready: false, note: 'opencli + login x.com, or paid X API v2 bearer.' },
  instagram: { label: 'Instagram/Threads', channel: 'instagram', ready: false, note: 'opencli + login instagram.com; no public read API.' },
  douyin:    { label: '抖音 / Douyin',   channel: 'douyin-cdp',  ready: false, note: 'no agent-reach channel; use Chrome CDP :9222 DOM extractor.' },
  xiaohongshu: { label: '小红书 / RED',  channel: 'xiaohongshu', ready: false, note: 'opencli + login, or xiaohongshu-mcp.' },
  threads:   { label: 'Threads',        channel: 'browser',     ready: false, note: 'no public read API; browser-scrape logged-in threads.net (best-effort, needs Chrome — not yet wired).' },
  github:    { label: 'GitHub',         channel: 'rss',         ready: true,  note: 'per-user public activity via github.com/<user>.atom — fetched like RSS, no auth.' },
};

/* Each source: platform key, rank (within platform), name, handle, url, focus.
 * A `feed` URL (RSS/Atom) is added where the strongest signal is a newsletter. */
export const SOURCES = [
  // ---------- X / Twitter (top 20) ----------
  { platform: 'x', rank: 1,  name: 'Andrej Karpathy',   handle: '@karpathy',        url: 'https://x.com/karpathy',        focus: 'First-principles LLM/agent education (ex-OpenAI, ex-Tesla).' },
  { platform: 'x', rank: 2,  name: 'Shawn Wang (swyx)', handle: '@swyx',            url: 'https://x.com/swyx',            focus: 'Coined "AI Engineer"; the FDE/AI-eng career itself.' },
  { platform: 'x', rank: 3,  name: 'Simon Willison',    handle: '@simonw',          url: 'https://x.com/simonw',          focus: 'What changed this week and does it actually work.' },
  { platform: 'x', rank: 4,  name: 'Jim Fan',           handle: '@DrJimFan',        url: 'https://x.com/DrJimFan',        focus: 'NVIDIA; agents + embodied AI, frontier research explained.' },
  { platform: 'x', rank: 5,  name: 'Greg Brockman',     handle: '@gdb',             url: 'https://x.com/gdb',             focus: 'OpenAI president; infra, Codex/agent roadmap.' },
  { platform: 'x', rank: 6,  name: 'Sam Altman',        handle: '@sama',            url: 'https://x.com/sama',            focus: 'OpenAI strategy/product timing; market signal.' },
  { platform: 'x', rank: 7,  name: 'Demis Hassabis',    handle: '@demishassabis',   url: 'https://x.com/demishassabis',   focus: 'Google DeepMind; Gemini, AI-for-science.' },
  { platform: 'x', rank: 8,  name: 'Harrison Chase',    handle: '@hwchase17',       url: 'https://x.com/hwchase17',       focus: 'LangChain/LangGraph; production agent patterns.' },
  { platform: 'x', rank: 9,  name: 'Andrew Ng',         handle: '@AndrewYNg',       url: 'https://x.com/AndrewYNg',       focus: 'Agentic workflows; credible structured education.' },
  { platform: 'x', rank: 10, name: 'Aravind Srinivas',  handle: '@AravSrinivas',    url: 'https://x.com/AravSrinivas',    focus: 'Perplexity CEO; AI PM in public, RAG at scale.' },
  { platform: 'x', rank: 11, name: 'Jerry Liu',         handle: '@jerryjliu0',      url: 'https://x.com/jerryjliu0',      focus: 'LlamaIndex; RAG/agents over enterprise data.' },
  { platform: 'x', rank: 12, name: 'Noam Brown',        handle: '@polynoamial',     url: 'https://x.com/polynoamial',     focus: 'Reasoning models (o1); capabilities + limits.' },
  { platform: 'x', rank: 13, name: 'Jason Wei',         handle: '@_jasonwei',       url: 'https://x.com/_jasonwei',       focus: 'CoT, evals, "what scales"; agent-design mental models.' },
  { platform: 'x', rank: 14, name: 'Logan Kilpatrick',  handle: '@OfficialLoganK',  url: 'https://x.com/OfficialLoganK',  focus: 'Google AI Studio / Gemini API changelog.' },
  { platform: 'x', rank: 15, name: 'Lilian Weng',       handle: '@lilianweng',      url: 'https://x.com/lilianweng',      focus: 'Lil\'Log deep-dives (agents, hallucination, RL).' },
  { platform: 'x', rank: 16, name: 'Cameron Wolfe',     handle: '@cwolferesearch',  url: 'https://x.com/cwolferesearch',  focus: 'Digestible paper breakdowns.' },
  { platform: 'x', rank: 17, name: 'François Chollet',  handle: '@fchollet',        url: 'https://x.com/fchollet',        focus: 'Keras/ARC-AGI; sharp skeptic of pure scaling.' },
  { platform: 'x', rank: 18, name: 'Yann LeCun',        handle: '@ylecun',          url: 'https://x.com/ylecun',          focus: 'Open models, world-models; contrarian long view.' },
  { platform: 'x', rank: 19, name: 'Santiago Valdarrama', handle: '@svpino',        url: 'https://x.com/svpino',          focus: 'Production ML/AI, system-design reps.' },
  { platform: 'x', rank: 20, name: 'Anthropic',         handle: '@AnthropicAI',     url: 'https://x.com/AnthropicAI',     focus: 'Primary-source Claude/MCP/agent changelog.' },

  // ---------- YouTube (top 20; incl. long-form/lecture) ----------
  { platform: 'youtube', rank: 1,  name: 'Andrej Karpathy',     handle: '@AndrejKarpathy', url: 'https://www.youtube.com/@AndrejKarpathy', focus: 'Neural Nets Zero-to-Hero; build GPT from scratch (long-form).' },
  { platform: 'youtube', rank: 2,  name: 'AI Engineer',         handle: '@aiDotEngineer',  url: 'https://www.youtube.com/@aiDotEngineer',  focus: 'Full conference talks: production RAG/agents/evals/MCP (long-form).' },
  { platform: 'youtube', rank: 3,  name: 'IndyDevDan',          handle: '@indydevdan',     url: 'https://www.youtube.com/@indydevdan',     focus: 'Agentic coding, Claude Code/MCP, spec-driven dev.' },
  { platform: 'youtube', rank: 4,  name: 'Cole Medin',          handle: '@ColeMedin',      url: 'https://www.youtube.com/@ColeMedin',      focus: 'Production AI agents end-to-end; context engineering + RAG.' },
  { platform: 'youtube', rank: 5,  name: 'LangChain',           handle: '@LangChain',      url: 'https://www.youtube.com/@LangChain',      focus: 'Official LangChain/LangGraph patterns + evals.' },
  { platform: 'youtube', rank: 6,  name: 'Stanford Online',     handle: '@stanfordonline', url: 'https://www.youtube.com/@stanfordonline',  focus: 'CS25 Transformers United, CS336 LM-from-scratch (long-form lectures).' },
  { platform: 'youtube', rank: 7,  name: 'AI Jason (Zhou)',     handle: '@AIJasonZ',       url: 'https://www.youtube.com/@AIJasonZ',       focus: 'App-layer agent engineering with a PM eye (FDE↔PM seam).' },
  { platform: 'youtube', rank: 8,  name: 'Sam Witteveen',       handle: '@samwitteveenai', url: 'https://www.youtube.com/@samwitteveenai',  focus: 'Multi-provider LLM/agent tutorials; function calling, fine-tuning.' },
  { platform: 'youtube', rank: 9,  name: 'Umar Jamil',          handle: '@umarjamilai',    url: 'https://www.youtube.com/channel/UCtAcpQcYerN8xxZJYTfWBMw', focus: 'From-scratch Transformer/RLHF/quantization (long-form).' },
  { platform: 'youtube', rank: 10, name: 'Mervin Praison',      handle: '@MervinPraison',  url: 'https://www.youtube.com/user/mervinpraison', focus: 'Same agent across CrewAI/AutoGen/LangGraph — framework map.' },
  { platform: 'youtube', rank: 11, name: 'DeepLearning.AI',     handle: '@Deeplearningai', url: 'https://www.youtube.com/@Deeplearningai',  focus: 'Ng org; RAG/agents/MLOps, vendor-neutral, strategy+eng.' },
  { platform: 'youtube', rank: 12, name: 'AssemblyAI',          handle: '@AssemblyAI',     url: 'https://www.youtube.com/@AssemblyAI',     focus: 'Voice agents, real-time STT, rigorous eval methodology.' },
  { platform: 'youtube', rank: 13, name: 'Yannic Kilcher',      handle: '@YannicKilcher',  url: 'https://www.youtube.com/@YannicKilcher',  focus: 'Rigorous paper deep-dives (long-form).' },
  { platform: 'youtube', rank: 14, name: '3Blue1Brown',         handle: '@3blue1brown',    url: 'https://www.youtube.com/@3blue1brown',    focus: 'Visual intuition for NN/attention math.' },
  { platform: 'youtube', rank: 15, name: 'Two Minute Papers',   handle: '@TwoMinutePapers', url: 'https://www.youtube.com/@TwoMinutePapers', focus: 'Fast broad radar on new research/model releases.' },
  { platform: 'youtube', rank: 16, name: 'IBM Technology',      handle: '@IBMTechnology',  url: 'https://www.youtube.com/@IBMTechnology',  focus: 'Whiteboard explainers (RAG vs FT, agents, MCP) — translator vocab.' },
  { platform: 'youtube', rank: 17, name: 'Matthew Berman',      handle: '@matthew_berman', url: 'https://www.youtube.com/@matthew_berman', focus: 'Day-one model tests + benchmarks; situational awareness.' },
  { platform: 'youtube', rank: 18, name: 'Fireship',            handle: '@Fireship',       url: 'https://www.youtube.com/@Fireship',       focus: 'Dense same-day dev breakdowns with a BS-filter.' },
  { platform: 'youtube', rank: 19, name: 'VoloBuilds',          handle: '@VoloBuilds',     url: 'https://www.youtube.com/@VoloBuilds',     focus: 'Full-stack AI builds; RAG/agents/deployment plumbing.' },
  { platform: 'youtube', rank: 20, name: 'David Ondrej',        handle: '@DavidOndrej',    url: 'https://www.youtube.com/@DavidOndrej',    focus: '~40-min agent-build sessions; ship-a-product-with-agents.' },

  // ---------- Reddit (subreddits, top ~14) ----------
  { platform: 'reddit', rank: 1,  name: 'r/LocalLLaMA',     handle: 'r/LocalLLaMA',     url: 'https://www.reddit.com/r/LocalLLaMA/',     focus: 'Open models, local inference, quant, benchmarks — surfaces first.' },
  { platform: 'reddit', rank: 2,  name: 'r/AI_Agents',      handle: 'r/AI_Agents',      url: 'https://www.reddit.com/r/AI_Agents/',      focus: 'Agent orchestration, memory, tool use, real build logs.' },
  { platform: 'reddit', rank: 3,  name: 'r/ClaudeAI',       handle: 'r/ClaudeAI',       url: 'https://www.reddit.com/r/ClaudeAI/',       focus: 'Claude Code workflows, CLAUDE.md, hooks, subagents.' },
  { platform: 'reddit', rank: 4,  name: 'r/LLMDevs',        handle: 'r/LLMDevs',        url: 'https://www.reddit.com/r/LLMDevs/',        focus: 'Building with LLMs: APIs, pipelines, evals, shipping.' },
  { platform: 'reddit', rank: 5,  name: 'r/MachineLearning', handle: 'r/MachineLearning', url: 'https://www.reddit.com/r/MachineLearning/', focus: 'Research-grade signal; keeps you honest on what is new.' },
  { platform: 'reddit', rank: 6,  name: 'r/PromptEngineering', handle: 'r/PromptEngineering', url: 'https://www.reddit.com/r/PromptEngineering/', focus: 'Context design, when a pattern actually helps.' },
  { platform: 'reddit', rank: 7,  name: 'r/ChatGPTCoding',  handle: 'r/ChatGPTCoding',  url: 'https://www.reddit.com/r/ChatGPTCoding/',  focus: 'Claude Code/Cursor/Codex/Copilot compared, tool-agnostic.' },
  { platform: 'reddit', rank: 8,  name: 'r/singularity',    handle: 'r/singularity',    url: 'https://www.reddit.com/r/singularity/',    focus: 'Macro pulse on frontier releases (skim, high noise).' },
  { platform: 'reddit', rank: 9,  name: 'r/OpenAI',         handle: 'r/OpenAI',         url: 'https://www.reddit.com/r/OpenAI/',         focus: 'API/model changes that break or unlock integrations.' },
  { platform: 'reddit', rank: 10, name: 'r/LangChain',      handle: 'r/LangChain',      url: 'https://www.reddit.com/r/LangChain/',      focus: 'Framework-specific orchestration/debug.' },
  { platform: 'reddit', rank: 11, name: 'r/RAG',            handle: 'r/RAG',            url: 'https://www.reddit.com/r/RAG/',            focus: 'Chunking, embeddings, retrieval quality, eval.' },
  { platform: 'reddit', rank: 12, name: 'r/artificial',     handle: 'r/artificial',     url: 'https://www.reddit.com/r/artificial/',     focus: 'Broad AI news/policy/economics breadth layer.' },

  // ---------- RSS / newsletters (individual voices best read as feeds) ----------
  { platform: 'rss', rank: 1, name: 'Simon Willison',  handle: 'simonwillison.net', url: 'https://simonwillison.net/', feed: 'https://simonwillison.net/atom/everything/', focus: 'Near-daily hands-on LLM writeups + prompt-injection reference.' },
  { platform: 'rss', rank: 2, name: 'Latent Space (swyx)', handle: 'latent.space', url: 'https://www.latent.space/', feed: 'https://www.latent.space/feed', focus: 'AI-engineering discipline, inference economics, agent tooling.' },
  { platform: 'rss', rank: 3, name: 'Interconnects (Nathan Lambert)', handle: 'interconnects.ai', url: 'https://www.interconnects.ai/', feed: 'https://www.interconnects.ai/feed', focus: 'Post-training/RLHF/reasoning → what it means for builders.' },
  { platform: 'rss', rank: 4, name: 'Hamel Husain',    handle: 'hamel.dev', url: 'https://hamel.dev/', feed: 'https://hamel.dev/index.xml', focus: 'LLM evals done properly; error analysis → product improvement.' },
  { platform: 'rss', rank: 5, name: 'One Useful Thing (Ethan Mollick)', handle: 'oneusefulthing.org', url: 'https://www.oneusefulthing.org/', feed: 'https://www.oneusefulthing.org/feed', focus: 'How orgs really adopt AI; capability→product framing (AI-PM).' },

  // ---------- Instagram / Threads (substantive-only, top ~6) ----------
  { platform: 'instagram', rank: 1, name: 'Allie K. Miller',   handle: '@alliekmiller',      url: 'https://www.instagram.com/alliekmiller/',      focus: 'SUBSTANTIVE. Enterprise AI adoption/scoping — AI-PM gold.' },
  { platform: 'instagram', rank: 2, name: 'Harper Carroll',    handle: '@harpercarrollai',   url: 'https://www.instagram.com/harpercarrollai/',   focus: 'SUBSTANTIVE. Ex-Meta ML; explains model internals, not hype.' },
  { platform: 'instagram', rank: 3, name: 'Rowan Cheung',      handle: '@rowancheung',       url: 'https://www.instagram.com/rowancheung/',       focus: 'SUBSTANTIVE (news). The Rundown AI; fast release coverage.' },
  { platform: 'instagram', rank: 4, name: 'Aishwarya Srinivasan', handle: '@the.datascience.gal', url: 'https://www.instagram.com/the.datascience.gal/', focus: 'SUBSTANTIVE. Applied DS/AI, vets influencer credibility.' },
  { platform: 'instagram', rank: 5, name: 'Google DeepMind',   handle: '@googledeepmind',    url: 'https://www.instagram.com/googledeepmind/',    focus: 'SUBSTANTIVE (primary source). Real research/product news.' },
  { platform: 'instagram', rank: 6, name: 'Cassie Kozyrkov',   handle: '@decisionleader',    url: 'https://www.instagram.com/decisionleader/',    focus: 'SUBSTANTIVE. Decision intelligence for AI-PM (small IG, deep).' },

  // ---------- Chinese: 抖音 / Bilibili / 小红书 (top ~12; [主阵地] noted) ----------
  { platform: 'bilibili', rank: 1,  name: '数字生命卡兹克 (Khazix)', handle: '数字生命卡兹克', url: 'https://github.com/KKKKhazix/khazix-skills', focus: '[公众号/即刻] 每日AI资讯 + Claude Code/Skill 工程化开源，最贴合你。' },
  { platform: 'bilibili', rank: 2,  name: 'AI超元域',        handle: 'AI超元域',      url: 'https://search.bilibili.com/all?keyword=AI超元域',  focus: '[B站] Claude Code/多Agent 协同、国内网络跑通 Agent 实操。' },
  { platform: 'bilibili', rank: 3,  name: '跟李沐学AI (Mu Li)', handle: '跟李沐学AI', url: 'https://space.bilibili.com/1567748478', focus: '[B站] 论文逐段精读；打底层认知的权威源。' },
  { platform: 'bilibili', rank: 4,  name: '歸藏 (guizang.ai)', handle: '@op7418',    url: 'https://x.com/op7418',                    focus: '[微博/X] 顶级 prompt/AI-product 信息源，Skill 开源。' },
  { platform: 'bilibili', rank: 5,  name: '一泽Eze',         handle: '一泽Eze',       url: 'https://space.bilibili.com/3234142',      focus: '[B站] AI产品拆解、"提示词当代码" 产品化方法论。' },
  { platform: 'bilibili', rank: 6,  name: '同济子豪兄',      handle: 'TommyZihao',    url: 'https://space.bilibili.com/1900783',      focus: '[B站] Agent/RAG 代码级 hands-on + 论文精读。' },
  { platform: 'bilibili', rank: 7,  name: '唐国梁Tommy',     handle: '唐国梁Tommy',   url: 'https://www.tgltommy.com',                focus: '[B站] LangChain/LangGraph/RAG 框架编程 + 选型地图。' },
  { platform: 'bilibili', rank: 8,  name: '林亦LYi',         handle: '林亦LYi',       url: 'https://space.bilibili.com/4401694',      focus: '[B站] 应用型多Agent实验；编排产品设计灵感。' },
  { platform: 'bilibili', rank: 9,  name: '量子位 (QbitAI)',  handle: '量子位',        url: 'https://space.bilibili.com/673779175',    focus: '[B站/公众号] 行业资讯，时效最强。' },
  { platform: 'bilibili', rank: 10, name: 'Datawhale',       handle: 'Datawhale',     url: 'https://space.bilibili.com/431850986',    focus: '[B站/GitHub] 系统化 LLM/Agent/RAG 开源教程。' },
  { platform: 'douyin',   rank: 11, name: '秋芝2046',        handle: '秋芝2046',      url: 'https://www.douyin.com/user/MS4wLjABAAAAwbbVuf1W2DdgRe0xCa0oxg1ZIHbzuiTzyjq3NcOVgBuu6qIidYlMYqbL3ZFY2swu', focus: '[抖音/B站] PM 出身工具测评标杆。' },
  { platform: 'bilibili', rank: 12, name: '稚晖君 (彭志辉)',  handle: '稚晖君',        url: 'https://space.bilibili.com/20259914',     focus: '[B站] 具身智能/机器人硬核工程；行业方向。' },
];

/* ---------- Tiered breadth expansion (2026-08-02) ----------
 * Beyond the AI core above: topic coverage across tech / politics / finance /
 * personal-dev / news / movies. `tier:'headline'` = title+link only (no LLM
 * summary — cheap); promote to 'core' to deep-summarize. Bulk handle-lists are
 * kept compact and expanded to source objects here (DRY); dedupe by handle
 * happens at ingest, so overlaps with the AI core above are harmless. */
function urlFor(platform, handle) {
  const h = handle.replace(/^@/, '').replace(/^r\//, '');
  if (platform === 'x') return `https://x.com/${h}`;
  if (platform === 'youtube') return `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + h}`;
  if (platform === 'reddit') return `https://www.reddit.com/r/${h}/`;
  if (platform === 'threads') return `https://www.threads.com/${handle.startsWith('@') ? handle : '@' + h}`;
  return '';
}
function expand(platform, topic, tier, list) {
  return list.map((e, i) => {
    const [handle, name, focus = ''] = Array.isArray(e) ? e : [e, e.replace(/^@/, ''), ''];
    return { platform, topic, tier, rank: 100 + i, handle, name, url: urlFor(platform, handle), focus };
  });
}

SOURCES.push(
  // ===== AI-lab teams (X) — founders/official = core, researchers = headline =====
  ...expand('x', 'ai-team', 'core', [
    ['@sama', 'Sam Altman'], ['@gdb', 'Greg Brockman'], ['@kevinweil', 'Kevin Weil'], ['@OpenAI', 'OpenAI'],
    ['@jackclarkSF', 'Jack Clark'], ['@AnthropicAI', 'Anthropic'],
    ['@demishassabis', 'Demis Hassabis'], ['@JeffDean', 'Jeff Dean'], ['@OfficialLoganK', 'Logan Kilpatrick'], ['@GoogleDeepMind', 'Google DeepMind'],
    ['@elonmusk', 'Elon Musk'], ['@xai', 'xAI'],
    ['@ylecun', 'Yann LeCun'], ['@alexandr_wang', 'Alexandr Wang'], ['@AIatMeta', 'Meta AI'],
    ['@arthurmensch', 'Arthur Mensch'], ['@MistralAI', 'Mistral AI'],
    ['@Kimi_Moonshot', 'Kimi / Moonshot'], ['@deepseek_ai', 'DeepSeek'], ['@JustinLin610', 'Junyang Lin (Qwen)'], ['@Alibaba_Qwen', 'Qwen'], ['@Zai_org', 'Z.ai (Zhipu)'],
    ['@mntruell', 'Michael Truell (Cursor)'], ['@cursor_ai', 'Cursor'], ['@ilyasut', 'Ilya Sutskever (SSI)'], ['@perplexity_ai', 'Perplexity'],
  ]),
  ...expand('x', 'ai-team', 'headline', [
    ['@polynoamial', 'Noam Brown'], ['@SebastienBubeck', 'Sébastien Bubeck'], ['@aidan_mclau', 'Aidan McLaughlin'], ['@tszzl', 'Roon'], ['@woj_zaremba', 'Wojciech Zaremba'],
    ['@ch402', 'Chris Olah'], ['@AmandaAskell', 'Amanda Askell'], ['@janleike', 'Jan Leike'], ['@catherineols', 'Catherine Olsson'],
    ['@OriolVinyalsML', 'Oriol Vinyals'], ['@quocleix', 'Quoc Le'], ['@douglas_eck', 'Douglas Eck'], ['@TheGregYang', 'Greg Yang'],
    ['@soumithchintala', 'Soumith Chintala'], ['@natfriedman', 'Nat Friedman'], ['@hwchung27', 'Hyung Won Chung'],
    ['@GuillaumeLample', 'Guillaume Lample'], ['@timlacroix', 'Timothée Lacroix'], ['@dchaplot', 'Devendra Chaplot'],
    ['@zizhpan', 'Zizheng Pan'], ['@huybery', 'Binyuan Hui'], ['@denisyarats', 'Denis Yarats'], ['@amanrsanger', 'Aman Sanger'],
  ]),

  // ===== Dev-tool / Claude·Codex community (X) — your posting circle =====
  ...expand('x', 'devtool', 'core', [
    ['@ClaudeDevs', 'Claude Developers'], ['@bcherny', 'Boris Cherny'], ['@_catwu', 'Cat Wu'], ['@alexalbert__', 'Alex Albert'],
    ['@OpenAIDevs', 'OpenAI Developers'], ['@amasad', 'Amjad Masad'], ['@levelsio', 'Pieter Levels'], ['@marc_louvion', 'Marc Lou'],
    ['@tdinh_me', 'Tony Dinh'], ['@mckaywrigley', 'McKay Wrigley'], ['@rauchg', 'Guillermo Rauch'], ['@theo', 'Theo Browne'],
  ]),

  // ===== Topic accounts (X) — headline tier =====
  ...expand('x', 'tech', 'headline', ['@MKBHD', '@benthompson', '@GergelyOrosz', '@dylan522p', '@mingchikuo', '@markgurman', '@IanCutress', '@dnystedt', '@Jukanlosreve', '@firstadopter', '@CaseyNewton', '@reckless', '@stevesi', '@BenBajarin', '@patrickc', '@ID_AA_Carmack', '@cdixon', '@paulg', '@balajis']),
  ...expand('x', 'politics', 'headline', ['@ianbremmer', '@niubi', '@KaiserKuo', '@HuXijin_GT', '@sstrangio', '@dririshsea', '@anwaribrahim', '@malaysiakini', '@BonnieGlaser', '@michaelxpettis', '@ElbridgeColby', '@tanvi_madan', '@vtchakarova', '@adam_tooze', '@NateSilver538', '@ezraklein', '@mattyglesias', '@Yascha_Mounk', '@Noahpinion', '@PeterZeihan']),
  ...expand('x', 'finance', 'headline', ['@RayDalio', '@elerianm', '@Nouriel', '@LynAldenContact', '@biancoresearch', '@KobeissiLetter', '@FedGuy12', '@AndreasSteno', '@MacroAlf', '@RaoulGMI', '@cullenroche', '@jessefelder', '@morganhousel', '@TheStalwart', '@tracyalloway', '@conorsen', '@LizAnnSonders', '@charliebilello', '@jasonfurman', '@CathieDWood', '@Brad_Setser', '@robin_j_brooks', '@paulkrugman', '@gilliantett']),
  ...expand('x', 'persdev', 'headline', ['@naval', '@JamesClear', '@ShaneAParrish', '@RyanHoliday', '@tferriss', '@AdamMGrant', '@IamMarkManson', '@SahilBloom', '@AlexHormozi', '@Codie_Sanchez', '@thejustinwelsh', '@gregisenberg', '@shl', '@david_perell', '@aliabdaal', '@dickiebush', '@Nicolascole77', '@anthilemoon', '@nathanbarry', '@khemaridh']),

  // ===== Threads (browser-scraped over your logged-in Chrome) =====
  ...expand('threads', 'tech', 'core', [
    ['@mosseri', 'Adam Mosseri', 'Head of Instagram/Threads — Meta AI + product launches.'],
    ['@zuck', 'Mark Zuckerberg', 'Meta AI model releases (Muse/Llama), infra strategy.'],
  ]),

  // ===== YouTube (headline; new channels beyond the AI core above) =====
  ...expand('youtube', 'ai', 'headline', ['@AIExplained', '@bycloudAI', '@mreflow', '@sentdex', '@lexfridman', '@statquest', '@MachineLearningStreetTalk', '@Computerphile', '@WesRoth', '@aiadvantage', '@engineerprompt', '@1littlecoder']),
  ...expand('youtube', 'persdev', 'headline', ['@TheDiaryOfACEO', '@ChrisWillx', '@hubermanlab', '@timferriss', '@mattdavella', '@Thomasfrank', '@betterideas', '@ImprovementPill', '@CalNewportMedia', '@melrobbins', '@Struthless']),
  ...expand('youtube', 'tech-finance', 'headline', ['@mkbhd', '@LinusTechTips', '@Mrwhosetheboss', '@Dave2D', '@PBoyle', '@markets', '@CNBC', '@LexClips', '@BenFelixCSI', '@ThePlainBagel', '@AswathDamodaranonValuation', '@AndreiJikh', '@GrahamStephan', '@TheVerge']),

  // ===== Reddit (headline; new subs beyond the AI core) =====
  ...expand('reddit', 'finance', 'headline', ['r/investing', 'r/stocks', 'r/Bogleheads', 'r/SecurityAnalysis', 'r/financialindependence']),
  ...expand('reddit', 'politics', 'headline', ['r/geopolitics', 'r/PoliticalDiscussion', 'r/NeutralPolitics', 'r/foreignpolicy', 'r/CredibleDefense']),
  ...expand('reddit', 'tech', 'headline', ['r/technology', 'r/programming', 'r/ExperiencedDevs']),
  ...expand('reddit', 'movies', 'headline', ['r/movies', 'r/TrueFilm', 'r/MovieSuggestions', 'r/flicks', 'r/criterion']),
  ...expand('reddit', 'world-econ', 'headline', ['r/worldnews', 'r/economics', 'r/AskEconomics', 'r/business']),
  ...expand('reddit', 'persdev', 'headline', ['r/getdisciplined', 'r/productivity', 'r/selfimprovement', 'r/DecidingToBeBetter', 'r/getmotivated']),

  // ===== News outlets (RSS, headline) — feeds live-tested 2026-08-02 =====
  { platform: 'rss', topic: 'news-my', tier: 'headline', rank: 200, name: 'Bernama', handle: 'bernama.com', url: 'https://www.bernama.com/en/', feed: 'https://www.bernama.com/en/rssfeed.php', focus: '🇲🇾 national wire.' },
  { platform: 'rss', topic: 'news-my', tier: 'headline', rank: 201, name: 'Malaysiakini', handle: 'malaysiakini.com', url: 'https://www.malaysiakini.com/', feed: 'https://www.malaysiakini.com/rss/en/news.rss', focus: '🇲🇾 independent politics.' },
  { platform: 'rss', topic: 'news-my', tier: 'headline', rank: 202, name: 'Free Malaysia Today', handle: 'freemalaysiatoday.com', url: 'https://www.freemalaysiatoday.com/', feed: 'https://cms.freemalaysiatoday.com/feed', focus: '🇲🇾 general news.' },
  { platform: 'rss', topic: 'news-my', tier: 'headline', rank: 203, name: 'New Straits Times', handle: 'nst.com.my', url: 'https://www.nst.com.my/', feed: 'https://www.nst.com.my/feed', focus: '🇲🇾 (needs browser UA).' },
  { platform: 'rss', topic: 'news-cn', tier: 'headline', rank: 210, name: 'SCMP', handle: 'scmp.com', url: 'https://www.scmp.com/', feed: 'https://www.scmp.com/rss/91/feed', focus: '🇨🇳 China/HK.' },
  { platform: 'rss', topic: 'news-cn', tier: 'headline', rank: 211, name: 'Global Times', handle: 'globaltimes.cn', url: 'https://www.globaltimes.cn/', feed: 'https://www.globaltimes.cn/rss/outbrain.xml', focus: '🇨🇳 official view.' },
  { platform: 'rss', topic: 'news-cn', tier: 'headline', rank: 212, name: 'CGTN World', handle: 'cgtn.com', url: 'https://www.cgtn.com/', feed: 'https://www.cgtn.com/subscribe/rss/section/world.xml', focus: '🇨🇳 state broadcaster.' },
  { platform: 'rss', topic: 'news-us', tier: 'headline', rank: 220, name: 'NYT HomePage', handle: 'nytimes.com', url: 'https://www.nytimes.com/', feed: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', focus: '🇺🇸 paper of record.' },
  { platform: 'rss', topic: 'news-us', tier: 'headline', rank: 221, name: 'Washington Post World', handle: 'washingtonpost.com', url: 'https://www.washingtonpost.com/', feed: 'https://feeds.washingtonpost.com/rss/world', focus: '🇺🇸 world desk.' },
  { platform: 'rss', topic: 'news-us', tier: 'headline', rank: 222, name: 'NPR News', handle: 'npr.org', url: 'https://www.npr.org/', feed: 'https://feeds.npr.org/1001/rss.xml', focus: '🇺🇸 public radio.' },
  { platform: 'rss', topic: 'news-us', tier: 'headline', rank: 223, name: 'Axios', handle: 'axios.com', url: 'https://www.axios.com/', feed: 'https://api.axios.com/feed/', focus: '🇺🇸 smart brevity.' },
  { platform: 'rss', topic: 'news-world', tier: 'headline', rank: 230, name: 'BBC World', handle: 'bbc.co.uk', url: 'https://www.bbc.com/news/world', feed: 'https://feeds.bbci.co.uk/news/world/rss.xml', focus: '🌍 wire.' },
  { platform: 'rss', topic: 'news-world', tier: 'headline', rank: 231, name: 'Al Jazeera', handle: 'aljazeera.com', url: 'https://www.aljazeera.com/', feed: 'https://www.aljazeera.com/xml/rss/all.xml', focus: '🌍 global south lens.' },
  { platform: 'rss', topic: 'news-world', tier: 'headline', rank: 232, name: 'Guardian World', handle: 'theguardian.com', url: 'https://www.theguardian.com/world', feed: 'https://www.theguardian.com/world/rss', focus: '🌍 world desk.' },
  { platform: 'rss', topic: 'news-econ', tier: 'headline', rank: 240, name: 'WSJ World', handle: 'wsj.com', url: 'https://www.wsj.com/', feed: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', focus: '💰 markets (headlines).' },
  { platform: 'rss', topic: 'news-econ', tier: 'headline', rank: 241, name: 'Bloomberg Markets', handle: 'bloomberg.com', url: 'https://www.bloomberg.com/', feed: 'https://www.bloomberg.com/feeds/markets/news.rss', focus: '💰 markets.' },
  { platform: 'rss', topic: 'news-econ', tier: 'headline', rank: 242, name: 'CNBC Top', handle: 'cnbc.com', url: 'https://www.cnbc.com/', feed: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', focus: '💰 (needs browser UA).' },
  { platform: 'rss', topic: 'news-econ', tier: 'headline', rank: 243, name: 'Financial Times', handle: 'ft.com', url: 'https://www.ft.com/', feed: 'https://www.ft.com/rss/home', focus: '💰 (needs browser UA, paywall body).' },
  { platform: 'rss', topic: 'news-un', tier: 'headline', rank: 250, name: 'UN News', handle: 'news.un.org', url: 'https://news.un.org/', feed: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', focus: '🇺🇳 UN system.' },
  { platform: 'rss', topic: 'news-un', tier: 'headline', rank: 251, name: 'WTO News', handle: 'wto.org', url: 'https://www.wto.org/', feed: 'https://www.wto.org/library/rss/latest_news_e.xml', focus: '🇺🇳 trade.' },
  { platform: 'rss', topic: 'movies', tier: 'headline', rank: 260, name: 'Variety', handle: 'variety.com', url: 'https://variety.com/', feed: 'https://variety.com/feed/', focus: '🎬 industry.' },
  { platform: 'rss', topic: 'movies', tier: 'headline', rank: 261, name: 'The Hollywood Reporter', handle: 'hollywoodreporter.com', url: 'https://www.hollywoodreporter.com/', feed: 'https://www.hollywoodreporter.com/feed/', focus: '🎬 industry.' },
  { platform: 'rss', topic: 'movies', tier: 'headline', rank: 262, name: 'Deadline', handle: 'deadline.com', url: 'https://deadline.com/', feed: 'https://deadline.com/feed/', focus: '🎬 breaking.' },
);

/* ---------- People roster (feed/people.js) → X + GitHub follows ----------
 * Each roster person becomes an X source (via .x) and/or a GitHub Atom-feed
 * source (via .gh). All headline tier. Dedupe-by-handle at ingest collapses
 * overlaps with the curated/topic blocks above. */
for (const [topic, list] of Object.entries(PEOPLE)) {
  for (const p of list) {
    if (p.x) {
      SOURCES.push({ platform: 'x', topic, tier: 'headline', rank: 300, handle: p.x, name: p.n, url: urlFor('x', p.x), focus: '' });
    }
    if (p.gh) {
      SOURCES.push({ platform: 'github', topic, tier: 'headline', rank: 300, handle: p.gh, name: p.n,
        url: `https://github.com/${p.gh}`, feed: `https://github.com/${p.gh}.atom`, focus: '' });
    }
  }
}

/* Convenience: the platforms the ingest script can pull with zero extra setup. */
export const READY_PLATFORMS = Object.entries(PLATFORMS)
  .filter(([, p]) => p.ready)
  .map(([k]) => k);

export function sourcesFor(platform) {
  return SOURCES.filter((s) => s.platform === platform).sort((a, b) => a.rank - b.rank);
}
