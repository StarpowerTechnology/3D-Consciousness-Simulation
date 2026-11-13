// Seeded randomness. Nothing in the simulation uses Math.random, so every run is repeatable from its seed.

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). mulberry32. */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hiExclusive: number): number {
    return Math.floor(this.range(lo, hiExclusive));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Standard normal (Box-Muller). */
  gauss(): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  fork(salt: number): Rng {
    return new Rng((Math.floor(this.next() * 4294967296) ^ Math.imul(salt, 2654435761)) >>> 0);
  }
}

/** Stable 32-bit hash of a string. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Cheap deterministic value noise in [−1, 1] for (x, y). */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f, seed + i * 17);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}
