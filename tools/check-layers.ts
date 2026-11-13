// Enforces blueprint 14.1 rule 1: the mind never touches the engine.
// src/mind may import only from src/mind, src/protocol and src/util.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const MIND = join(root, 'src/mind');
const ALLOWED = ['src/mind', 'src/protocol', 'src/util'].map((p) => join(root, p));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

export function layerViolations(): string[] {
  const out: string[] = [];
  for (const f of files(MIND)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      if (!spec.startsWith('.')) { out.push(`${relative(root, f)} imports package '${spec}'`); continue; }
      const target = resolve(dirname(f), spec);
      if (!ALLOWED.some((a) => target.startsWith(a))) out.push(`${relative(root, f)} imports ${relative(root, target)}`);
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('check-layers.ts')) {
  const v = layerViolations();
  if (v.length) { console.error('Layer violations:\n' + v.join('\n')); process.exit(1); }
  console.log('layers ok: src/mind imports nothing from the engine, physics or renderer');
}
