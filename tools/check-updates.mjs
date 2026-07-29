#!/usr/bin/env node
// tools/check-updates.mjs — Phase-1 "update radar" for the life-os self-improvement
// engine. See docs/superpowers/specs/2026-07-29-self-improvement-module-design.md.
//
// READ-ONLY. Scans installed MCP servers, Claude Code plugins/marketplaces, global
// npm packages, and Homebrew formulae, then REPORTS what's stale. It never upgrades
// anything — "propose, don't auto-apply". Emitting the report is the whole job;
// applying an update stays a deliberate human act (a later, gated phase).
//
//   node tools/check-updates.mjs           # human-readable report
//   node tools/check-updates.mjs --json    # machine-readable (for the future inbox)
//   node tools/check-updates.mjs --no-net  # skip network probes (npm view / fetch / brew)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const HOME = homedir();
const NET = !process.argv.includes('--no-net');
const AS_JSON = process.argv.includes('--json');

// Run a command; on failure return {__err} instead of throwing, so one broken
// scanner never kills the whole report.
const run = (cmd, args, opts = {}) =>
  execFileP(cmd, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...opts })
    .then((r) => r.stdout.trim())
    .catch((e) => ({ __err: String(e.stderr || e.message || 'failed').trim().split('\n')[0] }));
const sh = (s, opts) => run('sh', ['-c', s], opts);
const ok = (v) => typeof v === 'string';
const has = async (bin) => ok(await run('which', [bin]));
const readJson = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

// ── Scanner 1: MCP servers (from ~/.claude.json, top-level + per project) ────────
async function scanMcp() {
  const cfg = await readJson(join(HOME, '.claude.json'));
  if (!cfg) return { error: 'no ~/.claude.json' };
  const servers = new Map(); // name -> {command,args}
  const collect = (m) => { for (const [k, v] of Object.entries(m || {})) if (!servers.has(k)) servers.set(k, v); };
  collect(cfg.mcpServers);
  for (const proj of Object.values(cfg.projects || {})) collect(proj.mcpServers);

  const pkgOf = (s) => {
    if (s?.command !== 'npx') return null;
    const spec = (s.args || []).find((a) => !a.startsWith('-'));
    if (!spec) return null;
    const pinnedLatest = /@latest$/.test(spec);
    const name = spec.replace(/@(latest|[\^~]?\d[\w.-]*)$/, '');
    return { name, pinnedLatest };
  };

  const rows = [];
  for (const [name, s] of servers) {
    const p = pkgOf(s);
    if (!p) { rows.push({ server: name, note: s?.command === 'npx' ? '?' : `local cmd: ${s?.command || 'n/a'}` }); continue; }
    let latest = '(no-net)';
    if (NET) { const r = await run('npm', ['view', p.name, 'version']); latest = ok(r) ? r : `? (${r.__err})`; }
    rows.push({ server: name, pkg: p.name, latest, mode: p.pinnedLatest ? 'npx @latest (auto)' : 'pinned' });
  }
  return { rows };
}

// ── Scanner 2: Claude Code plugins + marketplace repos ───────────────────────────
async function scanPlugins() {
  const installed = await readJson(join(HOME, '.claude/plugins/installed_plugins.json'));
  const count = installed?.plugins ? Object.keys(installed.plugins).length : 0;
  const mktDir = join(HOME, '.claude/plugins/marketplaces');
  const behind = [];
  if (existsSync(mktDir)) {
    const dirs = readdirSync(mktDir).filter((d) => existsSync(join(mktDir, d, '.git')));
    for (const d of dirs) {
      const repo = join(mktDir, d);
      if (NET) await run('git', ['-C', repo, 'fetch', '--quiet']);
      const c = await run('git', ['-C', repo, 'rev-list', '--count', 'HEAD..@{u}']);
      const n = ok(c) ? parseInt(c, 10) : 0;
      if (n > 0) behind.push({ marketplace: d, commitsBehind: n });
    }
    return { installedPlugins: count, marketplaces: dirs.length, behind };
  }
  return { installedPlugins: count, marketplaces: 0, behind };
}

// ── Scanner 3: global npm packages ───────────────────────────────────────────────
async function scanNpmGlobal() {
  if (!(await has('npm'))) return { error: 'npm not found' };
  // `npm outdated` exits non-zero when anything is outdated → parse stdout regardless.
  const out = await sh('npm outdated -g --json 2>/dev/null || true');
  const raw = ok(out) ? out : '';
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* empty/none */ }
  return { outdated: Object.entries(data).map(([name, v]) => ({ name, current: v.current, latest: v.latest })) };
}

// ── Scanner 4: Homebrew ──────────────────────────────────────────────────────────
async function scanBrew() {
  if (!(await has('brew'))) return { skipped: 'no brew' };
  if (!NET) return { skipped: '--no-net' };
  const out = await sh('brew outdated --json=v2 2>/dev/null || true');
  const data = ok(out) && out ? (() => { try { return JSON.parse(out); } catch { return {}; } })() : {};
  const formulae = (data.formulae || []).map((f) => ({ name: f.name, installed: (f.installed_versions || []).join(','), latest: f.current_version }));
  return { formulae };
}

// ── Scanner 5: codegraph (has its own upgrade path) ──────────────────────────────
async function scanCodegraph() {
  if (!(await has('codegraph'))) return { skipped: 'not installed' };
  const v = await run('codegraph', ['--version']);
  return { version: ok(v) ? v : String(v.__err), hint: 'run `codegraph upgrade` to update' };
}

// ── Report ───────────────────────────────────────────────────────────────────────
function line(s = '') { process.stdout.write(s + '\n'); }
function section(t) { line(''); line(`── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`); }

async function main() {
  const [mcp, plugins, npmg, brew, cg] = await Promise.all([
    scanMcp(), scanPlugins(), scanNpmGlobal(), scanBrew(), scanCodegraph(),
  ]);
  const result = { generatedAt: new Date().toISOString(), net: NET, mcp, plugins, npmGlobal: npmg, brew, codegraph: cg };

  if (AS_JSON) { line(JSON.stringify(result, null, 2)); return; }

  const updates = (plugins.behind?.length || 0) + (npmg.outdated?.length || 0) + (brew.formulae?.length || 0);
  line(`life-os update radar — ${result.generatedAt}${NET ? '' : '  (offline)'}`);

  section('MCP servers');
  for (const r of mcp.rows || []) line(r.pkg ? `  ${r.server.padEnd(16)} ${r.pkg} → latest ${r.latest} [${r.mode}]` : `  ${r.server.padEnd(16)} ${r.note}`);
  if (mcp.error) line(`  (${mcp.error})`);

  section('Claude Code plugins');
  line(`  ${plugins.installedPlugins} plugins installed · ${plugins.marketplaces} marketplaces`);
  if (plugins.behind?.length) for (const b of plugins.behind) line(`  ⤴ ${b.marketplace}: ${b.commitsBehind} commit(s) behind upstream`);
  else line('  ✓ all marketplaces up to date');

  section('Global npm packages');
  if (npmg.error) line(`  (${npmg.error})`);
  else if (npmg.outdated.length) for (const p of npmg.outdated) line(`  ⤴ ${p.name.padEnd(28)} ${p.current} → ${p.latest}`);
  else line('  ✓ all up to date');

  section('Homebrew');
  if (brew.skipped) line(`  (skipped: ${brew.skipped})`);
  else if (brew.formulae.length) for (const f of brew.formulae) line(`  ⤴ ${f.name.padEnd(28)} ${f.installed} → ${f.latest}`);
  else line('  ✓ all up to date');

  section('codegraph');
  if (cg.skipped) line(`  (${cg.skipped})`);
  else line(`  ${cg.version} — ${cg.hint}`);

  line('');
  line(`TOTAL: ${updates} update(s) available. Review, then upgrade deliberately — this radar only reports.`);
}

main().catch((e) => { console.error('radar failed:', e); process.exit(1); });
