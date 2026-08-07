import { SUPABASE_URL } from '../config.js';
import { muscleList, byMuscle, search, mediaFor } from './catalogue.js';

let exercises = [];
let media = [];
let activeName = null;

init();

async function init() {
  [exercises, media] = await Promise.all([
    fetch('../health/data/exercises.json').then((r) => r.json()).catch(() => []),
    fetch('../health/data/exercise-media.json').then((r) => r.json()).catch(() => []),
  ]);
  populateMuscleFilter();
  document.getElementById('ex-search').addEventListener('input', renderList);
  document.getElementById('ex-muscle').addEventListener('change', renderList);
  renderList();
}

function populateMuscleFilter() {
  const select = document.getElementById('ex-muscle');
  for (const muscle of muscleList(exercises)) {
    const opt = document.createElement('option');
    opt.value = muscle;
    opt.textContent = muscle;
    select.appendChild(opt);
  }
}

function currentList() {
  const q = document.getElementById('ex-search').value.trim();
  const muscle = document.getElementById('ex-muscle').value;
  return search(byMuscle(exercises, muscle), q);
}

function renderList() {
  const list = currentList();
  const count = document.getElementById('ex-count');
  count.textContent = `${list.length} exercise${list.length === 1 ? '' : 's'}`;

  const ul = document.getElementById('ex-list');
  ul.innerHTML = '';
  for (const ex of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ex-item' + (ex.name === activeName ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = ex.name;
    const muscle = document.createElement('span');
    muscle.className = 'muscle';
    muscle.textContent = (ex.primaryMuscles || [])[0] || '';
    btn.append(name, muscle);
    btn.addEventListener('click', () => {
      activeName = ex.name;
      renderList();
      renderDetail(ex);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function renderDetail(ex) {
  const wrap = document.getElementById('ex-detail');
  wrap.innerHTML = '';

  const h3 = document.createElement('h3');
  h3.textContent = ex.name;
  wrap.appendChild(h3);

  const meta = document.createElement('div');
  meta.className = 'ex-meta';
  for (const [label, value] of [['equipment', ex.equipment], ['force', ex.force], ['mechanic', ex.mechanic]]) {
    if (!value) continue;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${label}: ${value}`;
    meta.appendChild(chip);
  }
  if (meta.childElementCount) wrap.appendChild(meta);

  const record = mediaFor(media, ex.name);
  if (record) {
    wrap.appendChild(buildImageBlock(record));
    if (Array.isArray(ex.instructions) && ex.instructions.length) {
      wrap.appendChild(buildInstructionsList(ex.instructions));
    }
  } else {
    wrap.appendChild(buildNoImageBlock(ex));
  }
}

function buildImageBlock(record) {
  const div = document.createElement('div');
  div.className = 'ex-media';

  const img = document.createElement('img');
  img.src = `${SUPABASE_URL}/storage/v1/object/public/exercise-media/${record.path}`;
  img.alt = record.exercise;
  img.loading = 'lazy';
  div.appendChild(img);

  const credit = document.createElement('p');
  credit.className = 'ex-credit';
  const link = document.createElement('a');
  link.href = record.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${record.licenseAuthor || 'wger.de contributors'} · ${record.license}`;
  credit.append('Image: ', link, ', via wger.de');
  div.appendChild(credit);

  return div;
}

/* ~60% of exercises have no free image. A broken-image icon or a grey box
 * reads as "the app is broken" — this is a deliberate composition instead:
 * the exercise's own instructions at readable size plus one outbound link. */
function buildNoImageBlock(ex) {
  const div = document.createElement('div');
  div.className = 'ex-media-empty';

  const p = document.createElement('p');
  p.className = 'ex-instructions';
  p.textContent = Array.isArray(ex.instructions) && ex.instructions.length
    ? ex.instructions.join(' ')
    : 'No instructions on file yet.';
  div.appendChild(p);

  const link = document.createElement('a');
  link.className = 'ex-demo-link';
  link.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} exercise form`)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Watch a demo →';
  div.appendChild(link);

  return div;
}

function buildInstructionsList(instructions) {
  const ol = document.createElement('ol');
  ol.className = 'ex-instructions-list';
  for (const step of instructions) {
    const li = document.createElement('li');
    li.textContent = step;
    ol.appendChild(li);
  }
  return ol;
}
