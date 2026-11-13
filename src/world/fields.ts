// Fields: light, wind, smell and sound (blueprint 3.4). Pure functions of world state and time.
import { noise2 } from '../util/rng';
import { clamp, DEG, type V3 } from '../util/vec';

export const START_HOUR = 9;
export const SECONDS_PER_WORLD_HOUR = 60; // one world day = 24 real minutes

export interface Clock { t: number; hour: number; day: number }

export function clockAt(t: number): Clock {
  const minutes = START_HOUR * 60 + t * (60 / SECONDS_PER_WORLD_HOUR);
  return { t, hour: (minutes / 60) % 24, day: Math.floor(minutes / 1440) };
}

export interface Sun { dir: V3; elevation: number; ambient: number; warmth: number }

export function sunAt(hour: number): Sun {
  // Sun rises at 6, peaks at 13, sets at 20.
  const f = (hour - 6) / 14;
  const elev = Math.sin(clamp(f, -0.15, 1.15) * Math.PI) * 62 * DEG;
  const az = (-70 + 140 * f) * DEG;
  const dir = { x: Math.sin(az) * Math.cos(elev), y: Math.sin(elev), z: -Math.cos(az) * Math.cos(elev) };
  const day = clamp((elev / DEG + 4) / 14, 0, 1);
  const ambient = 0.06 + 0.94 * day;
  const warmth = clamp(1 - Math.abs(elev / DEG - 8) / 20, 0, 1); // golden at low sun
  return { dir, elevation: elev, ambient, warmth };
}

export interface Wind { dir: V3; strength: number; gust: number }

export function windAt(t: number): Wind {
  const a = noise2(t * 0.01, 0.5, 7) * 1.4 + 0.6;
  const base = 0.25 + 0.25 * (noise2(t * 0.02, 3.1, 9) + 1) * 0.5;
  const g = Math.max(0, noise2(t * 0.18, 8.3, 13)) * 1.6 + Math.max(0, noise2(t * 0.7, 1.1, 5)) * 0.4;
  const gust = clamp(g, 0, 1);
  return { dir: { x: Math.cos(a), y: 0, z: Math.sin(a) }, strength: clamp(base + gust * 0.75, 0, 1), gust };
}

/** Leaf flutter: the same function moves the leaf for the senses and for the renderer (rule 6). */
export function flutter(phase: number, t: number, wind: Wind, amp: number): { off: V3; vel: V3; twist: number } {
  const a = amp * (0.15 + wind.strength * 0.85);
  const w = 4.5 + (phase % 1) * 3;
  const s1 = Math.sin(w * t + phase * 6.283), c1 = Math.cos(w * t + phase * 6.283);
  const s2 = Math.sin(1.7 * w * t + phase * 3.1), c2 = Math.cos(1.7 * w * t + phase * 3.1);
  const g = 0.3 + 0.7 * wind.gust;
  return {
    off: { x: wind.dir.x * a * (s1 * g + 0.4 * wind.strength), y: a * 0.5 * s2 * g, z: wind.dir.z * a * (s1 * g + 0.4 * wind.strength) },
    vel: { x: wind.dir.x * a * w * c1 * g, y: a * 0.5 * 1.7 * w * c2 * g, z: wind.dir.z * a * w * c1 * g },
    twist: 0.5 * s1 * g * (0.3 + wind.strength),
  };
}

/** Grass sway angle, shared by the grass shader and the motion the creature perceives. */
export function swayAngle(x: number, z: number, t: number, wind: Wind): number {
  return (0.05 + 0.25 * wind.strength) * Math.sin(t * 2.2 + x * 1.7 + z * 1.3) * (0.4 + 0.6 * wind.gust) + 0.12 * wind.strength;
}

export const SMELL_DIMS = ['sweet', 'rot', 'green', 'earthy', 'floral', 'musky', 'sharp', 'wet'] as const;
export const SOUND_DIMS = ['pitch', 'loudness', 'buzz', 'rhythm', 'duration', 'onset'] as const;
export const TASTE_DIMS = ['sweet', 'bitter', 'sour', 'salty', 'savory'] as const;

export function toVec(sig: Record<string, number> | undefined, dims: readonly string[]): number[] {
  return dims.map((d) => sig?.[d] ?? 0);
}

export interface SoundEvent {
  id: number;
  pos: V3;
  sig: number[];
  loudness: number;
  t0: number;
  dur: number;
  source?: string;
  speech?: { text: string; speaker: string };
}
