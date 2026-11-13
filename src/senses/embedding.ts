// Feature vectors (blueprint 3.3). A node's embedding is assembled from what it physically is.
// The percept the creature receives is built only from what is resolved right now.
import type { PartSpec } from '../ontology/types';
import { hashStr, Rng } from '../util/rng';

export const EMB_DIM = 32;

const COLORS: Record<string, [number, number, number]> = {
  green: [0.2, 0.6, 0.2], brown: [0.45, 0.3, 0.15], red: [0.85, 0.1, 0.1], yellow: [0.9, 0.8, 0.2],
  purple: [0.5, 0.2, 0.65], white: [0.95, 0.95, 0.95], black: [0.05, 0.05, 0.05], gray: [0.5, 0.5, 0.52],
  blue: [0.2, 0.4, 0.8], orange: [0.95, 0.5, 0.1],
};

// shape dims: round, flat, line, branching, segmented, lumpy, pointy, hollow
const SHAPES: Record<string, number[]> = {
  round: [1, 0, 0, 0, 0, 0, 0, 0], round_flat: [0.8, 0.8, 0, 0, 0, 0, 0, 0], oval_flat: [0.6, 0.9, 0.1, 0, 0, 0, 0.2, 0],
  skinny_line: [0, 0, 1, 0, 0, 0, 0.2, 0], thin_lines: [0, 0.2, 0.9, 0.4, 0, 0, 0, 0], line: [0, 0, 1, 0.2, 0, 0, 0, 0],
  thick_line: [0.2, 0, 0.9, 0, 0, 0.3, 0, 0], tall_branching: [0, 0, 0.6, 1, 0, 0, 0, 0], bushy: [0.7, 0, 0, 0.5, 0, 0.5, 0, 0],
  lumpy: [0.3, 0, 0, 0, 0, 1, 0, 0], dome: [0.8, 0.3, 0, 0, 0, 0.2, 0, 0], segmented: [0.3, 0, 0.3, 0, 1, 0, 0, 0],
  pointy_lines: [0, 0, 0.7, 0, 0, 0, 1, 0], flat_wide: [0, 1, 0, 0, 0, 0, 0.3, 0], tube_hollow: [0.3, 0, 0.7, 0, 0, 0, 0, 1],
  tiny_hairs: [0, 0, 0.5, 0.2, 0, 0, 0.6, 0], flat_shiny: [0.3, 1, 0, 0, 0, 0, 0, 0], furry_body: [0.8, 0, 0, 0, 0, 0.4, 0, 0],
  dots: [0.6, 0.2, 0, 0, 0.4, 0, 0, 0], topped_stalk: [0.4, 0.3, 0.7, 0, 0, 0, 0, 0], flat_layers: [0, 0.8, 0.3, 0, 0.4, 0.2, 0, 0],
};

const TEXTURES: Record<string, number[]> = {
  smooth: [1, 0, 0, 0], rough: [0, 1, 0, 0], fuzzy: [0, 0, 1, 0], shiny: [0.3, 0, 0, 1], wet: [0.5, 0, 0, 0.8], hard: [0.4, 0.2, 0, 0.3], soft: [0.5, 0, 0.5, 0],
};

const kindCache = new Map<string, number[]>();
function kindCode(key: string): number[] {
  let k = kindCache.get(key);
  if (!k) {
    const r = new Rng(hashStr('kind:' + key));
    k = Array.from({ length: 12 }, () => (r.next() < 0.5 ? -0.35 : 0.35));
    kindCache.set(key, k);
  }
  return k;
}

export interface MotionFeatures { speed: number; flutter: number; selfMoving: number; falling: number }

/**
 * Percept embedding for a node at a given resolution (0..1).
 * Kind code and fine features fade with resolution; noise rises as resolution drops.
 */
export function perceptEmbedding(spec: PartSpec, size: number, resolution: number, motion: MotionFeatures, light: number, rng: Rng, partEmbs: number[][] = []): number[] {
  const r = Math.max(0, Math.min(1, resolution));
  const colorSeen = light > 0.2 ? r : 0;
  const c = COLORS[spec.attrs.color ?? 'gray'] ?? COLORS.gray;
  const sh = SHAPES[spec.looks] ?? SHAPES.lumpy;
  const tx = TEXTURES[spec.attrs.texture ?? ''] ?? [0, 0, 0, 0];
  const sz = Math.max(0, Math.min(1, (Math.log10(Math.max(1e-4, size)) + 3) / 4));
  const k = kindCode(spec.key);
  const e: number[] = [];
  for (let i = 0; i < 3; i++) e.push(c[i] * 0.6 * colorSeen);
  for (let i = 0; i < 8; i++) e.push(sh[i] * 0.45 * Math.min(1, 0.4 + r));
  e.push(sz * 0.5);
  for (let i = 0; i < 4; i++) e.push(tx[i] * 0.3 * r);
  e.push(Math.tanh(motion.speed / 30) * 0.15, motion.flutter * 0.12, motion.selfMoving * 0.2, motion.falling * 0.15);
  for (let i = 0; i < 12; i++) e.push(k[i] * r);
  // parts seen together make the whole more recognizable
  if (partEmbs.length) {
    const w = Math.min(0.35, 0.12 * partEmbs.length);
    for (const pe of partEmbs) for (let i = 0; i < EMB_DIM; i++) e[i] += (pe[i] * w) / partEmbs.length;
  }
  const noise = 0.18 * (1 - r) + 0.02;
  for (let i = 0; i < EMB_DIM; i++) e[i] += rng.gauss() * noise * 0.3;
  return e;
}
