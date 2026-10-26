// État des sources de données : data/status.json garde, pour chaque source, le dernier passage,
// la dernière réussite et le nombre d'échecs d'affilée. Il alimente la page /etat/ et la vérification finale du workflow.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { now } from './lib.mjs';

export const statusFile = (dir) => path.join(dir, 'status.json');

export function readStatus(dir) {
  try {
    const j = JSON.parse(readFileSync(statusFile(dir), 'utf8'));
    return { version: 1, sources: j && typeof j.sources === 'object' && j.sources ? j.sources : {} };
  } catch {
    return { version: 1, sources: {} };
  }
}

// ok = la source a répondu avec des données exploitables ; sinon les anciennes données sont conservées
export function recordStatus(dir, source, { ok, count = 0, note = '' }) {
  const st = readStatus(dir);
  const t = now().toISOString();
  const prev = st.sources[source] || {};
  st.sources[source] = {
    lastRun: t,
    ok: Boolean(ok),
    count: Number(count) || 0,
    note: String(note || '').slice(0, 200),
    lastSuccess: ok ? t : prev.lastSuccess || null,
    lastSuccessCount: ok ? Number(count) || 0 : prev.lastSuccessCount ?? null,
    fails: ok ? 0 : (prev.fails || 0) + 1,
  };
  const sorted = Object.fromEntries(Object.entries(st.sources).sort(([a], [b]) => a.localeCompare(b, 'fr')));
  mkdirSync(dir, { recursive: true });
  const out = JSON.stringify({ version: 1, sources: sorted }, null, 1) + '\n';
  if (!existsSync(statusFile(dir)) || readFileSync(statusFile(dir), 'utf8') !== out) writeFileSync(statusFile(dir), out);
}
