// The engine: three formulas (blueprint 2). Update, Choice, Learning. Everything in the mind is built from these.
import type { Rng } from '../util/rng';

/** Update: a leaky value that drifts back to rest unless pushed. */
export function leak(x: number, rest: number, tau: number, input: number, dt: number, noise = 0, rng?: Rng): number {
  const n = noise && rng ? rng.gauss() * noise * Math.sqrt(dt) : 0;
  return x + dt * (-(x - rest) / tau + input) + n;
}

/** Choice: sample one option from scores with a softmax at temperature T. */
export function choose<T>(options: { item: T; score: number }[], T: number, rng: Rng): { item: T; score: number; p: number } | null {
  if (!options.length) return null;
  const m = Math.max(...options.map((o) => o.score));
  const ws = options.map((o) => Math.exp((o.score - m) / Math.max(0.02, T)));
  const sum = ws.reduce((a, b) => a + b, 0);
  let r = rng.next() * sum;
  for (let i = 0; i < options.length; i++) {
    r -= ws[i];
    if (r <= 0) return { ...options[i], p: ws[i] / sum };
  }
  const i = options.length - 1;
  return { ...options[i], p: ws[i] / sum };
}

/** Learning: w ← w + rate · trace · (outcome − expected). */
export function learn(w: number, rate: number, trace: number, outcome: number, expected: number): number {
  return w + rate * trace * (outcome - expected);
}

export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

export function blend(proto: number[], x: number[], rate: number): number[] {
  return proto.map((p, i) => p * (1 - rate) + (x[i] ?? 0) * rate);
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
