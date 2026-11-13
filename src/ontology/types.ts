import { parse } from 'yaml';

export interface Needs { angle: number; dwell_s: number; touch: boolean }

export interface TasteSpec { sig: Record<string, number>; nutrition: number; toxin: number; hydration: number }
export interface SmellSpec { sig: Record<string, number>; strength: number; reach_m: number }
export interface SoundSpec { sig: Record<string, number> }

export interface PartSpec {
  key: string; // e.g. 'leaf'
  path: string; // e.g. 'tree.branch.leaf'
  words: string[];
  coarse_words?: string[];
  full_angle: number;
  looks: string;
  attrs: { color?: string; texture?: string; sizeWord?: string };
  relation?: { type: string; to: string };
  needs: Needs;
  motion?: string;
  material?: string;
  touch?: Record<string, string>;
  smell?: SmellSpec;
  taste?: TasteSpec;
  sound?: SoundSpec;
  affords: string[];
  define?: string;
  count: number;
  parts: PartSpec[];
}

export interface Material { friction: number; bounce: number; hardness: number; sharpness: number; density: number }

export interface Ontology {
  primitives: Record<string, string[]>; // looks key → descriptive words
  materials: Record<string, Material>;
  entities: Record<string, PartSpec>;
  /** Every word the world can offer. Used only by the gate (blueprint 8.5), never by the mind. */
  worldVocabulary: Set<string>;
}

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

function readPart(key: string, path: string, raw: any): PartSpec {
  const needs = raw.needs ?? {};
  const spec: PartSpec = {
    key,
    path,
    words: (raw.words ?? [key]).map(String),
    coarse_words: raw.coarse_words?.map(String),
    full_angle: num(raw.full_angle, 2),
    looks: raw.looks ?? 'lumpy',
    attrs: { ...(raw.attrs ?? {}) },
    relation: raw.relation ? { type: raw.relation.type, to: raw.relation.to } : undefined,
    needs: { angle: num(needs.angle, 2), dwell_s: num(needs.dwell_s, 0), touch: !!needs.touch },
    motion: raw.motion,
    material: raw.material,
    touch: raw.touch,
    smell: raw.smell
      ? { sig: raw.smell.sig ?? {}, strength: num(raw.smell.strength, 0.05), reach_m: num(raw.smell.reach_m, 1) }
      : undefined,
    taste: raw.taste
      ? {
          sig: raw.taste.sig ?? {},
          nutrition: num(raw.taste.nutrition, 0),
          toxin: num(raw.taste.toxin, 0),
          hydration: num(raw.taste.hydration, 0),
        }
      : undefined,
    sound: raw.sound ? { sig: raw.sound.sig ?? {} } : undefined,
    affords: raw.affords ?? [],
    define: raw.define,
    count: num(raw.count, 1),
    parts: [],
  };
  const parts = raw.parts ?? {};
  for (const k of Object.keys(parts)) spec.parts.push(readPart(k, `${path}.${k}`, parts[k]));
  return spec;
}

export function loadOntology(yamlText: string): Ontology {
  const raw = parse(yamlText, { merge: true }) as any;
  const entities: Record<string, PartSpec> = {};
  for (const k of Object.keys(raw.entities)) entities[k] = readPart(k, k, raw.entities[k]);
  const vocab = new Set<string>();
  const walk = (p: PartSpec) => {
    for (const w of [...p.words, ...(p.coarse_words ?? [])]) for (const t of w.split(/\s+/)) vocab.add(t.toLowerCase());
    p.parts.forEach(walk);
  };
  Object.values(entities).forEach(walk);
  return {
    primitives: raw.primitives?.looks ?? {},
    materials: raw.materials ?? {},
    entities,
    worldVocabulary: vocab,
  };
}

export function findPart(spec: PartSpec, key: string): PartSpec | undefined {
  return spec.parts.find((p) => p.key === key);
}
