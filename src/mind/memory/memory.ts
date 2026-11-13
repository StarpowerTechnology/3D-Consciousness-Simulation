// MEMORY (blueprint 8): concepts, the knowledge graph, episodes, associations, the lexicon and the place map.
// Everything here was put here by the creature's own senses, thoughts, or being told. Nothing comes from the world file.
import { blend, cosine } from '../core';

export type Source = 'seen' | 'felt' | 'smelled' | 'tasted' | 'heard' | 'told' | 'inferred';

export interface Stamp { t: number; day: number; hour: number; pos: { x: number; z: number } }

export interface Concept {
  id: string;
  name?: string; // the creature's own word, once it has chosen one
  coarse: boolean; // named from a coarse view (e.g. 'bug' before it could tell it was an ant)
  aliases: Set<string>; // other words it understands for this
  offered: string[]; // words the world offered the last time it saw this closely
  proto: number[]; // visual prototype
  smell?: number[];
  taste?: number[];
  props: { looks?: string; color?: string; texture?: string; sizeWord?: string };
  touch: Record<string, string>;
  familiarity: number;
  first: Stamp;
  last: Stamp;
  lastSeenT: number;
  isPart: boolean;
  sightings: { x: number; z: number; t: number }[];
  maxAngle: number; // the closest look it has had (largest angular size)
  touched: boolean;
  tasted: boolean;
  kindOf?: string; // refinement: an ant is a kind of bug
}

export interface Fact {
  s: string; // subject: concept id, or 'w:<word>' for things only known by a word
  r: string; // relation: part_of, has_color, has_looks, has_texture, rel:<type>, feels, tastes, smells, edible, hurts, found_near
  o: string; // object: concept id, 'ground', or a literal value
  sources: Set<Source>;
  confidence: number;
  count: number;
  first: number;
  last: number;
}

export interface Episode {
  id: number;
  stamp: Stamp;
  kind: string; // saw, named, noticed, ate, tasted, drank, hurt, sick, smelled, heard, talked, told, fled, slept
  concept?: string;
  other?: string;
  text?: string;
  valence: number;
  arousal: number;
  strength: number;
}

export type Outcome = 'food' | 'water' | 'harm' | 'sick' | 'safety';

export class Memory {
  concepts = new Map<string, Concept>();
  facts = new Map<string, Fact>();
  episodes: Episode[] = [];
  /** cue → outcome values (blueprint 8.4) */
  values = new Map<string, Record<Outcome, number>>();
  /** live eligibility traces: cue → { time, tau } */
  traces = new Map<string, { t: number; tau: number; w: number }>();
  /** instance handle → concept, for continuity while something stays in view */
  instanceConcept = new Map<string, { c: string; t: number }>();
  /** things it was told but has not checked: word or concept → part word */
  pendingChecks: { concept?: string; word: string; part: string; t: number }[] = [];
  private nextConcept = 1;
  private nextEpisode = 1;

  // ---------------------------------------------------------------- concepts

  newConcept(emb: number[], stamp: Stamp, isPart: boolean): Concept {
    const c: Concept = {
      id: `c${this.nextConcept++}`, coarse: false, aliases: new Set(), offered: [], proto: emb.slice(), props: {}, touch: {},
      familiarity: 1, first: stamp, last: stamp, lastSeenT: stamp.t, isPart, sightings: [], maxAngle: 0, touched: false, tasted: false,
    };
    this.concepts.set(c.id, c);
    return c;
  }

  /** Recognition (blueprint 8.2): compare a percept to every known concept. */
  recognize(emb: number[], isPart: boolean, contextParent?: string): { c: Concept | null; score: number } {
    let best: Concept | null = null, bs = 0;
    for (const c of this.concepts.values()) {
      if (c.isPart !== isPart && !(isPart && c.isPart === false && c.kindOf)) continue;
      let s = cosine(emb, c.proto);
      if (contextParent && this.has(c.id, 'part_of', contextParent)) s += 0.05;
      if (s > bs) { bs = s; best = c; }
    }
    return { c: best, score: bs };
  }

  updateProto(c: Concept, emb: number[], rate = 0.08) {
    c.proto = blend(c.proto, emb, rate);
  }

  named(): Concept[] {
    return [...this.concepts.values()].filter((c) => c.name);
  }

  /** Find a concept by a word: its name, an alias, or a simple plural/singular form. */
  byWord(word: string): Concept | undefined {
    const forms = wordForms(word);
    for (const c of this.concepts.values()) {
      if (c.name && forms.includes(c.name)) return c;
    }
    for (const c of this.concepts.values()) {
      for (const a of c.aliases) if (forms.includes(a)) return c;
    }
    return undefined;
  }

  label(c: Concept | undefined): string {
    return c?.name ?? 'that thing';
  }

  // ---------------------------------------------------------------- facts

  key(s: string, r: string, o: string) { return `${s}|${r}|${o}`; }

  add(s: string, r: string, o: string, source: Source, t: number, conf = 0.8): Fact {
    const k = this.key(s, r, o);
    let f = this.facts.get(k);
    if (!f) {
      f = { s, r, o, sources: new Set([source]), confidence: conf, count: 1, first: t, last: t };
      this.facts.set(k, f);
    } else {
      f.sources.add(source);
      f.count++;
      f.last = t;
      f.confidence = Math.min(1, f.confidence + 0.05);
    }
    return f;
  }

  get(s: string, r: string, o: string): Fact | undefined { return this.facts.get(this.key(s, r, o)); }
  has(s: string, r: string, o: string): boolean { return this.facts.has(this.key(s, r, o)); }

  about(s: string, r?: string): Fact[] {
    const out: Fact[] = [];
    for (const f of this.facts.values()) if (f.s === s && (!r || f.r === r)) out.push(f);
    return out;
  }

  objectsOf(r: string, o: string): Fact[] {
    const out: Fact[] = [];
    for (const f of this.facts.values()) if (f.r === r && f.o === o) out.push(f);
    return out;
  }

  partsOf(cid: string): Concept[] {
    return this.objectsOf('part_of', cid).map((f) => this.concepts.get(f.s)).filter((c): c is Concept => !!c);
  }

  wholesOf(cid: string): Concept[] {
    return this.about(cid, 'part_of').map((f) => this.concepts.get(f.o)).filter((c): c is Concept => !!c);
  }

  /** Was this fact witnessed by its own senses (not just told)? */
  witnessed(f: Fact | undefined): boolean {
    if (!f) return false;
    for (const s of f.sources) if (s !== 'told' && s !== 'inferred') return true;
    return false;
  }

  // ---------------------------------------------------------------- episodes

  remember(stamp: Stamp, kind: string, data: Partial<Episode> = {}): Episode {
    const e: Episode = { id: this.nextEpisode++, stamp, kind, valence: 0, arousal: 0.3, strength: 0.5, ...data };
    e.strength = Math.min(1, 0.35 + 0.5 * e.arousal + 0.2 * Math.abs(e.valence) + (data.strength ?? 0) * 0.3);
    this.episodes.push(e);
    if (this.episodes.length > 2000) this.forget(stamp.t);
    return e;
  }

  episodesOf(cid: string, kind?: string): Episode[] {
    return this.episodes.filter((e) => (e.concept === cid || e.other === cid) && (!kind || e.kind === kind));
  }

  /** Episode strength decays; weak episodes drop out, the facts they produced remain. */
  forget(now: number) {
    for (const e of this.episodes) e.strength *= Math.exp(-(now - e.stamp.t) / 20000);
    this.episodes = this.episodes.filter((e) => e.strength > 0.05 || now - e.stamp.t < 600);
  }

  // ---------------------------------------------------------------- associations (blueprint 8.4)

  trace(cue: string, t: number, tau = 5, w = 1) {
    const cur = this.traces.get(cue);
    if (!cur || cur.t < t) this.traces.set(cue, { t, tau, w: Math.max(w, cur ? cur.w * Math.exp(-(t - cur.t) / cur.tau) : 0) });
  }

  value(cue: string): Record<Outcome, number> {
    let v = this.values.get(cue);
    if (!v) { v = { food: 0, water: 0, harm: 0, sick: 0, safety: 0 }; this.values.set(cue, v); }
    return v;
  }

  peekValue(cue: string, o: Outcome): number {
    return this.values.get(cue)?.[o] ?? 0;
  }

  /** Every cue with a live trace gets credit for an outcome. Harm learns fast; unlearning is slow. */
  credit(outcome: Outcome, amount: number, t: number, filter?: (cue: string) => boolean): string[] {
    const credited: string[] = [];
    const rate = outcome === 'harm' || outcome === 'sick' ? 0.5 : 0.4;
    for (const [cue, tr] of this.traces) {
      const age = t - tr.t;
      const e = tr.w * Math.exp(-age / tr.tau);
      if (e < 0.05) continue;
      if (filter && !filter(cue)) continue;
      const v = this.value(cue);
      v[outcome] = v[outcome] + rate * e * (amount - v[outcome]);
      credited.push(cue);
    }
    for (const [cue, tr] of this.traces) if (t - tr.t > tr.tau * 6) this.traces.delete(cue);
    return credited;
  }

  /** Safe exposure slowly lowers learned harm, never all the way. */
  relax(cue: string, dt: number) {
    const v = this.values.get(cue);
    if (v && v.harm > 0.1) v.harm = Math.max(0.1, v.harm - 0.004 * dt);
  }
}

export function wordForms(w: string): string[] {
  const x = w.toLowerCase();
  const forms = new Set([x]);
  if (x.endsWith('ies')) forms.add(x.slice(0, -3) + 'y');
  if (x.endsWith('es')) forms.add(x.slice(0, -2));
  if (x.endsWith('s')) forms.add(x.slice(0, -1));
  else { forms.add(x + 's'); if (x.endsWith('y')) forms.add(x.slice(0, -1) + 'ies'); }
  if (x === 'leaves' || x === 'leafs') forms.add('leaf');
  if (x === 'leaf') { forms.add('leaves'); forms.add('leafs'); }
  return [...forms];
}
