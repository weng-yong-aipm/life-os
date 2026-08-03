import { demoBanner } from './demo.js';
/* W1 — back-office shell. Injects a persistent module sidebar on every page and
 * highlights the active one. No markup edits per page beyond linking this file.
 * DOM built with createElement/textContent (XSS-safe, matches the repo). */

const MODULES = [
  { key: 'home', href: 'index.html', ico: '🏠', name: 'Home' },
  { key: 'finance', href: 'finance/index.html', ico: '🧾', name: 'Finance' },
  { key: 'health', href: 'health/index.html', ico: '🍳', name: 'Health' },
  { key: 'career', href: 'career/index.html', ico: '💼', name: 'Goals & Certs' },
  { key: 'learning', href: 'learning/index.html', ico: '📚', name: 'Learning' },
  { key: 'capture', href: 'capture/index.html', ico: '📥', name: 'Capture' },
  { key: 'feed', href: 'feed/index.html', ico: '📡', name: 'Feed' },
  { key: 'improve', href: 'improve/index.html', ico: '✨', name: 'Improve' },
];

const DIRS = ['finance', 'health', 'career', 'learning', 'capture', 'feed', 'improve'];
const inSub = DIRS.some((d) => location.pathname.includes(`/${d}/`));
const base = inSub ? '../' : './';
const activeKey = DIRS.find((d) => location.pathname.includes(`/${d}/`)) || 'home';

const aside = document.createElement('aside');
aside.className = 'app-sidebar';

const brand = document.createElement('a');
brand.className = 'brand';
brand.href = `${base}index.html`;
brand.textContent = 'life-os';
aside.appendChild(brand);

for (const m of MODULES) {
  const a = document.createElement('a');
  a.className = 'nav-item';
  a.href = base + m.href;
  if (m.key === activeKey) a.setAttribute('aria-current', 'page');
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.textContent = m.ico;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = m.name;
  a.append(ico, name);
  aside.appendChild(a);
}

document.documentElement.classList.add('has-shell');
document.body.prepend(aside);

demoBanner();
