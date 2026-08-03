import { FeedRepo } from './feed-repo.js';
import { weeklyDigest, toMarkdownDigest } from './feed.js';
import { isoWeekKey } from '../learning/weekly.js';

const todayStr = () => new Date().toISOString().slice(0, 10);
let cache = [];

initTabs();
document.getElementById('feed-filter').addEventListener('change', renderList);
document.getElementById('digest-copy').addEventListener('click', copyMarkdown);
refresh().catch(() => {});

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    buttons.forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'digest') renderDigest();
    if (btn.dataset.tab === 'briefings') renderBriefings();
  }));
}

async function refresh() {
  cache = await FeedRepo.list();
  renderList();
}

const PLATFORM_ICON = { youtube: '▶', rss: '✉', bilibili: 'B', reddit: '👽', x: '𝕏', instagram: '📷', douyin: '🎵' };

function renderList() {
  const filter = document.getElementById('feed-filter').value;
  // Briefings (synthesized overviews/reports) live in their own tab, not the feed.
  const feedItems = cache.filter((x) => x.platform !== 'overview' && x.platform !== 'report');
  const rows = filter ? feedItems.filter((x) => x.status === filter) : feedItems;
  const list = document.getElementById('feed-list');
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = FeedRepo.cloudEnabled
      ? 'Nothing here — run the ingest script to pull new items.'
      : 'Feed needs cloud sync — enable Supabase in config.js.';
    list.appendChild(li);
    return;
  }
  for (const it of rows) list.appendChild(card(it));
}

function card(it) {
  const li = document.createElement('li');
  li.className = 'feed-card';

  const head = document.createElement('div');
  head.className = 'feed-head';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = `${PLATFORM_ICON[it.platform] || '•'} ${it.sourceName || it.platform}`;
  const title = it.url ? document.createElement('a') : document.createElement('span');
  title.className = 'feed-title';
  title.textContent = it.title + (it.durationSec ? ` · ${Math.round(it.durationSec / 60)}m` : '');
  if (it.url) { title.href = it.url; title.target = '_blank'; title.rel = 'noopener'; }
  head.append(chip, title);

  const body = document.createElement('p');
  body.className = 'feed-summary';
  body.textContent = it.summary || '(no summary)';

  const actions = document.createElement('div');
  actions.className = 'feed-actions';
  for (const [label, status] of [['Apply → log', 'applied'], ['Consider', 'considering'], ['Reject', 'rejected']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = label;
    if (it.status === status) b.classList.add('active');
    b.addEventListener('click', async () => {
      try {
        const updated = await FeedRepo.setStatus(it, status);
        Object.assign(it, updated);
        renderList();
      } catch (err) { alert(err.message); }
    });
    actions.appendChild(b);
  }

  li.append(head, body, actions);
  return li;
}

/* ---------------- Weekly digest tab ---------------- */

function renderDigest() {
  const wk = isoWeekKey(todayStr());
  const d = weeklyDigest(cache, wk);
  document.getElementById('digest-head').textContent =
    `${wk} · ${d.total} item${d.total === 1 ? '' : 's'}`;
  document.getElementById('digest-counts').textContent =
    `${d.byStatus.applied} applied · ${d.byStatus.considering} considering · ${d.byStatus.new} unreviewed`;
  const pl = document.getElementById('digest-platforms');
  pl.innerHTML = '';
  for (const [p, n] of Object.entries(d.byPlatform).sort((a, b) => b[1] - a[1])) {
    const li = document.createElement('li');
    li.textContent = `${p} — ${n}`;
    pl.appendChild(li);
  }
  document.getElementById('digest-md').value = toMarkdownDigest(d);
}

async function copyMarkdown() {
  const md = document.getElementById('digest-md').value;
  try { await navigator.clipboard.writeText(md); alert('Digest copied.'); }
  catch { document.getElementById('digest-md').select(); }
}

/* ---------------- Briefings tab (synthesized overviews + daily reports) ---------------- */

function renderBriefings() {
  const items = cache
    .filter((x) => x.platform === 'overview' || x.platform === 'report')
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const box = document.getElementById('briefings-list');
  box.innerHTML = '';
  if (!items.length) {
    box.innerHTML = '<p class="hint">No briefings yet — run <code>node scripts/daily-report.mjs</code> '
      + 'or <code>node scripts/synthesize.mjs &lt;topic&gt;</code> on your Mac.</p>';
    return;
  }
  for (const it of items) {
    const d = document.createElement('details');
    d.className = 'briefing';
    const s = document.createElement('summary');
    s.textContent = `${it.platform === 'report' ? '📰' : '🧭'} ${it.title}`;
    const body = document.createElement('div');
    body.className = 'briefing-body';
    body.innerHTML = mdToHtml(it.summary || '');
    d.append(s, body);
    box.appendChild(d);
  }
  box.firstElementChild.open = true; // newest expanded
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Tiny, safe markdown → HTML (headings, bold, links, lists, hr, paragraphs). */
function mdToHtml(md) {
  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of escapeHtml(md).split('\n')) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const lvl = line.match(/^#+/)[0].length;
      out.push(`<h${lvl}>${inline(line.replace(/^#+\s/, ''))}</h${lvl}>`);
    } else if (/^(-|\d+\.)\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^(-|\d+\.)\s/, ''))}</li>`);
    } else if (/^---+$/.test(line)) { closeList(); out.push('<hr>'); }
    else if (line === '') { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
}
