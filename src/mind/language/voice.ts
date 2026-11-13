// INNER VOICE renderer (blueprint 10.1, 10.7): picks phrasings with a recency penalty and mood tags,
// so the same thought is rarely worded the same way twice.
import { BANK } from './phrases';
import type { Rng } from '../../util/rng';

export class Voice {
  private recent: string[] = [];
  constructor(private rng: Rng) {}

  /** Render one move. Returns null when no variant can be filled from the given slots. */
  move(move: string, slots: Record<string, string | undefined>, mood = 'any'): string | null {
    const m = BANK[move];
    if (!m) return null;
    const pool = [...(m[mood] ?? []), ...(m.any ?? [])];
    const usable = pool.filter((v) => [...v.matchAll(/\{(\w+)\}/g)].every((x) => slots[x[1]]));
    if (!usable.length) return null;
    const fresh = usable.filter((v) => !this.recent.includes(v));
    const pick = this.rng.pick(fresh.length ? fresh : usable);
    this.recent.push(pick);
    if (this.recent.length > 60) this.recent.shift();
    return pick.replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? '');
  }

  /** Join several moves into one breath of speech or thought. */
  join(...parts: (string | null | undefined)[]): string {
    return parts.filter((p): p is string => !!p && p.length > 0).join(' .. ');
  }
}

/** Elapsed-time phrases from an episode's stamp (blueprint 10.6). The creature tells time by the light. */
export function timePhrase(then: { t: number; day: number; hour: number }, now: { t: number; day: number; hour: number }): string {
  const mins = (now.t - then.t); // one world minute per real second
  if (mins < 4) return 'just now';
  if (mins < 45) return 'a lil while ago';
  if (then.day === now.day) {
    if (then.hour < 12 && now.hour >= 12) return 'this mornin';
    if (now.hour - then.hour > 3) return 'earlier today';
    return 'earlier';
  }
  if (now.day - then.day === 1) return then.hour >= 19 || then.hour < 5 ? 'last night' : 'yesterday';
  if (now.day - then.day < 5) return 'a couple days ago';
  return 'a while back';
}

export function hourPhrase(hour: number): string {
  if (hour < 5) return 'in the middle of the night';
  if (hour < 8) return 'when the sun was comin up';
  if (hour < 11) return 'in the mornin';
  if (hour < 14) return 'round midday';
  if (hour < 17) return 'in the afternoon';
  if (hour < 20) return 'when the sun was goin down';
  return 'at night';
}

export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}
