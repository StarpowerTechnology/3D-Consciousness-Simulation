// L5 THE MIND (blueprint 2, 5.2, 6–12). Engine-free: PerceptFrames in, MotorIntents out.
// Every quantity is a named state updated by weighted inputs; every decision is sampled, not scripted.
import type { MotorIntent, PerceptFrame, VisualPercept, MindReport, ThoughtRecord, GazeMode } from '../protocol/types';
import { PROTOCOL_VERSION } from '../protocol/types';
import { Rng } from '../util/rng';
import { choose, cosine, leak, clamp01, sigmoid, blend } from './core';
import { Memory, type Concept, type Stamp, type Outcome } from './memory/memory';
import { Voice, listPhrase } from './language/voice';
import { describe, isPlural, LOOKS, relationPhrase, TEXTURE_WORDS, INNATE_WORDS } from './language/innate';
import { Dialogue } from './language/dialogue';

export interface Temperament { curiosity: number; fearfulness: number; talkativeness: number }

interface Percept extends VisualPercept { c?: Concept; score: number; novelty: number; salience: number }

interface Behavior { name: string; target?: string; since: number; until?: number; data: Record<string, any> }

const plural = (w: string) => (w.endsWith('s') ? w : w + 's');
const pluralish = (looks: string | undefined, w: string) => isPlural(looks) || (w.endsWith('s') && !w.endsWith('ss'));

/** One good meal is enough to make something worth coming back for. */
const FOOD_T = 0.08;
const BRIGHT = new Set(['red', 'purple', 'yellow', 'orange']);

const DEFAULT_TEMPERAMENT: Temperament = { curiosity: 0.75, fearfulness: 0.6, talkativeness: 0.85 };

export class Mind {
  readonly mem = new Memory();
  readonly rng: Rng;
  readonly voice: Voice;
  readonly dialogue: Dialogue;
  readonly temper: Temperament;

  t = 0;
  stamp: Stamp = { t: 0, day: 0, hour: 9, pos: { x: 0, z: 0 } };
  frame!: PerceptFrame;
  feelings = { arousal: 0.2, valence: 0.1, fear: 0, curiosity: 0.5 };
  drives = { hunger: 0, thirst: 0, safety: 0, rest: 0, comfort: 0, curiosity: 0.5 };
  eye = { innerT: 0.5, mode: 'scan' as GazeMode, target: undefined as string | undefined, locked: false, interest: 0, lockT: 0, maxDwell: 4, nextSaccade: 0.3, scanYaw: 0, scanPitch: -10, lostT: 0, nameDelay: 1.4, infoGain: 0 };
  behavior: Behavior = { name: 'wander', since: 0, data: {} };
  stance?: string;
  focus?: { kind: string; label: string; node?: string };
  percepts: Percept[] = [];
  /** instance handles whose details it has noticed (what the inspector highlights) */
  noticed = new Set<string>();
  private dwell = new Map<string, number>();
  private lastLooked = new Map<string, number>();
  private lastThought = new Map<string, number>();
  private lastAnyThought = -10;
  private thinkingUntil = 0;
  private newThoughts: ThoughtRecord[] = [];
  private newSpeech: string[] = [];
  private speakQueue: { text: string; at: number; loud: number; echo?: boolean }[] = [];
  private prev?: PerceptFrame['body'];
  private boredom = 0;
  private lastSmell: number[] = [];
  private smellTrend = 0;
  private hurtBy: { node: string; t: number } | null = null;
  private lastHarmPredicted = -10;
  private lastSwallowed: { c?: string; t: number } | null = null;
  private lastSpeech: { text: string; speaker: string; t: number } | null = null;
  private recogCache = new Map<string, { c?: Concept; score: number; t: number }>();
  private recogAt = new Map<string, number>();
  lastHeardWords = new Set<string>();
  private lastDriveSay = new Map<string, number>();
  private sleepStart = -1;
  private knownSmells: number[][] = [];
  /** things it tried and failed to reach, so it stops trying for a while */
  private unreachable = new Map<string, number>();
  private smellCooldown = 0;

  constructor(seed = 1, temper: Partial<Temperament> = {}) {
    this.rng = new Rng(seed);
    this.voice = new Voice(this.rng.fork(5));
    this.temper = { ...DEFAULT_TEMPERAMENT, ...temper };
    this.dialogue = new Dialogue(this);
  }

  // ======================================================================= main tick

  tick(f: PerceptFrame, dt: number): MotorIntent {
    this.frame = f;
    this.t = f.time.t;
    this.stamp = { t: f.time.t, day: f.time.day, hour: f.time.hour, pos: { ...f.proprio.pos } };

    this.interoception(f, dt);
    this.perceive(f, dt);
    this.smell(f, dt);
    this.hear(f);
    this.touchAndTaste(f);
    this.appraise(f, dt);
    this.gaze(f, dt);
    this.noticeDetails(f, dt);
    this.maybeName(f, dt);
    this.idleThoughts(f, dt);
    this.chooseBehavior(f, dt);
    const intent = this.act(f, dt);
    this.prev = { ...f.body };
    return intent;
  }

  // ======================================================================= body → drives, outcomes → learning

  private interoception(f: PerceptFrame, dt: number) {
    const b = f.body;
    const d = this.drives;
    const night = f.time.hour >= 20 || f.time.hour < 6;
    // above 0.75 the need is zero (a negative base to a fractional power would be NaN)
    d.hunger = clamp01(Math.max(0, (0.75 - b.energy) / 0.6) ** 1.5 * 1.2);
    d.thirst = clamp01(Math.max(0, (0.75 - b.hydration) / 0.6) ** 1.5 * 1.2);
    d.rest = clamp01(b.fatigue * 1.1 + (night ? 0.45 : 0) + (f.time.ambientLight < 0.25 ? 0.2 : 0));
    d.comfort = clamp01(Math.abs(b.temperature - 0.5) * 1.6 + b.wet * 0.5 + (f.time.ambientLight < 0.15 && !f.proprio.inShelter ? 0.3 : 0));
    d.safety = clamp01(this.feelings.fear);
    d.curiosity = clamp01(this.feelings.curiosity * 0.7 + this.boredom * 0.4);

    if (!this.prev) return;
    const p = this.prev;
    // reward is the reduction of a drive (blueprint 9.4)
    const dE = b.energy - p.energy;
    if (dE > 0.004) {
      const amt = clamp01(dE * 9 * (0.35 + d.hunger));
      const cues = this.mem.credit('food', amt, this.t, (c) => c.startsWith('taste:') || c.startsWith('see:') || c.startsWith('smell:'));
      this.mem.remember(this.stamp, 'ate', { concept: this.lastSwallowed?.c, valence: amt, arousal: 0.4 });
      if (amt > 0.15) this.think('SATISFIED', 0.9, () => this.voice.move('SATISFIED', {}), { aloud: this.rng.chance(0.3) });
      void cues;
    }
    const dH = b.hydration - p.hydration;
    if (dH > 0.01) {
      this.mem.credit('water', 1, this.t, (c) => c.startsWith('taste:') || c.startsWith('see:'));
      if (d.thirst < 0.2) this.think('QUENCHED', 0.7, () => this.voice.move('QUENCHED', {}));
    }
    if (b.nausea - p.nausea > 0.05) {
      const blamed = this.mem.credit('sick', 1, this.t, (c) => c.startsWith('taste:') || c.startsWith('smell:'));
      const lc = this.lastSwallowed?.c ? this.mem.concepts.get(this.lastSwallowed.c) : undefined;
      if (lc) this.mem.add(lc.id, 'sickens', 'self', 'felt', this.t);
      this.mem.remember(this.stamp, 'sick', { concept: lc?.id, valence: -0.8, arousal: 0.6 });
      this.think('SICK', 1, () => this.voice.join(this.voice.move('SICK', {}), lc?.name ? this.voice.move('SICK_CAUSE', { label: lc.name }) : null), { force: true, aloud: true });
      void blamed;
    }
    if (b.pain - p.pain > 0.04) {
      // harm: every cue with a live trace gets blamed — the look of the thing, its sound, the place
      this.mem.credit('harm', 1, this.t, (c) => c.startsWith('see:') || c.startsWith('place:') || c.startsWith('sound:'));
      const by = f.touch.find((t) => t.where === 'body');
      if (by) this.hurtBy = { node: by.node, t: this.t };
      const cc = by ? this.conceptOfNode(by.node) : undefined;
      if (cc) this.mem.add(cc.id, 'hurts', 'self', 'felt', this.t);
      this.mem.remember(this.stamp, 'hurt', { concept: cc?.id, valence: -1, arousal: 1 });
      this.feelings.fear = clamp01(this.feelings.fear + 0.6);
      this.think('PAIN', 1, () => this.voice.join(this.voice.move('PAIN', {}), cc?.name ? this.voice.move('PAIN_CAUSE', { label: cc.name }) : null), { force: true, aloud: true });
    }
    // harm predicted and avoided: relief strengthens the dodge
    if (this.lastHarmPredicted > 0 && this.t - this.lastHarmPredicted > 1.5 && this.t - this.lastHarmPredicted < 1.6 && b.pain < 0.05)
      this.think('DODGE_OK', 0.7, () => this.voice.move('DODGE_OK', {}));
    // drive crossings
    this.driveThought('hunger', d.hunger, 0.45, () => this.voice.move(d.hunger > 0.8 ? 'STARVING' : 'HUNGRY', {}));
    const waterC = this.mem.byWord('water');
    this.driveThought('thirst', d.thirst, 0.45, () => (waterC?.name ? this.voice.move('THIRSTY', { label: waterC.name }) : this.voice.move('THIRSTY_UNKNOWN', {})));
    this.driveThought('rest', d.rest, 0.7, () => this.voice.move(f.time.ambientLight < 0.3 ? 'SHELTER' : 'TIRED', {}));
    this.driveThought('comfort', b.temperature < 0.25 ? 1 : 0, 0.5, () => this.voice.move('COLD', {}));
  }

  private driveThought(key: string, v: number, level: number, build: () => string | null) {
    const last = this.lastDriveSay.get(key) ?? -999;
    if (v > level && this.t - last > 90) {
      if (this.think('DRIVE_' + key.toUpperCase(), v, build, { force: true })) this.lastDriveSay.set(key, this.t);
    }
  }

  // ======================================================================= perception → recognition

  private perceive(f: PerceptFrame, dt: number) {
    const out: Percept[] = [];
    for (const v of f.vision) {
      const p: Percept = { ...v, score: 0, novelty: 0.4, salience: 0 };
      if (v.level !== 'detected') {
        // recognition runs at a few Hz per object; continuity holds it in between
        const cached = this.recogCache.get(v.node);
        if (!cached || this.t - cached.t > 0.4) {
          const parentC = v.parent ? this.recogCache.get(v.parent)?.c?.id : undefined;
          const r = this.mem.recognize(v.embedding, !!v.parent, parentC);
          const known = this.mem.instanceConcept.get(v.node);
          let c = r.score >= 0.82 ? r.c ?? undefined : undefined;
          let score = r.score;
          if (known && this.t - known.t < 120) {
            const kc = this.mem.concepts.get(known.c);
            if (kc) { c = kc; score = Math.max(score, 0.86); }
          }
          this.recogCache.set(v.node, { c, score, t: this.t });
        }
        const rc = this.recogCache.get(v.node)!;
        p.c = rc.c;
        p.score = rc.score;
        const fam = p.c ? p.c.familiarity : 0;
        p.novelty = p.c ? clamp01((1 - p.score) * 2) / (1 + fam * 0.12) + (p.c.name ? 0 : 0.35) : clamp01(1 - p.score * 0.8);
        if (p.c) {
          // memory of where things are
          this.sighting(p.c, v);
          this.mem.trace('see:' + p.c.id, this.t, 5, v.falling || v.loomingDps > 3 ? 1 : 0.6);
          if (p.c.name && !v.parent) {
            const last = this.recogAt.get(p.c.id) ?? -999;
            if (this.t - last > 90 && this.t - p.c.lastSeenT > 60 && v.angleDeg > 3 && v.offCenterDeg < 10) {
              const c = p.c;
              this.think('RECOGNIZE', 0.5 + 0.1 * (5 / (5 + c.familiarity)), () => this.voice.move('RECOGNIZE', { label: c.name }, this.mood()));
            }
            this.recogAt.set(p.c.id, this.t);
          }
          p.c.lastSeenT = this.t;
        }
      }
      out.push(p);
    }
    this.percepts = out;
    // place trace: where it is matters for harm and food
    this.mem.trace('place:' + Math.round(f.proprio.pos.x) + ',' + Math.round(f.proprio.pos.z), this.t, 6, 0.5);
    void dt;
  }

  private sighting(c: Concept, v: VisualPercept) {
    const f = this.frame;
    const yaw = (f.proprio.headingDeg + v.bearingDeg) * (Math.PI / 180);
    const h = v.distance * Math.cos(v.elevationDeg * (Math.PI / 180));
    const x = f.proprio.pos.x + Math.sin(yaw) * h, z = f.proprio.pos.z + Math.cos(yaw) * h;
    const s = c.sightings.find((q) => Math.hypot(q.x - x, q.z - z) < 0.6);
    if (s) { s.x = s.x * 0.9 + x * 0.1; s.z = s.z * 0.9 + z * 0.1; s.t = this.t; }
    else { c.sightings.push({ x, z, t: this.t }); if (c.sightings.length > 24) c.sightings.shift(); }
    c.last = this.stamp;
  }

  conceptOfNode(node: string): Concept | undefined {
    const rc = this.recogCache.get(node);
    if (rc?.c) return rc.c;
    const k = this.mem.instanceConcept.get(node);
    return k ? this.mem.concepts.get(k.c) : undefined;
  }

  percept(node?: string): Percept | undefined {
    return node ? this.percepts.find((p) => p.node === node) : undefined;
  }

  // ======================================================================= smell

  private smell(f: PerceptFrame, dt: number) {
    const mix = f.smell.mix;
    const s = f.smell.strength;
    this.smellTrend = this.lastSmell.length ? mix.reduce((a, x, i) => a + x - (this.lastSmell[i] ?? 0), 0) : 0;
    this.lastSmell = mix.slice();
    // learning a smell: close to a fixated thing, the smell gets bound to it
    const g = this.percept(this.eye.target);
    if (g?.c && g.distance < 0.35 && s > 0.08 && this.eye.locked) {
      g.c.smell = g.c.smell ? blend(g.c.smell, mix, 0.1) : mix.slice();
      if (g.c.smell && cosine(g.c.smell, mix) > 0.6) this.mem.add(g.c.id, 'smells', 'smelled', 'smelled', this.t);
    }
    // a smell alone can bring back a concept (blueprint 8.2, 8.4)
    if (s < 0.12) return;
    let best: Concept | undefined, bs = 0;
    for (const c of this.mem.concepts.values()) {
      if (!c.smell || !c.name) continue;
      const sim = cosine(c.smell, mix);
      if (sim > bs) { bs = sim; best = c; }
    }
    if (best && bs > 0.88) {
      this.mem.trace('smell:' + best.id, this.t, 8, 0.8);
      const food = this.foodValue(best);
      const visible = this.percepts.some((p) => p.c === best);
      const c = best;
      if (food > FOOD_T && !visible) {
        this.focusOn('smell', c.name!, undefined);
        this.think('SMELL_RECALL', 0.5 + food, () => this.voice.join(this.rng.chance(0.5) ? this.voice.move('SMELL_GOOD', {}) : null, this.voice.move('SMELL_RECALL', { label: c.name })));
      } else if (this.harmValue(c) + this.sickValue(c) > 0.3) {
        this.think('SMELL_BAD', 0.6, () => this.voice.move('SMELL_BAD', { label: c.name }));
      }
    } else if (s > 0.35 && bs < 0.6 && !this.knownSmells.some((k) => cosine(k, mix) > 0.85)) {
      this.knownSmells.push(mix.slice());
      this.think('SMELL_NEW', 0.5, () => this.voice.move('SMELL_NEW', {}));
    }
    void dt;
  }

  // ======================================================================= hearing

  private hear(f: PerceptFrame) {
    for (const s of f.sounds) {
      if (s.speech && s.onset) {
        this.lastSpeech = { text: s.speech.text, speaker: s.speech.speaker, t: this.t };
        this.lastHeardWords = new Set(s.speech.text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/'/g, '')));
        this.focusOn('speech', `"${s.speech.text}"`, s.speech.speaker);
        this.mem.remember(this.stamp, 'heard', { text: s.speech.text, arousal: 0.4 });
        const answer = this.dialogue.hear(s.speech.text, s.speech.speaker, s.bearingDeg);
        if (answer) {
          const delay = 0.5 + this.rng.range(0, 0.9) + (this.behavior.name === 'flee' ? 3 : 0);
          this.speakQueue.push({ text: answer, at: this.t + delay, loud: 0.5 });
          this.mem.remember(this.stamp, 'talked', { text: answer, arousal: 0.3 });
        }
      } else if (s.onset && !s.speech && s.loudness > 0.06) {
        this.mem.trace('sound:' + Math.round(s.sig[0] * 5), this.t, 4, 0.7);
        if (s.loudness > 0.15 && f.startle < 0.2) this.think('HEAR_NEW', 0.45, () => this.voice.move('HEAR_NEW', {}));
      }
    }
    if (f.startle > 0.5) this.think('STARTLE', 0.8, () => this.voice.move('STARTLE', {}), { aloud: true });
  }

  // ======================================================================= touch and taste: per-sense measurements

  private touchAndTaste(f: PerceptFrame) {
    for (const t of f.touch) {
      const c = this.conceptOfNode(t.node);
      if (!c || t.where === 'body') continue;
      for (const [k, v] of Object.entries(t.props)) {
        if (!v) continue;
        c.touch[k] = v;
        this.mem.add(c.id, 'feels', v, 'felt', this.t);
      }
      c.touched = true;
      this.noticed.add(t.node);
      const tex = t.props.texture && TEXTURE_WORDS[t.props.texture];
      if (tex) this.think('FEEL', 0.6, () => this.voice.move('FEEL', { tex }), { force: true });
    }
    for (const t of f.taste) {
      const c = this.conceptOfNode(t.node);
      const sweet = t.sig[0], bitter = t.sig[1], sour = t.sig[2];
      // innate taste reactions are the only built-in food knowledge
      const word = sweet > 0.5 ? 'sweet' : bitter > 0.4 ? 'bitter' : sour > 0.5 ? 'sour' : '';
      const liking = sweet * 1.0 - bitter * 0.9 - sour * 0.3;
      if (c) {
        c.taste = t.sig.slice();
        c.tasted = true;
        if (word) this.mem.add(c.id, 'tastes', word, 'tasted', this.t);
        // innate prior: sweet promises food, bitter warns. Experience (digestion) then confirms or overturns it.
        const v = this.mem.value('taste:' + c.id);
        if (liking > 0.3 && v.food < 0.3 * liking) v.food = 0.3 * liking;
        if (liking < -0.3) v.food = Math.min(v.food, 0);
        this.mem.trace('taste:' + c.id, this.t, t.swallowed ? 120 : 6, 1);
        if (t.swallowed) this.lastSwallowed = { c: c.id, t: this.t };
        this.mem.remember(this.stamp, t.swallowed ? 'ate' : 'tasted', { concept: c.id, valence: liking, arousal: 0.4 });
      }
      this.behavior.data.lastTaste = liking;
      if (t.texture === 'wet') continue;
      if (liking > 0.3) this.think('TASTE_GOOD', 0.9, () => this.voice.move('TASTE_GOOD', { taste: word || undefined }), { force: true, aloud: this.rng.chance(0.4) });
      else if (liking < -0.2) this.think('TASTE_BAD', 0.9, () => this.voice.move('TASTE_BAD', { taste: word || undefined }), { force: true, aloud: this.rng.chance(0.4) });
      else this.think('TASTE_MEH', 0.6, () => this.voice.move('TASTE_MEH', {}));
    }
  }

  // ======================================================================= appraisal and feelings (blueprint 7)

  harmValue(c?: Concept): number { return c ? this.mem.peekValue('see:' + c.id, 'harm') : 0; }
  sickValue(c?: Concept): number { return c ? Math.max(this.mem.peekValue('taste:' + c.id, 'sick'), this.mem.peekValue('smell:' + c.id, 'sick')) : 0; }
  foodValue(c?: Concept): number {
    if (!c) return 0;
    const v = Math.max(this.mem.peekValue('taste:' + c.id, 'food'), this.mem.peekValue('see:' + c.id, 'food') * 0.8, this.mem.peekValue('smell:' + c.id, 'food') * 0.7);
    return v - this.sickValue(c) * 1.5;
  }
  waterValue(c?: Concept): number { return c ? Math.max(this.mem.peekValue('taste:' + c.id, 'water'), this.mem.peekValue('see:' + c.id, 'water')) : 0; }

  threatOf(p: Percept): number {
    let th = this.harmValue(p.c) * clamp01(p.angleDeg / 3 + 0.3);
    if (p.c) for (const k of this.mem.concepts.values()) if (k !== p.c && this.harmValue(k) > 0.2) th = Math.max(th, cosine(p.embedding, k.proto) * this.harmValue(k) * 0.7);
    // innate biases: things coming at it fast, falling, big and sudden
    th += 0.45 * Math.tanh(p.loomingDps / 25) * (p.falling ? 1.5 : 1);
    if (p.falling && p.distance < 1.2) th += 0.25;
    if (p.selfMoving && p.angleDeg > 25 && p.speedDps > 20) th += 0.25;
    return th;
  }

  private appraise(f: PerceptFrame, dt: number) {
    let threat = 0, threatNode: string | undefined;
    let novelty = 0;
    for (const p of this.percepts) {
      const th = this.threatOf(p);
      if (th > threat) { threat = th; threatNode = p.node; }
      if (p.offCenterDeg < 20) novelty = Math.max(novelty, p.novelty * clamp01(p.angleDeg / 4));
    }
    if (threat > 0.5 && this.harmValue(this.percept(threatNode)?.c) > 0.2) this.lastHarmPredicted = this.t;
    const fl = this.feelings, tm = this.temper;
    fl.fear = clamp01(leak(fl.fear, 0, 4, (threat * tm.fearfulness * 1.6 + f.body.pain * 1.2 + f.startle * 0.8) * (threat > 0.4 || f.body.pain > 0.1 || f.startle > 0.3 ? 1 : 0), dt));
    fl.curiosity = clamp01(leak(fl.curiosity, 0.3, 6, novelty * tm.curiosity * 0.8 - fl.fear * 0.3 - this.drives.hunger * 0.15, dt));
    fl.arousal = clamp01(leak(fl.arousal, 0.15, 5, fl.fear * 0.8 + novelty * 0.25 + f.body.pain + f.startle * 0.6 + (f.proprio.speed > 0.2 ? 0.1 : 0), dt));
    fl.valence = Math.max(-1, Math.min(1, leak(fl.valence, 0.1, 20, -f.body.pain - fl.fear * 0.3 - this.drives.hunger * 0.08 - f.body.nausea * 0.5, dt)));
    this.boredom = clamp01(leak(this.boredom, 0, 40, novelty < 0.15 && fl.fear < 0.1 ? 0.03 : -0.05, dt));
    this.behavior.data.threat = threat;
    this.behavior.data.threatNode = threatNode;
  }

  mood(): string {
    const fl = this.feelings;
    if (fl.fear > 0.45) return 'scared';
    if (this.frame?.body.pain > 0.3) return 'hurt';
    if (this.drives.hunger > 0.65) return 'hungry';
    if (fl.curiosity > 0.5) return 'curious';
    if (fl.valence > 0.4) return 'happy';
    return 'calm';
  }

  // ======================================================================= eyes: scan, lock, track, release (blueprint 5.2)

  private salienceOf(p: Percept): number {
    const fl = this.feelings, d = this.drives;
    const motion = Math.tanh(p.speedDps / 25) * (1 + fl.arousal * 0.6);
    const loom = Math.tanh(p.loomingDps / 8) * 1.5 * (1 + fl.arousal * 0.5);
    const central = 0.5 / (1 + p.offCenterDeg / 8);
    const size = 0.3 * Math.tanh(p.angleDeg / 12);
    let goal = 0;
    if (p.c) {
      goal += d.hunger * Math.max(0, this.foodValue(p.c)) * 1.5 + d.thirst * this.waterValue(p.c) * 1.5;
      if (this.mem.pendingChecks.some((pc) => pc.concept === p.c!.id || (p.parent && this.conceptOfNode(p.parent)?.id === pc.concept))) goal += 0.9;
    }
    if (d.hunger > 0.4 && !p.c && p.angleDeg < 8 && !p.selfMoving) goal += d.hunger * 0.3; // small unknown things might be food
    const learned = p.c ? this.harmValue(p.c) * 1.2 * (1 + fl.fear) + Math.max(0, this.foodValue(p.c)) * 0.6 : 0;
    const last = this.lastLooked.get(p.node);
    const already = last !== undefined ? -1.0 * Math.exp(-(this.t - last) / 3) : 0;
    let bonus = 0;
    const bt = this.behavior.target;
    if (bt && (p.node === bt || p.parent === bt || p.node.startsWith(bt + '/'))) bonus += p.node === bt ? 0.5 : 0.35;
    if (p.selfMoving) bonus += 0.2;
    if (p.props?.color && BRIGHT.has(p.props.color)) bonus += 0.25 + d.hunger * 0.3; // innate: bright colours stand out
    if (this.lastSpeech && this.t - this.lastSpeech.t < 4 && p.node === this.lastSpeech.speaker) bonus += 1.2;
    return motion * 1.0 + loom + p.novelty * 0.8 * this.temper.curiosity + central + size + goal + learned + already + bonus + this.rng.gauss() * 0.12;
  }

  private gaze(f: PerceptFrame, dt: number) {
    const e = this.eye;
    for (const p of this.percepts) p.salience = this.salienceOf(p);
    const thinking = this.t < this.thinkingUntil;

    if (e.locked && e.target) {
      const p = this.percept(e.target);
      if (!p) e.lostT += dt; else e.lostT = 0;
      e.lockT += dt;
      // interest drains unless something new keeps refilling it
      const behaviorHold = this.behavior.target && (this.behavior.target === e.target || e.target.startsWith(this.behavior.target + '/')) ? 0.5 : 0;
      const need = p?.c ? this.drives.hunger * Math.max(0, this.foodValue(p.c)) : 0;
      const gain = e.infoGain + (p ? Math.tanh(p.speedDps / 40) * 0.25 : 0) + need * 0.4 + behaviorHold + (p ? p.novelty * 0.15 : 0);
      e.infoGain *= Math.exp(-dt / 0.8);
      e.interest = clamp01(leak(e.interest, 0, 3, gain, dt));
      const rival = this.percepts.filter((q) => q.node !== e.target && !q.node.startsWith(e.target + '/')).reduce((m, q) => Math.max(m, q.salience), 0);
      const cur = p?.salience ?? 0;
      const interrupted = rival > cur + 0.85 + e.interest * 0.5;
      if (e.lostT > 0.4 || e.interest < 0.2 || (e.lockT > e.maxDwell && !behaviorHold) || interrupted) {
        this.release(interrupted ? 'interrupted' : e.lostT > 0.4 ? 'lost' : e.interest < 0.2 ? 'bored' : 'dwell');
      } else {
        e.mode = p && p.speedDps > 3 ? 'pursue' : 'fixate';
        // studying a thing: the eyes jump between its parts (and back to the whole) while the lock holds
        e.innerT -= dt;
        if (e.innerT <= 0 && p && !p.selfMoving) {
          e.innerT = this.rng.range(0.35, 1.1);
          const whole = p.parent && this.behavior.target && !p.node.startsWith(this.behavior.target + '/') ? p : this.percept(this.behavior.target) ?? p;
          const parts = this.percepts.filter((q) => q.parent === whole.node || (q.parent && q.parent.startsWith(whole.node + '/')));
          if (parts.length) {
            const opts = [{ item: whole, score: 0.3 }, ...parts.map((q) => ({ item: q, score: (this.noticed.has(q.node) ? 0 : 0.6) + q.salience * 0.3 }))];
            const pick = choose(opts, 0.3, this.rng);
            if (pick && pick.item.node !== e.target) { e.target = pick.item.node; e.lostT = 0; }
          }
        }
      }
      if (p) this.focusOn('sight', p.c?.name ?? describe(p.props?.looks, p.props?.color, p.props?.sizeWord), p.node);
      return;
    }

    // scanning: the eyes are never still. They jump every 200–600 ms to a sampled target.
    e.nextSaccade -= dt * (thinking ? 0.5 : 1);
    if (e.nextSaccade > 0) return;
    e.nextSaccade = this.rng.range(0.2, 0.6);
    const opts = this.percepts.filter((p) => p.angleDeg > 0.2).map((p) => ({ item: p as Percept | null, score: p.salience }));
    opts.push({ item: null, score: 0.35 });
    const pick = choose(opts, 0.25, this.rng);
    if (!pick || !pick.item) {
      // an empty glance somewhere around where the head points
      e.target = undefined;
      e.mode = 'scan';
      e.scanYaw = f.proprio.headingDeg + this.rng.range(-55, 55);
      e.scanPitch = this.rng.range(-25, 12);
      return;
    }
    const p = pick.item;
    e.target = p.node;
    // motion makes a lock likely, never certain; something near the centre with any salience can capture
    const lockP = sigmoid((p.salience - 1.0) * 4) * 0.9 + (p.offCenterDeg < 3 && p.salience > 0.5 ? 0.25 : 0);
    if (this.rng.chance(clamp01(lockP))) {
      e.locked = true;
      e.lockT = 0;
      e.lostT = 0;
      e.interest = clamp01(0.5 + 0.25 * p.salience);
      e.maxDwell = this.rng.range(1.5, 8);
      e.nameDelay = this.rng.range(0.9, 2.0);
      e.mode = p.speedDps > 3 ? 'pursue' : 'fixate';
      this.stance = undefined;
      if (p.c) { p.c.familiarity += 0.2; this.mem.instanceConcept.set(p.node, { c: p.c.id, t: this.t }); }
    } else {
      e.mode = 'fixate'; // a glance without locking
    }
  }

  private release(why: string) {
    const e = this.eye;
    if (e.target) {
      this.lastLooked.set(e.target, this.t);
      const p = this.percept(e.target);
      if (p?.c && e.lockT > 0.6) {
        this.mem.remember(this.stamp, 'saw', { concept: p.c.id, arousal: 0.2 + p.novelty * 0.3, strength: Math.min(1, e.lockT / 4) });
        this.mem.updateProto(p.c, p.embedding, 0.05);
      }
    }
    e.locked = false;
    e.target = undefined;
    e.mode = 'scan';
    e.nextSaccade = this.rng.range(0.1, 0.3);
    e.interest = 0;
    this.behavior.data.lastRelease = why;
  }

  /** Force the eyes onto something (a threat, a speaker, what hit it). */
  private lookAt(node: string, interest = 0.8) {
    const e = this.eye;
    if (e.target === node && e.locked) return;
    e.target = node;
    e.locked = true;
    e.lockT = 0;
    e.lostT = 0;
    e.interest = interest;
    e.maxDwell = this.rng.range(2, 5);
    e.mode = 'fixate';
  }

  // ======================================================================= noticing details (blueprint 5.1, 5.8)

  private noticeDetails(f: PerceptFrame, dt: number) {
    const e = this.eye;
    if (!e.locked || !e.target) { this.dwell.clear(); return; }
    const target = this.percept(e.target);
    if (!target || target.level === 'detected') return;
    // the fixated thing itself is measured once it has held the gaze briefly
    if (e.lockT > 0.3) this.measureWhole(target);
    // its parts (and the parts of what it is part of, near the gaze) can be noticed with enough dwell
    const root = target.node;
    for (const p of this.percepts) {
      if (!p.parent) continue;
      const related = p.node.startsWith(root + '/') || (target.parent && p.parent === target.parent && p.offCenterDeg < 4);
      if (!related || this.noticed.has(p.node)) continue;
      if (p.offCenterDeg > 8 && !p.node.startsWith(root + '/')) continue;
      const d = (this.dwell.get(p.node) ?? 0) + dt;
      this.dwell.set(p.node, d);
      if (d < p.needDwell) continue;
      const chance = Math.min(0.95, 1.4 * (p.margin - 1) + 0.15) * dt * 2;
      if (this.rng.chance(chance)) this.noticePart(p);
    }
  }

  private measureWhole(p: Percept) {
    if (!this.noticed.has(p.node) && !p.parent) this.noticed.add(p.node);
    const c = p.c;
    if (!c) return;
    c.maxAngle = Math.max(c.maxAngle, p.angleDeg);
    if (p.props?.looks) { c.props.looks = p.props.looks; this.mem.add(c.id, 'has_looks', p.props.looks, 'seen', this.t); }
    if (p.props?.color) { c.props.color = p.props.color; this.mem.add(c.id, 'has_color', p.props.color, 'seen', this.t); }
    if (p.props?.texture) { c.props.texture = p.props.texture; this.mem.add(c.id, 'has_texture', p.props.texture, 'seen', this.t); }
    if (p.props?.sizeWord) c.props.sizeWord = p.props.sizeWord;
    if (p.relation?.to === 'ground') this.mem.add(c.id, 'rel:' + p.relation.type, 'ground', 'seen', this.t);
    if (p.parent) {
      const pc = this.conceptOfNode(p.parent);
      if (pc) this.mem.add(c.id, 'part_of', pc.id, 'seen', this.t);
    }
    if (p.words && !c.coarse) c.offered = p.words;
  }

  private noticePart(p: Percept) {
    this.noticed.add(p.node);
    this.eye.infoGain += 0.6;
    const parentC = p.parent ? this.conceptOfNode(p.parent) : undefined;
    let c = p.c;
    if (!c) {
      const r = this.mem.recognize(p.embedding, true, parentC?.id);
      c = r.score > 0.8 && r.c ? r.c : this.mem.newConcept(p.embedding, this.stamp, true);
      this.recogCache.set(p.node, { c, score: Math.max(0.86, r.score), t: this.t });
      p.c = c;
    }
    this.mem.instanceConcept.set(p.node, { c: c.id, t: this.t });
    c.familiarity += 0.3;
    this.measureWhole(p);
    if (parentC) this.mem.add(c.id, 'part_of', parentC.id, 'seen', this.t);
    if (p.relation) {
      const toC = p.relation.to === 'ground' ? 'ground' : this.conceptOfNode(p.relation.to)?.id;
      if (toC) this.mem.add(c.id, 'rel:' + p.relation.type, toC, 'seen', this.t);
    }
    this.mem.remember(this.stamp, 'noticed', { concept: c.id, other: parentC?.id, arousal: 0.35 });
    // a pending check resolves: "oh you was right"
    for (const pc of [...this.mem.pendingChecks]) {
      const matches = (p.words ?? []).some((w) => pc.part === w || pc.part + 's' === w || pc.part === w + 's') && (!pc.concept || pc.concept === parentC?.id || this.isPartOfConcept(parentC, pc.concept));
      if (matches) {
        this.mem.pendingChecks.splice(this.mem.pendingChecks.indexOf(pc), 1);
        const part = pc.part;
        if (!c.name && p.words) this.commitName(c, p, part);
        this.think('TOLD_CONFIRMED', 1, () => this.voice.move('TOLD_CONFIRMED', { part }), { force: true, aloud: true });
        return;
      }
    }
    // a part whose word already names something it knows is that same kind of thing
    const known = p.words?.map((w) => this.mem.byWord(w)).find((k) => k && k !== c);
    if (known && !c.name) {
      this.mergeInto(c, known);
      this.recogCache.set(p.node, { c: known, score: 0.9, t: this.t });
      this.mem.instanceConcept.set(p.node, { c: known.id, t: this.t });
      if (parentC) this.mem.add(known.id, 'part_of', parentC.id, 'seen', this.t);
      return;
    }
    // if the whole already has a name, a newly noticed part becomes a thought of its own
    if (parentC?.name && !c.name) {
      const rel = p.relation ? relationPhrase(p.relation.type, this.relTarget(p.relation.to, p.parent)) : '';
      const desc = describe(p.props?.looks, undefined, undefined, true);
      const label = this.pickWord(p.words);
      this.think('NOTICE_DETAIL', 0.9, () => {
        if (!label) return this.voice.move('NOTICE_DETAIL', { desc, rel });
        this.commitName(c!, p, label);
        return this.voice.join(this.voice.move('NOTICE_DETAIL', { desc, rel }), this.voice.move(pluralish(p.props?.looks, label) ? 'NOTICE_NAME_PLURAL' : 'NOTICE_NAME', { label: isPlural(p.props?.looks) ? plural(label) : label }));
      }, { force: true });
    }
  }

  private isPartOfConcept(c: Concept | undefined, whole: string): boolean {
    if (!c) return false;
    return c.id === whole || this.mem.has(c.id, 'part_of', whole) || this.mem.has(c.id, 'kind_of', whole);
  }

  private relTarget(to: string, parentNode?: string): string {
    if (to === 'ground') return 'ground';
    if (to === parentNode) return 'it';
    const c = this.conceptOfNode(to);
    if (c?.name) return 'the ' + c.name;
    const p = this.percept(to);
    return p?.props ? 'the ' + describe(p.props.looks, undefined, undefined, false) : 'it';
  }

  // ======================================================================= naming (blueprint 8.3)

  private pickWord(words?: string[]): string | undefined {
    if (!words?.length) return undefined;
    // weighted choice: the first listed word is the most natural
    const opts = words.map((w, i) => ({ item: w, score: -i * 0.8 }));
    return choose(opts, 0.5, this.rng)?.item;
  }

  private commitName(c: Concept, p: Percept, word: string) {
    // the same word already names a concept: this is the same kind of thing
    const existing = this.mem.byWord(word);
    if (existing && existing !== c) {
      existing.proto = blend(existing.proto, p.embedding, 0.2);
      this.mergeInto(c, existing);
      this.recogCache.set(p.node, { c: existing, score: 0.9, t: this.t });
      this.mem.instanceConcept.set(p.node, { c: existing.id, t: this.t });
      return existing;
    }
    c.name = word;
    for (const w of p.words ?? []) if (w !== word) c.aliases.add(w);
    c.coarse = !!(p.words && p.words.length && this.isCoarseView(p));
    this.mem.remember(this.stamp, 'named', { concept: c.id, text: word, arousal: 0.5 });
    return c;
  }

  private isCoarseView(p: Percept): boolean {
    // the world offers coarse words from far; the mind cannot know that, but it can tell the view was poor
    return p.level === 'identified' && p.angleDeg < 3.5 && !!p.selfMoving;
  }

  private mergeInto(from: Concept, into: Concept) {
    if (from === into) return;
    for (const f of [...this.mem.facts.values()]) {
      if (f.s === from.id || f.o === from.id) {
        this.mem.facts.delete(this.mem.key(f.s, f.r, f.o));
        const s = f.s === from.id ? into.id : f.s, o = f.o === from.id ? into.id : f.o;
        for (const src of f.sources) this.mem.add(s, f.r, o, src, f.last);
      }
    }
    into.familiarity += from.familiarity;
    into.sightings.push(...from.sightings);
    into.touched ||= from.touched;
    into.tasted ||= from.tasted;
    Object.assign(into.touch, from.touch);
    for (const [k, v] of this.mem.instanceConcept) if (v.c === from.id) v.c = into.id;
    for (const [k, v] of this.recogCache) if (v.c === from) this.recogCache.set(k, { ...v, c: into });
    this.mem.concepts.delete(from.id);
  }

  private maybeName(f: PerceptFrame, dt: number) {
    const e = this.eye;
    if (!e.locked || !e.target || e.lockT < e.nameDelay) return;
    const p = this.percept(e.target);
    if (!p || p.level === 'detected' || !p.words?.length) return;
    // refinement: a thing first named from far, now seen up close with a better word
    if (p.c?.name && p.c.coarse && !p.words.includes(p.c.name) && p.angleDeg > 4) {
      const coarse = p.c;
      const nc = this.mem.newConcept(p.embedding, this.stamp, coarse.isPart);
      const label = this.pickWord(p.words)!;
      nc.name = label;
      nc.kindOf = coarse.id;
      this.mem.add(nc.id, 'kind_of', coarse.id, 'inferred', this.t);
      coarse.coarse = false;
      this.recogCache.set(p.node, { c: nc, score: 0.9, t: this.t });
      this.mem.instanceConcept.set(p.node, { c: nc.id, t: this.t });
      p.c = nc;
      this.measureWhole(p);
      this.think('REFINE', 1, () => this.voice.move('REFINE', { coarse: coarse.name, label }), { force: true });
      return;
    }
    if (p.c?.name) return;
    if (p.c && !p.c.name && p.c.familiarity > 2 && !this.lastThought.has('UNNAMED_AGAIN:' + p.c.id)) {
      this.lastThought.set('UNNAMED_AGAIN:' + p.c.id, this.t);
      this.think('UNNAMED_AGAIN', 0.6, () => this.voice.move('UNNAMED_AGAIN', {}));
    }
    // NAME_IT may fire: weighted by curiosity, never guaranteed
    const rate = (0.5 + this.feelings.curiosity) * (this.feelings.fear > 0.5 ? 0.2 : 1);
    if (!this.rng.chance(rate * dt * 1.2)) return;
    this.nameIt(p);
  }

  private nameIt(p: Percept) {
    let c = p.c;
    if (!c) {
      c = this.mem.newConcept(p.embedding, this.stamp, !!p.parent);
      p.c = c;
      this.recogCache.set(p.node, { c, score: 0.9, t: this.t });
    }
    this.mem.instanceConcept.set(p.node, { c: c.id, t: this.t });
    this.measureWhole(p);
    const label = this.pickWord(p.words)!;
    // describe first: only measured parts appear in the description
    const parts = this.percepts.filter((q) => q.parent === p.node && this.noticed.has(q.node));
    const seenKeys = new Set<string>();
    const uniqParts = parts.filter((q) => { const k = (q.words ?? [])[0] ?? q.node; if (seenKeys.has(k)) return false; seenKeys.add(k); return true; });
    const desc = describe(p.props?.looks, p.props?.color, p.props?.sizeWord);
    const partDescs = uniqParts.slice(0, 3).map((q) => {
      const rel = q.relation ? ' ' + relationPhrase(q.relation.type, this.relTarget(q.relation.to, p.node)) : '';
      return describe(q.props?.looks, undefined, undefined, !isPlural(q.props?.looks)).replace(/^some /, isPlural(q.props?.looks) ? 'more ' : 'some ') + rel;
    });
    const named = this.commitName(c, p, label);
    if (named !== c) {
      // it turned out to be a kind of thing it already knew
      const n = named;
      this.think('RECOGNIZE', 0.8, () => this.voice.move('RECOGNIZE', { label: n.name }), { force: true });
      return;
    }
    // compare: a shared colour with something it knows
    let compare: string | null = null;
    if (p.props?.color) {
      const ref = this.mem.objectsOf('has_color', p.props.color).map((f) => this.mem.concepts.get(f.s)).find((k) => k && k !== c && k.name);
      if (ref) compare = this.voice.move('COMPARE', { ref: ref.name, color: p.props.color });
    }
    const partCommits: string[] = [];
    for (const q of uniqParts.slice(0, 3)) {
      const qc = q.c ?? this.conceptOfNode(q.node);
      const w = this.pickWord(q.words);
      if (!qc || !w || qc.name) continue;
      const named2 = this.commitName(qc, q, w);
      if (named2 !== qc) continue;
      const pd = describe(q.props?.looks, undefined, undefined, false);
      const line = this.voice.move(pluralish(q.props?.looks, w) ? 'COMMIT_PART_PLURAL' : 'COMMIT_PART', { desc: pd, label: isPlural(q.props?.looks) ? plural(w) : w });
      if (line) partCommits.push(line);
    }
    this.eye.infoGain += 0.8;
    const mood = this.mood();
    const wholePart = p.parent ? this.conceptOfNode(p.parent) : undefined;
    if (wholePart) this.mem.add(c.id, 'part_of', wholePart.id, 'seen', this.t);
    this.think('NAME_IT', 1, () =>
      this.voice.join(
        this.voice.move('WONDER', {}, mood),
        p.angleDeg > 6 && this.rng.chance(0.4) ? this.voice.move('LOOK_CLOSE', {}) : null,
        this.voice.move('DESCRIBE', { desc }) + (partDescs.length ? (desc.includes(' with ') ? ' and ' : ' with ') + listPhrase(partDescs) : ''),
        this.rng.chance(0.7) ? this.voice.move('DECIDE_NAME', {}) : null,
        this.voice.move(pluralish(p.props?.looks, label) ? 'COMMIT_PLURAL' : 'COMMIT', { label: isPlural(p.props?.looks) ? plural(label) : label }),
        ...partCommits,
        compare,
      ), { force: true });
  }

  // ======================================================================= spontaneous thoughts

  private idleThoughts(f: PerceptFrame, dt: number) {
    if (this.feelings.fear > 0.3 || this.eye.locked || this.behavior.name === 'sleep') return;
    if (!this.rng.chance(dt * 0.025 * this.temper.talkativeness)) return;
    // mind-wandering: a strong memory surfaces on its own
    const eps = this.mem.episodes.filter((e) => e.concept && (e.kind === 'ate' || e.kind === 'hurt') && this.t - e.stamp.t > 30);
    if (!eps.length) return;
    const e = this.rng.pick(eps);
    const c = this.mem.concepts.get(e.concept!);
    if (!c?.name) return;
    if (e.kind === 'ate' && this.foodValue(c) > 0.1) this.think('IDLE_RECALL', 0.6, () => this.voice.move('IDLE_RECALL', { label: c.name }));
    else if (e.kind === 'hurt') this.think('IDLE_HARM', 0.6, () => this.voice.move('IDLE_HARM', { label: c.name }));
  }

  // ======================================================================= behavior selection (blueprint 9.2)

  private chooseBehavior(f: PerceptFrame, dt: number) {
    for (const [k, t] of this.unreachable) if (this.t - t > 40) this.unreachable.delete(k);
    const b = this.behavior;
    if (b.until && this.t < b.until) return;
    if (this.t - b.since < 0.5 && b.name !== 'wander') return;
    const d = this.drives, fl = this.feelings;
    const opts: { item: Behavior; score: number }[] = [];
    // persistence: what it is already doing gets a bonus, so it does not flip-flop (blueprint 17)
    const mk = (name: string, score: number, target?: string, data: Record<string, any> = {}) =>
      opts.push({ item: { name, target, since: this.t, data }, score: score + (b.name === name ? 0.4 + (b.target === target ? 0.2 : 0) : 0) });

    mk('wander', 0.3 + 0.35 * this.boredom + 0.1 * fl.curiosity);
    // smell-following gives up after a while without finding anything, and rests before trying again
    if (b.name === 'follow_smell' && this.t - b.since > 25) this.smellCooldown = this.t + 20;
    const smellOk = this.t > this.smellCooldown;

    // threats: flee or freeze
    const threat = b.data.threat ?? 0;
    const tNode: string | undefined = b.data.threatNode;
    if (threat > 0.35 && tNode) mk('flee', fl.fear * 1.4 + threat * 1.2, tNode);
    if (f.startle > 0.4) mk('freeze', f.startle * 1.3);

    // keep inspecting the current target while it still has something to give
    if (b.name === 'inspect' && b.target) {
      const cur = this.percept(b.target);
      if (cur) {
        const left = this.percepts.filter((q) => q.node.startsWith(cur.node + '/') && !this.noticed.has(q.node)).length;
        const unnamed = !cur.c?.name;
        const spent = this.t - b.since > 25;
        if (!spent && (left > 0 || unnamed || this.t - b.since < 4)) mk('inspect', 0.5 + fl.curiosity * 0.6 + Math.min(3, left) * 0.12 + (unnamed ? 0.3 : 0) - fl.fear, cur.node);
      }
    }
    // finishing what it started: tasting, eating and drinking hold while the target is still there
    if ((b.name === 'taste' || b.name === 'eat' || b.name === 'drink') && b.target && this.t - b.since < 15 && !this.unreachable.has(b.target)) {
      const cur = this.percept(b.target);
      if (cur || b.name === 'drink') mk(b.name, 0.4 + (b.name === 'drink' ? d.thirst : d.hunger) * 1.2, b.target, b.data);
    }
    // the thing in focus: watch it, inspect it, taste it
    const g = this.percept(this.eye.target);
    if (g && this.eye.locked && g.level === 'detected' && g.novelty > 0.3 && fl.fear < 0.3) mk('inspect', 0.25 + fl.curiosity * 0.5, g.node);
    if (g && this.eye.locked && g.level !== 'detected') {
      const unnoticedParts = this.percepts.filter((q) => q.node.startsWith(g.node + '/') && !this.noticed.has(q.node)).length;
      const nov = g.novelty + (g.c && !g.c.name ? 0.3 : 0);
      const insp = (0.25 + fl.curiosity * 1.1 * clamp01(nov + 0.15 * Math.min(3, unnoticedParts))) * (1 - fl.fear) * (g.selfMoving && g.angleDeg > 15 ? 0.5 : 1) * (1 - 0.6 * Math.max(d.hunger, d.thirst));
      mk('inspect', insp + (g.angleDeg < 6 ? 0.15 : -0.1), g.node);
      // hunger broadens the diet: a starving animal will try things it would normally ignore
      const small = 2 * g.distance * Math.tan((g.angleDeg * Math.PI) / 360) < (d.hunger > 0.55 ? 0.6 : 0.07);
      const rise = g.distance * Math.sin((g.elevationDeg * Math.PI) / 180);
      const reachable = rise < 0.08 && !this.unreachable.has(g.node);
      const food = this.foodValue(g.c);
      if (small && reachable && !g.selfMoving && (!g.c || !g.c.tasted) && d.hunger > 0.25) mk('taste', 0.3 + d.hunger * 1.1 * (1 - this.sickValue(g.c)), g.node);
      if (food > FOOD_T && d.hunger > 0.2 && reachable) mk('eat', 0.4 + d.hunger * 1.5 * food, g.node);
      if (this.waterValue(g.c) > 0.2 && d.thirst > 0.2) mk('drink', 0.5 + d.thirst * 1.5, g.node);
    }
    // known food or water in view, even if not in focus
    for (const p of this.percepts) {
      if (!p.c || p.level === 'detected') continue;
      const fv = this.foodValue(p.c);
      if (fv > FOOD_T && d.hunger > 0.3 && !this.unreachable.has(p.node) && p.distance * Math.sin((p.elevationDeg * Math.PI) / 180) < 0.08) mk('eat', 0.3 + d.hunger * 1.3 * fv - p.distance * 0.1, p.node);
      if (this.waterValue(p.c) > 0.2 && d.thirst > 0.3) mk('drink', 0.3 + d.thirst * 1.4 - p.distance * 0.05, p.node);
    }
    // innate: a flat shiny thing or the smell of wet draws a thirsty animal
    if (d.thirst > 0.3) {
      const shiny = this.percepts.find((p) => p.props?.looks === 'flat_shiny');
      if (shiny) mk('drink', 0.3 + d.thirst * 1.2, shiny.node);
      else if (smellOk && f.smell.mix[7] > 0.08) mk('follow_smell', 0.2 + d.thirst * 0.9, undefined, { want: 'water' });
    }
    const knownFood = this.bestPlace((c) => this.foodValue(c));
    if (smellOk && d.hunger > 0.3 && f.smell.mix[0] > 0.08 && !knownFood && !this.percepts.some((p) => this.foodValue(p.c) > FOOD_T)) mk('follow_smell', 0.25 + d.hunger * 0.8, undefined, { want: 'food' });
    // remembered food or water out of sight
    if (d.hunger > 0.35) {
      const place = this.bestPlace((c) => this.foodValue(c));
      const visibleFood = this.percepts.some((p) => this.foodValue(p.c) > FOOD_T);
      if (place && !visibleFood) mk('seek', 0.3 + d.hunger * 1.2, undefined, { pos: place.pos, label: place.c.name, want: 'food' });
    }
    if (d.thirst > 0.35) {
      const place = this.bestPlace((c) => this.waterValue(c) + (c.name === 'water' ? 0.3 : 0));
      if (place) mk('seek', 0.2 + d.thirst * 1.2, undefined, { pos: place.pos, label: place.c.name, want: 'water' });
    }
    // rest and shelter
    const shelter = this.bestPlace((c) => (this.mem.has(c.id, 'affords', 'shelter') || c.props.looks === 'tube_hollow' ? 1 : 0));
    const shelterNode = shelter ? [...this.mem.instanceConcept].find(([, v]) => v.c === shelter.c.id)?.[0] : undefined;
    if (d.rest > 0.55 && shelter && !f.proprio.inShelter) mk('shelter', 0.2 + d.rest * 1.1 + d.comfort * 0.4, shelterNode, { pos: shelter.pos, label: shelter.c.name });
    // sleep where it is safe; out in the open only when exhausted
    if (d.rest > 0.6 && (f.proprio.inShelter || d.rest > (shelter ? 0.98 : 0.9))) mk('sleep', 0.4 + d.rest * 1.2 + (f.proprio.inShelter ? 0.5 : 0));
    else if (d.rest > 0.5) mk('rest', d.rest * 0.8);
    // someone talking
    if (this.lastSpeech && this.t - this.lastSpeech.t < 5) mk('listen', 0.95, this.lastSpeech.speaker);

    const T = d.hunger > 0.7 || fl.fear > 0.6 ? 0.1 : 0.3;
    const pick = choose(opts, T, this.rng);
    if (!pick) return;
    const nb = pick.item;
    if (nb.name === b.name && nb.target === b.target) { b.until = this.t + 0.5; return; }
    // behaviors commit for a moment once chosen
    const commit: Record<string, number> = { freeze: 0.8, flee: 1.4, eat: 2.5, taste: 3, drink: 3, seek: 3, follow_smell: 3, inspect: 1.5, wander: 1.5, listen: 2, shelter: 3 };
    nb.until = this.t + (commit[nb.name] ?? 1);
    if (nb.name === 'flee') {
      this.mem.remember(this.stamp, 'fled', { concept: this.conceptOfNode(nb.target!)?.id, arousal: 0.8, valence: -0.4 });
      const c = this.conceptOfNode(nb.target!);
      if (c && this.harmValue(c) > 0.2) this.think('THREAT', 0.9, () => this.voice.move('THREAT', { label: c.name }), { aloud: this.rng.chance(0.5) });
    }
    if (nb.name === 'sleep') { this.sleepStart = this.t; this.think('SLEEP', 0.7, () => this.voice.move('SLEEP', {})); }
    if (b.name === 'sleep' && nb.name !== 'sleep') this.think('WAKE', 0.6, () => this.voice.move('WAKE', {}));
    if (nb.name === 'inspect' && opts.length > 2) {
      const sorted = opts.map((o) => o.score).sort((a, c) => c - a);
      if (sorted[0] - sorted[1] < 0.05) this.think('CONFLICT', 0.5, () => this.voice.move('CONFLICT', {}));
    }
    this.behavior = nb;
  }

  private bestPlace(score: (c: Concept) => number): { c: Concept; pos: { x: number; z: number } } | null {
    let best: { c: Concept; pos: { x: number; z: number } } | null = null, bs = FOOD_T;
    const me = this.frame.proprio.pos;
    for (const c of this.mem.concepts.values()) {
      const s = score(c);
      if (s <= FOOD_T) continue;
      for (const q of c.sightings) {
        const v = s - Math.hypot(q.x - me.x, q.z - me.z) * 0.03;
        if (v > bs) { bs = v; best = { c, pos: { x: q.x, z: q.z } }; }
      }
    }
    return best;
  }

  // ======================================================================= acting: behaviors become motor intents

  private act(f: PerceptFrame, dt: number): MotorIntent {
    const b = this.behavior, e = this.eye, fl = this.feelings;
    const intent: MotorIntent = {
      v: PROTOCOL_VERSION,
      gaze: { mode: e.mode, target: e.target, yawDeg: e.scanYaw, pitchDeg: e.scanPitch },
      locomotion: { mode: 'idle', speed: 0 },
      posture: { crouch: fl.fear * 0.5, earsFlat: fl.fear > 0.5 ? fl.fear : 0, tailUp: 0.2 + 0.5 * fl.curiosity - 0.4 * fl.fear, headDown: 0 },
      mouth: { action: 'none' },
      face: { pupil: fl.arousal, squint: f.body.pain * 0.8 + (f.body.nausea > 0.3 ? 0.4 : 0) },
      reflex: { withdrawGain: 1 + fl.fear, startleThreshold: 0.25 - fl.arousal * 0.1 },
      sleep: false,
    };
    // ears turn to the loudest recent sound
    const loud = f.sounds.reduce<null | (typeof f.sounds)[0]>((m, s) => (!m || s.loudness > m.loudness ? s : m), null);
    if (loud && loud.loudness > 0.03) intent.posture.earsBearingDeg = loud.bearingDeg;

    const tp = this.percept(b.target);
    switch (b.name) {
      case 'wander':
        intent.locomotion = { mode: 'wander', speed: 0.25 + 0.2 * fl.curiosity };
        if (this.rng.chance(dt * 0.08) && f.smell.strength > 0.15) intent.mouth = { action: 'sniff' };
        break;
      case 'inspect': {
        if (!tp) { this.behavior = { name: 'wander', since: this.t, data: {} }; break; }
        const size = 2 * tp.distance * Math.tan((tp.angleDeg * Math.PI) / 360);
        // close enough that its details fill the eye, hesitating when it is unfamiliar
        const stop = Math.max(0.035, Math.min(0.3, size * (size > 0.15 ? 0.9 : 2.0)));
        const hesitate = tp.novelty > 0.5 && fl.fear > 0.15 && this.rng.chance(0.3);
        intent.locomotion = { mode: 'approach', target: tp.node, speed: hesitate ? 0 : 0.35, stopAt: stop };
        intent.posture.headDown = tp.elevationDeg < -20 ? 0.8 : 0;
        intent.posture.crouch = Math.max(intent.posture.crouch, tp.elevationDeg < -25 ? 0.4 : 0);
        if (e.target !== tp.node && !e.target?.startsWith(tp.node + '/')) this.lookAt(tp.node, 0.7);
        // nose it once close: touch measures what vision cannot
        if (f.proprio.reach[tp.node] && !f.proprio.mouthBusy && tp.c && !tp.c.touched && !tp.selfMoving && this.rng.chance(dt * 0.8)) intent.mouth = { action: 'nose', target: tp.node };
        if (f.proprio.reach[tp.node] && !f.proprio.mouthBusy && this.rng.chance(dt * 0.4)) intent.mouth = { action: 'sniff' };
        if (!e.locked && this.t - b.since > 2) this.behavior = { name: 'wander', since: this.t, data: {} };
        break;
      }
      case 'taste':
      case 'eat': {
        if (!tp) { this.behavior = { name: 'wander', since: this.t, data: {} }; break; }
        intent.locomotion = { mode: 'approach', target: tp.node, speed: b.name === 'eat' ? 0.55 : 0.35, stopAt: 0.03 };
        intent.posture.headDown = tp.elevationDeg < -15 ? 0.8 : 0;
        if (e.target !== tp.node) this.lookAt(tp.node, 0.8);
        // frustration: give up on something it cannot get to
        if (this.t - b.since > 7 && !f.proprio.reach[tp.node]) {
          this.unreachable.set(tp.node, this.t);
          this.release('unreachable');
          this.behavior = { name: 'wander', since: this.t, until: this.t + 1.5, data: {} };
          break;
        }
        if (!tp.c && tp.level !== 'detected') {
          tp.c = this.mem.newConcept(tp.embedding, this.stamp, !!tp.parent);
          this.recogCache.set(tp.node, { c: tp.c, score: 0.9, t: this.t });
          this.mem.instanceConcept.set(tp.node, { c: tp.c.id, t: this.t });
          this.measureWhole(tp);
        }
        if (f.proprio.reach[tp.node] && !f.proprio.mouthBusy) {
          if (b.name === 'taste' && !b.data.licked) {
            intent.mouth = { action: 'lick', target: tp.node };
            b.data.licked = true;
            this.think('LICK', 0.6, () => this.voice.move('LICK', {}));
          } else if (b.name === 'taste' && b.data.licked && b.data.lastTaste !== undefined) {
            // bite or reject, weighted by how it tasted and how hungry it is
            const bite = sigmoid((b.data.lastTaste + this.drives.hunger * 0.8 - 0.2) * 5);
            if (this.rng.chance(bite)) { intent.mouth = { action: 'bite', target: tp.node }; this.behavior = { name: 'eat', target: tp.node, since: this.t, until: this.t + 1.2, data: {} }; }
            else { this.behavior = { name: 'wander', since: this.t, until: this.t + 2, data: {} }; this.release('rejected'); }
          } else if (b.name === 'eat') {
            intent.mouth = { action: 'bite', target: tp.node };
          }
        }
        break;
      }
      case 'drink': {
        const pond = tp?.node ?? b.target!;
        intent.locomotion = { mode: 'approach', target: pond, speed: 0.5, stopAt: 0.02 };
        intent.posture.headDown = 0.9;
        if (f.proprio.reach[pond] && !f.proprio.mouthBusy) intent.mouth = { action: 'drink', target: pond };
        if (this.drives.thirst < 0.05) this.behavior = { name: 'wander', since: this.t, until: this.t + 3, data: {} };
        break;
      }
      case 'seek':
      case 'shelter':
        intent.locomotion = b.name === 'shelter' && b.target ? { mode: 'approach', target: b.target, speed: 0.5, stopAt: 0.02 } : { mode: 'approach', pos: b.data.pos, speed: 0.5, stopAt: 0.15 };
        if (b.name === 'shelter' && f.proprio.inShelter) intent.locomotion = { mode: 'idle', speed: 0 };
        else if (b.name === 'seek' && Math.hypot(f.proprio.pos.x - b.data.pos.x, f.proprio.pos.z - b.data.pos.z) < 0.3) b.data.arrived = true;
        break;
      case 'follow_smell': {
        // compare sniffs a moment apart and turn when it gets weaker: the weaving, nose-down search path
        const dim = b.data.want === 'water' ? 7 : 0;
        const s = f.smell.mix[dim];
        if (b.data.yaw === undefined) { b.data.yaw = f.proprio.headingDeg; b.data.s0 = s; b.data.t0 = this.t; }
        if (this.t - b.data.t0 > 0.9) {
          const ds = s - b.data.s0;
          if (ds < -0.004) b.data.yaw = f.proprio.headingDeg + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(100, 160);
          else if (ds < 0.003) b.data.yaw += (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(25, 60);
          else b.data.yaw += this.rng.range(-8, 8);
          b.data.s0 = s;
          b.data.t0 = this.t;
        }
        // strong smell: slow down and look around for where it comes from
        const close = s > 0.7;
        intent.locomotion = { mode: 'heading', headingDeg: b.data.yaw, speed: close ? 0.12 : 0.25 };
        intent.posture.headDown = 0.6;
        if (this.rng.chance(dt * 1.5)) intent.mouth = { action: 'sniff' };
        break;
      }
      case 'flee':
        intent.locomotion = { mode: 'flee', target: b.target, speed: 1 };
        intent.posture.earsFlat = 1;
        if (b.target) this.lookAt(b.target, 0.9);
        break;
      case 'freeze':
        intent.locomotion = { mode: 'idle', speed: 0 };
        intent.posture.crouch = 0.7;
        break;
      case 'rest':
        intent.locomotion = { mode: 'idle', speed: 0 };
        intent.posture.crouch = 0.5;
        break;
      case 'sleep':
        intent.sleep = true;
        intent.posture.crouch = 0.9;
        intent.gaze = { mode: 'fixate' };
        if (this.t - this.sleepStart > 5 && this.rng.chance(dt * 0.1)) this.consolidate();
        if (this.drives.rest < 0.3 && f.time.hour >= 6 && f.time.hour < 20) this.behavior = { name: 'wander', since: this.t, data: {} };
        break;
      case 'listen': {
        intent.locomotion = { mode: 'idle', speed: 0 };
        const sp = this.percepts.find((p) => p.node === b.target || p.node.startsWith((b.target ?? '#') + '/'));
        if (sp) this.lookAt(sp.node, 0.8);
        else if (loud && loud.speech) { intent.gaze = { mode: 'scan', yawDeg: f.proprio.headingDeg + loud.bearingDeg, pitchDeg: 5 }; }
        break;
      }
    }

    // after something hit it, it looks at what did
    if (this.hurtBy && this.t - this.hurtBy.t < 1.5 && this.percept(this.hurtBy.node)) this.lookAt(this.hurtBy.node, 0.9);

    // relax harm values for things seen safely
    for (const p of this.percepts) if (p.c && p.offCenterDeg < 10 && f.body.pain < 0.01 && !p.falling) this.mem.relax('see:' + p.c.id, dt * 0.2);

    // speech that is ready goes out through the mouth
    const ready = this.speakQueue.findIndex((s) => s.at <= this.t);
    if (ready >= 0) {
      const s = this.speakQueue.splice(ready, 1)[0];
      intent.voice = { say: s.text, loudness: s.loud };
      this.newSpeech.push(s.text);
      if (s.echo !== false) this.newThoughts.push({ t: this.t, intent: 'SPEAK', text: s.text, mood: this.mood(), aloud: true });
    }

    intent.gaze.mode = this.eye.mode;
    intent.gaze.target = this.eye.target;
    if (!this.eye.target) { intent.gaze.yawDeg = this.eye.scanYaw; intent.gaze.pitchDeg = this.eye.scanPitch; }
    if (b.name === 'listen' && !this.eye.target && loud?.speech) { intent.gaze.yawDeg = f.proprio.headingDeg + loud.bearingDeg; intent.gaze.pitchDeg = 5; }
    return intent;
  }

  /** Sleep: replay the strongest recent episodes, firm up their facts, prune weak traces (blueprint 8.6). */
  private consolidate() {
    const recent = this.mem.episodes.filter((e) => this.t - e.stamp.t < 1500).sort((a, b) => b.strength - a.strength).slice(0, 10);
    for (const e of recent) {
      e.strength = Math.min(1, e.strength + 0.05);
      if (e.concept) { const c = this.mem.concepts.get(e.concept); if (c) c.familiarity += 0.1; }
    }
    this.mem.forget(this.t);
  }

  // ======================================================================= thoughts (blueprint 10.1)

  /** A thought fires by chance, scaled by intensity, talkativeness and refractory periods. Firing is what writes back. */
  think(intent: string, intensity: number, build: () => string | null, opts: { force?: boolean; aloud?: boolean } = {}): boolean {
    const last = this.lastThought.get(intent) ?? -999;
    const refractory = intent === 'NAME_IT' || intent === 'NOTICE_DETAIL' || intent === 'SPEAK' ? 0.5 : intent.startsWith('SMELL') || intent === 'RECOGNIZE' ? 40 : 8;
    if (this.t - last < refractory) return false;
    if (!opts.force) {
      if (this.t - this.lastAnyThought < 2.5) return false;
      const p = this.temper.talkativeness * sigmoid(5 * (intensity - 0.45));
      if (!this.rng.chance(p)) return false;
    }
    const text = build();
    if (!text) return false;
    this.lastThought.set(intent, this.t);
    this.lastAnyThought = this.t;
    this.thinkingUntil = this.t + Math.min(3, text.split(' ').length / 3.5);
    const rec: ThoughtRecord = { t: this.t, intent, text, mood: this.mood(), aloud: !!opts.aloud };
    this.newThoughts.push(rec);
    this.mem.remember(this.stamp, 'thought', { text, arousal: 0.2 });
    if (opts.aloud) this.speakQueue.push({ text, at: this.t + 0.05, loud: 0.35, echo: false });
    return true;
  }

  private focusOn(kind: string, label: string, node?: string) {
    this.focus = { kind, label, node };
  }

  // ======================================================================= for the viewer and the gate

  report(): MindReport {
    const r: MindReport = {
      focus: this.focus,
      behavior: this.behavior.name + (this.behavior.data.label ? ` (${this.behavior.data.label})` : ''),
      stance: this.stance,
      drives: { ...this.drives },
      feelings: { ...this.feelings },
      gaze: { mode: this.eye.mode, target: this.eye.target, interest: this.eye.interest },
      salience: [...this.percepts].sort((a, b) => b.salience - a.salience).slice(0, 6).map((p) => ({ node: p.node, label: p.c?.name ?? (p.props ? describe(p.props.looks, p.props.color, undefined, false) : 'something'), score: p.salience })),
      thoughts: this.newThoughts.splice(0),
      speech: this.newSpeech.splice(0),
    };
    return r;
  }

  /** Words it can produce: innate words, the names it has given, and words it understands. */
  lexicon(): Set<string> {
    const s = new Set(INNATE_WORDS);
    for (const c of this.mem.concepts.values()) {
      if (c.name) for (const w of c.name.split(' ')) s.add(w);
      for (const a of c.aliases) for (const w of a.split(' ')) s.add(w);
    }
    return s;
  }

  /** Knowledge graph rows for the viewer. */
  knowledge(): string[] {
    const name = (id: string) => this.mem.concepts.get(id)?.name ?? (id.startsWith('w:') ? `"${id.slice(2)}"` : id === 'ground' || id === 'self' ? id : this.mem.concepts.has(id) ? '(unnamed)' : id);
    return [...this.mem.facts.values()].filter((f) => f.r !== 'smells').slice(-80).map((f) => `${name(f.s)} ${f.r.replace('rel:', '').replace('_', ' ')} ${name(f.o)} [${[...f.sources].join(',')}]`);
  }

  // used by dialogue
  get speechContext() { return { lastSpeech: this.lastSpeech }; }
  allLooks() { return LOOKS; }
}
