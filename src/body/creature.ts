// L2/L3 THE CREATURE'S BODY: physical body, biology, motor controllers and reflexes (blueprint 4, 5.5–5.7, 14.3).
// It carries out the mind's intents and reports what actually happened. It never decides anything.
import type { World } from '../world/world';
import type { MotorIntent, TouchPercept, TastePercept, BodyState } from '../protocol/types';
import { PROTOCOL_VERSION } from '../protocol/types';
import { Motion, CREATURE_DIMS, type CreaturePose } from './motion';
import { Rng } from '../util/rng';
import { angDiff, clamp, DEG, dist, dist2d, norm, rotY, sub, type V3 } from '../util/vec';
import { toVec, TASTE_DIMS } from '../world/fields';
import { surfaceAt } from '../world/terrain';

export const SELF_ID = 'creature';

export function idleIntent(): MotorIntent {
  return {
    v: PROTOCOL_VERSION,
    gaze: { mode: 'scan' },
    locomotion: { mode: 'idle', speed: 0 },
    posture: { crouch: 0, earsFlat: 0, tailUp: 0.3, headDown: 0 },
    mouth: { action: 'none' },
    face: { pupil: 0, squint: 0 },
    reflex: { withdrawGain: 1, startleThreshold: 0.25 },
    sleep: false,
  };
}

interface Digest { due: number; energy: number; toxin: number }

const MOUTH_TIME: Record<string, number> = { sniff: 0.6, nose: 0.5, lick: 0.55, bite: 0.9, drink: 1.4 };
const EDIBLE_KEYS = new Set(['berry', 'leaf', 'petals', 'center', 'cap', 'grass', 'blade', 'stalk', 'ant']);

export class CreatureBody {
  readonly handle: number;
  readonly motion: Motion;
  readonly rng: Rng;
  heading: number;
  intent: MotorIntent = idleIntent();
  bio: BodyState = { energy: 0.6, hydration: 0.72, stomach: 0.1, health: 1, fatigue: 0.1, temperature: 0.5, pain: 0, nausea: 0, wet: 0 };
  pose: CreaturePose;
  /** Buffers the senses drain each slow tick. */
  touches: TouchPercept[] = [];
  tastes: TastePercept[] = [];
  startle = 0;
  mouthAction: { action: string; target?: string; t: number } | null = null;
  sniffGain = 1;
  private digest: Digest[] = [];
  private wanderYaw: number;
  private turnInPlace = 0;
  private lastSpeech = 0;
  pendingSpeech: { text: string; loudness: number } | null = null;

  constructor(private world: World, spawn: { x: number; z: number }, heading = 0) {
    this.rng = world.rng.fork(77);
    this.heading = heading;
    this.wanderYaw = heading;
    const y = world.groundY(spawn.x, spawn.z) + CREATURE_DIMS.bodyHeight;
    this.handle = world.physics.addCharacter(SELF_ID, { x: spawn.x, y, z: spawn.z }, 0.03, 0, 0.03, world.material('fur'));
    this.motion = new Motion(CREATURE_DIMS, this.rng.fork(3), { x: spawn.x, y, z: spawn.z }, heading);
    this.pose = this.motion.pose;
    world.controllers.push((dt) => this.control(dt));
  }

  get pos(): V3 { return this.world.physics.pos(this.handle); }
  get vel(): V3 { return this.world.physics.vel(this.handle); }

  setIntent(i: MotorIntent) {
    this.intent = i;
    if (i.voice && i.voice.say) this.pendingSpeech = { text: i.voice.say, loudness: i.voice.loudness };
  }

  mouthPos(): V3 {
    const h = this.pose.head;
    const f = { x: Math.sin(this.pose.headYaw) * Math.cos(this.pose.headPitch), y: Math.sin(this.pose.headPitch), z: Math.cos(this.pose.headYaw) * Math.cos(this.pose.headPitch) };
    return { x: h.x + f.x * 0.02, y: h.y - 0.006 + f.y * 0.02, z: h.z + f.z * 0.02 };
  }

  inReach(id: string): boolean {
    if (id.startsWith('pond')) return this.world.waterEdgeDistance(this.mouthPos()) < 0.04;
    const n = this.world.nodes.get(id);
    if (!n || n.removed) return false;
    return this.reachNode(this.mouthPos(), n.pos, n.size);
  }

  /** Within reach of the mouth, including stretching up a little on the hind legs. */
  private reachNode(mp: V3, p: V3, size: number): boolean {
    const h = Math.hypot(p.x - mp.x, p.z - mp.z);
    const dy = p.y - mp.y;
    return h < 0.035 + size * 0.5 && dy > -0.05 - size * 0.5 && dy < 0.075 + size * 0.5;
  }

  /** Runs every physics step, before physics. */
  private control(dt: number) {
    const w = this.world;
    const i = this.intent;
    const p = this.pos;
    const v = this.vel;
    const hit = this.processContacts();

    // ---------------- locomotion: intents say what, the body decides how
    let desired = { x: 0, z: 0 };
    let topSpeed = 0.42;
    const sp = clamp(i.locomotion.speed, 0, 1) * topSpeed * (1 - 0.5 * this.bio.fatigue) * (0.4 + 0.6 * this.bio.health);
    const L = i.locomotion;
    let goal: V3 | null = null;
    if ((L.mode === 'approach' || L.mode === 'flee') && L.target) {
      const n = L.target.startsWith('pond') ? null : w.nodes.get(L.target);
      if (L.target.startsWith('pond')) {
        const pn = w.nodes.get(L.target);
        if (pn) {
          const toC = norm(sub(pn.pos, p));
          goal = { x: p.x + toC.x * Math.max(0, w.waterEdgeDistance(p) - 0.01), y: p.y, z: p.z + toC.z * Math.max(0, w.waterEdgeDistance(p) - 0.01) };
        }
      } else if (n && !n.removed) goal = n.pos;
      const sh = w.shelters.find((s) => s.node === L.target);
      if (sh && !w.inShelter(this.pose.head)) {
        // through the nearer opening, then inside
        const ax = { x: Math.cos(sh.rotY), z: -Math.sin(sh.rotY) };
        const ends = [1, -1].map((k) => ({ x: sh.pos.x + ax.x * k * (sh.halfLen + 0.12), y: p.y, z: sh.pos.z + ax.z * k * (sh.halfLen + 0.12) }));
        const near = ends.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        const lp = rotY(sub(p, sh.pos), -sh.rotY);
        const inLine = Math.abs(lp.z) < sh.inner * 0.7 && Math.abs(lp.x) > sh.halfLen * 0.6;
        goal = inLine || Math.hypot(near.x - p.x, near.z - p.z) < 0.06 ? { x: sh.pos.x + ax.x * Math.sign(lp.x) * sh.halfLen * 0.3, y: p.y, z: sh.pos.z + ax.z * Math.sign(lp.x) * sh.halfLen * 0.3 } : near;
      }
    } else if (L.pos) goal = { x: L.pos.x, y: p.y, z: L.pos.z };

    if (goal && L.mode !== 'flee') {
      const dx = goal.x - p.x, dz = goal.z - p.z;
      const dd = Math.hypot(dx, dz);
      // things above the head are viewed from a little way back, so they stay in sight
      const rise = Math.max(0, goal.y - this.pose.head.y);
      const stop = Math.max(L.stopAt ?? 0.06, L.mode === 'approach' ? rise / Math.tan(55 * DEG) : 0);
      if (dd > stop) {
        const s = sp * clamp((dd - stop) / 0.08, 0.25, 1);
        desired = { x: (dx / dd) * s, z: (dz / dd) * s };
      }
    } else if (goal && L.mode === 'flee') {
      const dx = p.x - goal.x, dz = p.z - goal.z;
      const dd = Math.hypot(dx, dz) || 1;
      desired = { x: (dx / dd) * sp, z: (dz / dd) * sp };
    } else if (L.mode === 'wander' || L.mode === 'heading') {
      if (L.headingDeg !== undefined) this.wanderYaw = L.headingDeg * DEG;
      else this.wanderYaw += this.rng.gauss() * dt * 1.2;
      desired = { x: Math.sin(this.wanderYaw) * sp, z: Math.cos(this.wanderYaw) * sp };
    }

    // obstacle avoidance and staying out of deep water: the body's own business
    if (desired.x || desired.z) {
      const av = this.avoid(p, desired, L.target);
      desired = { x: desired.x + av.x, z: desired.z + av.z };
    }
    // reflex: if the body is ever past the shoreline, scramble straight back out (it cannot swim)
    const inWater = w.waterEdgeDistance(p) === 0;
    if (inWater) {
      const pn = w.nodes.tops.find((n) => n.entity === 'pond')!;
      const dx = p.x - pn.pos.x, dz = p.z - pn.pos.z, d = Math.hypot(dx, dz) || 1;
      desired = { x: (dx / d) * topSpeed * 0.8, z: (dz / d) * topSpeed * 0.8 };
    }

    // accelerate toward the desired velocity
    const acc = (inWater ? 5 : 2.2) * dt;
    let nvx = v.x + clamp(desired.x - v.x, -acc, acc);
    let nvz = v.z + clamp(desired.z - v.z, -acc, acc);
    if (!hit) w.physics.setVel(this.handle, { x: nvx, y: v.y, z: nvz });

    // heading turns toward motion; when still, the body turns toward where the head is looking
    const spd = Math.hypot(v.x, v.z);
    if (spd > 0.03) {
      const want = Math.atan2(v.x, v.z);
      this.heading += clamp(angDiff(want, this.heading), -5 * dt, 5 * dt);
    } else {
      const off = angDiff(this.pose.headYaw, this.heading);
      if (Math.abs(off) > 50 * DEG) this.turnInPlace = Math.sign(off);
      if (this.turnInPlace) {
        this.heading += this.turnInPlace * 2.5 * dt;
        if (Math.abs(angDiff(this.pose.headYaw, this.heading)) < 10 * DEG) this.turnInPlace = 0;
      }
    }

    // ---------------- mouth actions
    this.runMouth(dt);

    // ---------------- reflexes run here, at physics rate, without waiting for the mind
    this.startle = Math.max(0, this.startle - dt * 2);
    for (const s of w.sounds) {
      if (w.t - s.t0 > dt * 1.5 || s.source === SELF_ID || s.speech) continue;
      const d = dist(s.pos, p);
      const loud = s.loudness / (1 + (d / 0.5) ** 2);
      if (loud > i.reflex.startleThreshold * (1 - 0.5 * (s.sig[5] ?? 0)) && !this.intent.sleep) {
        this.startle = Math.max(this.startle, clamp(loud * 2, 0.3, 1));
        w.physics.impulse(this.handle, { x: 0, y: 0.0025 * this.startle, z: 0 });
      }
    }

    this.biology(dt, spd);

    // ---------------- motion layer
    const gazeTarget = this.gazePoint();
    const scan = i.gaze.mode === 'scan' && !gazeTarget;
    this.pose = this.motion.update(dt, {
      root: p, vel: v, heading: this.heading,
      gazeTarget,
      gazeMode: i.gaze.mode,
      scanYaw: scan && i.gaze.yawDeg !== undefined ? i.gaze.yawDeg * DEG : undefined,
      scanPitch: scan && i.gaze.pitchDeg !== undefined ? i.gaze.pitchDeg * DEG : undefined,
      crouch: Math.max(i.posture.crouch, this.startle * 0.8),
      headDown: i.posture.headDown,
      earsBearing: i.posture.earsBearingDeg !== undefined ? i.posture.earsBearingDeg * DEG : undefined,
      earsFlat: i.posture.earsFlat,
      tailUp: i.posture.tailUp,
      arousal: clamp(i.face.pupil, 0, 1),
      light: w.lightAt(p),
      pupilHint: i.face.pupil,
      squint: i.face.squint,
      tongue: this.mouthAction?.action === 'lick' || this.mouthAction?.action === 'drink' ? Math.sin((this.mouthAction.t / (MOUTH_TIME[this.mouthAction.action] ?? 1)) * Math.PI * (this.mouthAction.action === 'drink' ? 4 : 1)) ** 2 : 0,
      jaw: this.mouthAction?.action === 'bite' ? Math.abs(Math.sin(this.mouthAction.t * 14)) : this.pendingSpeechActive() ? Math.abs(Math.sin(w.t * 18)) * 0.5 : 0,
      sleeping: i.sleep,
      ground: (x, z) => w.groundY(x, z),
    });

    if (this.pendingSpeech && w.t - this.lastSpeech > 0.3) {
      w.emitSound(this.pose.head, [0.8, this.pendingSpeech.loudness, 0.1, 0.6, 0.6, 0.5], this.pendingSpeech.loudness, 1 + this.pendingSpeech.text.length * 0.05, SELF_ID, { text: this.pendingSpeech.text, speaker: SELF_ID });
      this.lastSpeech = w.t;
      this.speakingUntil = w.t + 0.4 + this.pendingSpeech.text.split(' ').length * 0.28;
      this.pendingSpeech = null;
    }
  }

  private speakingUntil = 0;
  private pendingSpeechActive() { return this.world.t < this.speakingUntil; }

  private gazePoint(): V3 | null {
    const g = this.intent.gaze;
    if (!g.target) return null;
    const n = this.world.nodes.get(g.target);
    if (!n || n.removed) return null;
    return n.pos;
  }

  private avoid(p: V3, desired: { x: number; z: number }, target?: string): { x: number; z: number } {
    const w = this.world;
    let ax = 0, az = 0;
    const sp = Math.hypot(desired.x, desired.z) || 1;
    const look = { x: p.x + (desired.x / sp) * 0.12, z: p.z + (desired.z / sp) * 0.12 };
    for (const n of w.nearestTops(p, 0.8)) {
      let r = 0;
      if (n.entity === 'tree') r = (n.render.big ? 0.22 : 0.03) + 0.05;
      else if (n.entity === 'rock') r = n.size * 0.45 + 0.04;
      else if (n.entity === 'bush') r = n.render.R * 0.5 + 0.03;
      else continue;
      if (target && (target === n.id || target.startsWith(n.id + '/'))) r *= 0.5;
      const c = n.entity === 'tree' ? n.render.base : n.pos;
      const dx = look.x - c.x, dz = look.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < r + 0.06) {
        const push = ((r + 0.06 - d) / 0.06) * sp * 1.4;
        // steer around rather than straight back: add a sideways component
        ax += (dx / (d || 1)) * push + (-dz / (d || 1)) * push * 0.6;
        az += (dz / (d || 1)) * push + (dx / (d || 1)) * push * 0.6;
      }
    }
    // the water's edge: never walk in. When the pond is what it is going to (to drink), it may walk right up to the
    // shoreline with its paws dry; otherwise it keeps a look-ahead margin.
    const drinking = !!target && target.startsWith('pond');
    const speed = Math.hypot(this.vel.x, this.vel.z);
    // the drinking margin grows with speed (braking distance), so it never runs in with momentum
    const we = drinking ? w.waterEdgeDistance(p) - 0.015 - speed * 0.3 : w.waterEdgeDistance({ x: look.x, y: 0, z: look.z }) - 0.05;
    if (we < 0) {
      const pn = w.nodes.tops.find((n) => n.entity === 'pond')!;
      const dx = look.x - pn.pos.x, dz = look.z - pn.pos.z, d = Math.hypot(dx, dz) || 1;
      ax += (dx / d) * sp * 1.5;
      az += (dz / d) * sp * 1.5;
    }
    return { x: ax, z: az };
  }

  private processContacts(): boolean {
    const w = this.world;
    let hit = false;
    for (const c of w.contacts) {
      if (c.a !== SELF_ID && c.b !== SELF_ID) continue;
      const other = c.a === SELF_ID ? c.b : c.a;
      if (other === 'ground') continue;
      const n = w.nodes.get(other);
      const m = w.material(n?.spec.material ?? n?.top.spec.material);
      const p = this.pos;
      const away = n ? norm(sub(p, n.pos)) : { x: 0, y: 1, z: 0 };
      const bearing = angDiff(Math.atan2(-away.x, -away.z), this.heading) / DEG;
      // damage from hard, fast things (blueprint 5.6)
      const dmg = Math.max(0, c.force - 0.6) * 0.012 * m.hardness * (1 + m.sharpness);
      if (dmg > 0.002) {
        this.bio.health = clamp(this.bio.health - dmg, 0, 1);
        this.bio.pain = clamp(this.bio.pain + dmg * 6, 0, 1);
        hit = true;
        // withdrawal reflex: away from the contact, immediately
        const g = this.intent.reflex.withdrawGain;
        this.world.physics.impulse(this.handle, { x: away.x * 0.004 * g, y: 0.002 * g, z: away.z * 0.004 * g });
        this.startle = Math.max(this.startle, 0.8);
        w.events.push({ t: w.t, kind: 'hurt', node: other, detail: dmg.toFixed(3) });
      }
      if (n && this.touches.length < 8) this.touches.push({ node: other, force: c.force, where: 'body', props: n.spec.touch ?? {}, bearingDeg: bearing });
    }
    return hit;
  }

  private runMouth(dt: number) {
    const i = this.intent.mouth;
    if (!this.mouthAction && i.action !== 'none') this.mouthAction = { action: i.action, target: i.target, t: 0 };
    const m = this.mouthAction;
    if (!m) { this.sniffGain = 1; return; }
    m.t += dt;
    this.sniffGain = m.action === 'sniff' ? 1.8 : 1;
    if (m.t < (MOUTH_TIME[m.action] ?? 0.5)) return;
    this.mouthAction = null;
    const id = m.target;
    if (!id || !this.inReach(id)) return;
    const n = this.world.nodes.get(id);
    if (!n) return;
    const spec = n.spec;
    if (m.action === 'nose') {
      this.touches.push({ node: id, force: 0.01, where: 'nose', props: spec.touch ?? {}, bearingDeg: 0 });
    } else if (m.action === 'lick') {
      this.tastes.push({ node: id, sig: toVec(spec.taste?.sig, TASTE_DIMS), texture: spec.touch?.texture, swallowed: false });
      this.touches.push({ node: id, force: 0.005, where: 'mouth', props: spec.touch ?? {}, bearingDeg: 0 });
    } else if (m.action === 'bite') {
      const t = spec.taste;
      this.tastes.push({ node: id, sig: toVec(t?.sig, TASTE_DIMS), texture: spec.touch?.texture, swallowed: !!t && EDIBLE_KEYS.has(spec.key) });
      if (t && EDIBLE_KEYS.has(spec.key)) {
        if (spec.key === 'berry' || spec.key === 'petals' || spec.key === 'center' || spec.key === 'cap' || spec.key === 'leaf') {
          n.removed = true;
          n.respawnAt = this.world.t + 150 + this.rng.range(0, 60);
        }
        this.bio.stomach = clamp(this.bio.stomach + 0.12, 0, 1);
        // energy arrives later, as it digests (blueprint 4)
        this.digest.push({ due: this.world.t + this.rng.range(18, 35), energy: t.nutrition, toxin: t.toxin });
        this.world.events.push({ t: this.world.t, kind: 'ate', node: id });
      }
    } else if (m.action === 'drink') {
      const t = spec.taste;
      this.tastes.push({ node: id, sig: toVec(t?.sig, TASTE_DIMS), texture: 'wet', swallowed: true });
      this.bio.hydration = clamp(this.bio.hydration + (t?.hydration ?? 0.2), 0, 1);
      this.bio.wet = Math.min(1, this.bio.wet + 0.1);
      this.world.events.push({ t: this.world.t, kind: 'drank', node: id });
    }
  }

  private biology(dt: number, speed: number) {
    const b = this.bio, w = this.world;
    const asleep = this.intent.sleep;
    b.energy = clamp(b.energy - dt * (0.0007 + 0.003 * speed) * (asleep ? 0.5 : 1), 0, 1);
    b.hydration = clamp(b.hydration - dt * (0.0007 + 0.002 * speed), 0, 1);
    b.stomach = clamp(b.stomach - dt * 0.004, 0, 1);
    b.fatigue = clamp(b.fatigue + dt * (asleep ? -0.006 : speed > 0.05 ? 0.0007 + 0.002 * speed : 0.00015), 0, 1);
    b.pain = clamp(b.pain * Math.exp(-dt / 3), 0, 1);
    b.nausea = clamp(b.nausea * Math.exp(-dt / 40), 0, 1);
    b.wet = clamp(b.wet - dt * 0.004 * (w.lightAt(this.pos) + 0.2), 0, 1);
    if (surfaceAt(this.pos.x, this.pos.z) === 'mud') b.wet = Math.min(1, b.wet + dt * 0.02);
    const light = w.lightAt(this.pos);
    const sheltered = !!w.inShelter(this.pose.head);
    const goal = clamp(0.25 + 0.4 * light * (1 - w.sun.ambient < 0.5 ? 1 : 0.5) + (sheltered ? 0.2 : 0) - 0.3 * b.wet, 0, 1);
    b.temperature += (goal - b.temperature) * (1 - Math.exp(-dt / 30));
    if (b.energy > 0.3 && b.nausea < 0.2) b.health = clamp(b.health + dt * 0.002, 0, 1);
    if (b.energy < 0.05 || b.hydration < 0.05) b.health = clamp(b.health - dt * 0.002, 0, 1);
    for (let k = this.digest.length - 1; k >= 0; k--) {
      const d = this.digest[k];
      if (w.t >= d.due) {
        b.energy = clamp(b.energy + d.energy, 0, 1);
        if (d.toxin > 0) {
          b.nausea = clamp(b.nausea + d.toxin, 0, 1);
          b.health = clamp(b.health - d.toxin * 0.15, 0, 1);
          b.energy = clamp(b.energy - d.toxin * 0.08, 0, 1);
          w.events.push({ t: w.t, kind: 'sick' });
        }
        this.digest.splice(k, 1);
      }
    }
  }

  reachable(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    const mp = this.mouthPos();
    for (const top of this.world.nearestTops(mp, 0.35)) {
      const walk = (n: typeof top) => {
        if (n.removed) return;
        if (this.reachNode(mp, n.pos, n.size)) out[n.id] = true;
        if (dist2d(mp, n.pos) < 0.4 + n.size) n.children.forEach(walk);
      };
      walk(top);
    }
    const pond = this.world.nodes.tops.find((n) => n.entity === 'pond');
    if (pond && this.world.waterEdgeDistance(mp) < 0.04) out[pond.id] = true;
    return out;
  }

  eyeState() {
    const pose = this.pose;
    const eye = { x: (pose.eyes[0].x + pose.eyes[1].x) / 2, y: (pose.eyes[0].y + pose.eyes[1].y) / 2, z: (pose.eyes[0].z + pose.eyes[1].z) / 2 };
    return { eye, eyeVel: this.vel, headDir: this.motion.headDir(), gazeDir: this.motion.gazeDir(), heading: this.heading, selfBody: this.handle };
  }

  forward(): V3 { return rotY({ x: 0, y: 0, z: 1 }, this.heading); }
}
