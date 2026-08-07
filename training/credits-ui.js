init();

async function init() {
  const media = await fetch('../health/data/exercise-media.json').then((r) => r.json()).catch(() => []);
  renderLicenseSummary(media);
  renderCreditsList(media);
}

function renderLicenseSummary(media) {
  const counts = new Map();
  for (const m of media) counts.set(m.license, (counts.get(m.license) || 0) + 1);

  const ul = document.getElementById('license-summary');
  ul.innerHTML = '';
  for (const [license, count] of [...counts.entries()].sort()) {
    const li = document.createElement('li');
    li.textContent = `${license} — ${count} image${count === 1 ? '' : 's'}`;
    ul.appendChild(li);
  }
}

function renderCreditsList(media) {
  const ul = document.getElementById('credits-list');
  ul.innerHTML = '';
  const sorted = [...media].sort((a, b) => a.exercise.localeCompare(b.exercise));
  for (const m of sorted) {
    const li = document.createElement('li');
    li.className = 'credit-row';

    const left = document.createElement('span');
    const link = document.createElement('a');
    link.href = m.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${m.exercise} — ${m.licenseAuthor || 'wger.de contributors'}`;
    left.appendChild(link);

    const right = document.createElement('span');
    right.className = 'license';
    right.textContent = m.license;

    li.append(left, right);
    ul.appendChild(li);
  }
}
