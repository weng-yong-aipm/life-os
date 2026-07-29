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
  }));
}

async function refresh() {
  cache = await FeedRepo.list();
  renderList();
}

const PLATFORM_ICON = { youtube: '▶', rss: '✉', bilibili: 'B', reddit: '👽', x: '𝕏', instagram: '📷', douyin: '🎵' };

function renderList() {
  const filter = document.getElementById('feed-filter').value;
  const rows = filter ? cache.filter((x) => x.status === filter) : cache;
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
