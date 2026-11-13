// L1 WORLD: authoritative truth. Knows everything about itself; the creature knows only what its senses deliver.
import type { Ontology, Material, PartSpec } from '../ontology/types';
import { Rng } from '../util/rng';
import { add, clamp, dist, dist2d, norm, rotY, scale, sub, v3, type V3 } from '../util/vec';
import { clockAt, flutter, sunAt, windAt, toVec, SMELL_DIMS, SOUND_DIMS, type Clock, type Sun, type Wind, type SoundEvent } from './fields';
import { NodeRegistry, type NodeInst } from './nodes';
import { Physics, type Contact } from './physics';
import { buildTerrainMesh, terrainHeight, POND, WATER_LEVEL, SHORE_R } from './terrain';
import { spawnWorld } from './spawn';
import { AntColony, Butterflies } from './agents';

export interface Canopy { x: number; z: number; r: number; y0: number; shade: number }
export interface Shelter { node: string; pos: V3; rotY: number; halfLen: number; inner: number }
interface SmellSource { node: NodeInst; vec: number[]; strength: number; reach: number }

export const FIXED_DT = 1 / 60;

export class World {
  readonly nodes = new NodeRegistry();
  readonly physics = new Physics();
  readonly rng: Rng;
  t = 0;
  frame = 0;
  clock: Clock = clockAt(0);
  sun: Sun = sunAt(clockAt(0).hour);
  wind: Wind = windAt(0);
  canopies: Canopy[] = [];
  shelters: Shelter[] = [];
  sounds: SoundEvent[] = [];
  contacts: Contact[] = [];
  /** Hooks a body layer can register: called every fixed step before physics. */
  readonly controllers: ((dt: number) => void)[] = [];
  readonly terrain = buildTerrainMesh();
  ants!: AntColony;
  butterflies!: Butterflies;
  nutTrees: NodeInst[] = [];
  fallenNuts: NodeInst[] = [];
  private smellSources: SmellSource[] = [];
  private soundId = 1;
  private lastContactSound = new Map<string, number>();
  private nextPondSound = 0;
  events: { t: number; kind: string; node?: string; detail?: string }[] = [];

  constructor(readonly ont: Ontology, readonly seed = 1) {
    this.rng = new Rng(seed);
    this.physics.addTerrain(this.terrain.positions, this.terrain.indices, 'ground');
    spawnWorld(this);
    this.rebuildSmellSources();
  }

  material(name?: string): Material {
    return (name && this.ont.materials[name]) || { friction: 0.7, bounce: 0.1, hardness: 0.3, sharpness: 0, density: 800 };
  }

  spec(entity: string): PartSpec {
    const s = this.ont.entities[entity];
    if (!s) throw new Error(`ontology has no entity '${entity}'`);
    return s;
  }

  groundY(x: number, z: number): number {
    return terrainHeight(x, z);
  }

  // ---------------------------------------------------------------- stepping

  step(dt = FIXED_DT): void {
    this.t += dt;
    this.frame++;
    this.clock = clockAt(this.t);
    this.sun = sunAt(this.clock.hour);
    this.wind = windAt(this.t);

    this.ants.update(dt);
    this.butterflies.update(dt);
    this.updateFlutter();
    this.updateFallenLeaves();
    this.updateNutDrops(dt);
    for (const c of this.controllers) c(dt);

    this.contacts = this.physics.step();
    this.syncPhysicsNodes();
    this.processContacts();
    this.ambientSounds();
    this.respawn();
    this.sounds = this.sounds.filter((s) => this.t - s.t0 < s.dur + 0.25);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  private flutterCache: NodeInst[] = [];
  private flutterVersion = -1;
  private flutterNear = new Uint8Array(0);
  /** Places where something can perceive the world (the creatures' heads). Leaves near them flutter every step. */
  observers: V3[] = [];

  private updateFlutter() {
    if (this.flutterVersion !== this.nodes.version) {
      this.flutterCache = [...this.nodes.byId.values()].filter((n) => n.motion === 'flutter');
      this.flutterVersion = this.nodes.version;
      this.flutterNear = new Uint8Array(this.flutterCache.length).fill(1);
    }
    // level of detail: leaves within 10 m of an observer are exact every step; farther ones step every 4th frame,
    // which no sense can resolve at that distance (and the renderer can't show)
    const near2 = 100, obs = this.observers, slot = this.frame & 3;
    if (this.frame % 30 === 0 && obs.length) {
      // which leaves are near an observer: refreshed twice a second (with 2 m of slack in the radius)
      for (let li = 0; li < this.flutterCache.length; li++) {
        const b = this.flutterCache[li].basePos;
        let near = 0;
        for (const o of obs) { const dx = b.x - o.x, dz = b.z - o.z; if (dx * dx + dz * dz < near2 * 1.44) { near = 1; break; } }
        this.flutterNear[li] = near;
      }
    }
    // allocation-free: this runs for thousands of leaves at 60 Hz
    const w = this.wind, t = this.t;
    const g = 0.3 + 0.7 * w.gust, base = 0.15 + w.strength * 0.85, lean = 0.4 * w.strength;
    for (let li = 0; li < this.flutterCache.length; li++) {
      const n = this.flutterCache[li];
      if (n.removed) continue;
      if ((li & 3) !== slot && !this.flutterNear[li]) continue;
      const a = (n.render.flutterAmp ?? 0.01) * base;
      const om = 4.5 + (n.phase % 1) * 3;
      const ph1 = om * t + n.phase * 6.283, ph2 = 1.7 * om * t + n.phase * 3.1;
      const s1 = Math.sin(ph1), c1 = Math.cos(ph1), s2 = Math.sin(ph2), c2 = Math.cos(ph2);
      const h = a * (s1 * g + lean);
      n.pos.x = n.basePos.x + w.dir.x * h;
      n.pos.y = n.basePos.y + a * 0.5 * s2 * g;
      n.pos.z = n.basePos.z + w.dir.z * h;
      n.vel.x = w.dir.x * a * om * c1 * g;
      n.vel.y = a * 0.85 * om * c2 * g;
      n.vel.z = w.dir.z * a * om * c1 * g;
      n.render.twist = 0.5 * s1 * g * (0.3 + w.strength);
      for (const c of n.children) {
        c.pos.x = n.pos.x; c.pos.y = n.pos.y; c.pos.z = n.pos.z;
        c.vel = n.vel;
      }
    }
  }

  private updateFallenLeaves() {
    const w = this.wind;
    const lim = 4.5; // leaves stay in the clearing
    for (const n of this.nodes.tops) {
      if (n.entity !== 'leaf' || n.body === undefined) continue;
      const p = n.pos;
      // leaves that blow out of the patch or into the pond drift back in at a random spot
      if (Math.hypot(p.x, p.z) > lim || p.y < this.groundY(p.x, p.z) - 0.3 || this.waterEdgeDistance(p) === 0) {
        // re-enter upwind, so the wind carries them back across the clearing
        const a = Math.atan2(-w.dir.z, -w.dir.x) + this.rng.range(-0.8, 0.8), r = this.rng.range(1.5, 3.5);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        this.physics.setPos(n.body, { x, y: this.groundY(x, z) + 0.05, z });
        continue;
      }
      const m = this.physics.mass(n.body);
      const g = w.gust * w.gust;
      // a push from the wind plus a little lift in gusts: leaves skitter and hop, they do not fly away
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 3 + n.phase * 9);
      const f = scale(w.dir, m * (0.25 + 4.5 * g) * pulse);
      f.y = m * 6.5 * g * Math.max(0, Math.sin(this.t * 5 + n.phase * 7));
      this.physics.force(n.body, f);
    }
  }

  private updateNutDrops(dt: number) {
    for (const tree of this.nutTrees) {
      for (const br of tree.children) {
        for (const nut of br.children) {
          if (nut.spec.key !== 'nut' || nut.removed) continue;
          const p = (0.006 + 0.05 * this.wind.gust * this.wind.gust) * dt;
          if (this.rng.chance(p)) this.dropNut(nut);
        }
      }
    }
    // keep the ground tidy: old fallen nuts roll away into the leaf litter
    while (this.fallenNuts.length > 10) {
      const old = this.fallenNuts.shift()!;
      if (old.body !== undefined) this.physics.remove(old.body);
      this.nodes.delete(old);
      this.events.push({ t: this.t, kind: 'despawn', node: old.id });
    }
  }

  dropNut(attached: NodeInst): NodeInst {
    attached.removed = true;
    attached.respawnAt = this.t + 50 + this.rng.range(0, 40);
    const spec = this.spec('nut');
    const r = attached.size / 2;
    const node = this.nodes.create(spec, 'nut', null, attached.pos, attached.size, { motion: 'physics', phase: this.rng.next() });
    const cap = spec.parts[0];
    this.nodes.create(cap, 'nut', node, attached.pos, attached.size * 0.6, { motion: 'attached', local: v3(0, r * 0.7, 0) });
    node.body = this.physics.addDynamicBall(node.id, attached.pos, r, this.material('nut'), 0.02, 0.01);
    this.physics.impulse(node.body, { x: this.rng.range(-1, 1) * 0.002, y: 0, z: this.rng.range(-1, 1) * 0.002 });
    this.fallenNuts.push(node);
    this.events.push({ t: this.t, kind: 'nut_drop', node: node.id });
    return node;
  }

  private syncPhysicsNodes() {
    for (const n of this.nodes.tops) {
      if (n.body === undefined || n.removed) continue;
      if (n.motion !== 'physics' && n.motion !== 'agent') continue;
      const p = this.physics.pos(n.body);
      n.vel = this.physics.vel(n.body);
      n.pos = p;
      if (n.render.bodyRot !== undefined || n.entity === 'leaf' || n.entity === 'nut') n.render.bodyRot = this.physics.rot(n.body);
      this.syncAttached(n);
    }
  }

  /** Re-place attached parts from their parent's position and heading. */
  syncAttached(n: NodeInst) {
    for (const c of n.children) {
      if (c.motion === 'attached' && c.local) {
        c.pos = add(n.pos, rotY(c.local, n.heading));
        c.vel = n.vel;
      }
      if (c.children.length) this.syncAttached(c);
    }
  }

  private processContacts() {
    for (const c of this.contacts) {
      if (c.force < 0.15) continue;
      // bodies resting or walking on the ground are not events; footsteps are too quiet to count here
      const walker = (id: string) => id === 'creature' || id.startsWith('visitor');
      if ((c.a === 'ground' && walker(c.b)) || (c.b === 'ground' && walker(c.a))) continue;
      const key = c.a < c.b ? c.a + '|' + c.b : c.b + '|' + c.a;
      const last = this.lastContactSound.get(key) ?? -1;
      if (this.t - last < 0.2) continue;
      this.lastContactSound.set(key, this.t);
      const ha = this.hardnessOf(c.a), hb = this.hardnessOf(c.b);
      const loud = clamp(c.force * 0.04 * (0.3 + (ha + hb) / 2), 0, 1);
      if (loud < 0.02) continue;
      this.emitSound(c.point, [0.3 + 0.5 * Math.max(ha, hb), loud, 0.1, 0, 0.1, 1], loud, 0.15, c.a);
    }
  }

  hardnessOf(nodeId: string): number {
    if (nodeId === 'ground') return 0.3;
    if (nodeId === 'creature') return 0.2;
    const n = this.nodes.get(nodeId);
    return this.material(n?.spec.material ?? n?.top.spec.material).hardness;
  }

  emitSound(pos: V3, sig: number[], loudness: number, dur: number, source?: string, speech?: { text: string; speaker: string }) {
    this.sounds.push({ id: this.soundId++, pos: { ...pos }, sig, loudness, t0: this.t, dur, source, speech });
  }

  private ambientSounds() {
    if (this.t >= this.nextPondSound) {
      const spec = this.spec('pond');
      this.emitSound({ x: POND.x, y: WATER_LEVEL, z: POND.z }, toVec(spec.sound?.sig, SOUND_DIMS), 0.12, 1.2, 'pond_00');
      this.nextPondSound = this.t + 1.5 + this.rng.range(0, 2);
    }
  }

  private nextRespawnCheck = 0;
  private respawn() {
    if (this.t < this.nextRespawnCheck) return;
    this.nextRespawnCheck = this.t + 1;
    for (const n of this.nodes.byId.values()) {
      if (n.removed && n.respawnAt !== undefined && this.t >= n.respawnAt) {
        n.removed = false;
        n.respawnAt = undefined;
        n.pos = { ...n.basePos };
      }
    }
  }

  // ---------------------------------------------------------------- queries (used by senses and body)

  lightAt(p: V3): number {
    let l = this.sun.ambient;
    let shade = 1;
    for (const c of this.canopies) {
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx > c.r || dx < -c.r || dz > c.r || dz < -c.r) continue; // cheap reject, same result
      const d = Math.hypot(dx, dz);
      if (d < c.r && p.y < c.y0 + 0.5) shade = Math.min(shade, 1 - c.shade * (1 - (d / c.r) ** 2));
    }
    if (this.inShelter(p)) shade = Math.min(shade, 0.2);
    return clamp(l * (0.25 + 0.75 * shade), 0, 1);
  }

  inShelter(p: V3): Shelter | null {
    for (const s of this.shelters) {
      const lp = rotY(sub(p, s.pos), -s.rotY);
      if (Math.abs(lp.x) < s.halfLen && Math.hypot(lp.y, lp.z) < s.inner) return s;
    }
    return null;
  }

  rebuildSmellSources() {
    this.smellSources = [];
    for (const n of this.nodes.byId.values()) {
      const s = n.spec.smell;
      if (!s) continue;
      this.smellSources.push({ node: n, vec: toVec(s.sig, SMELL_DIMS), strength: s.strength, reach: s.reach_m });
    }
  }

  smellAt(p: V3): number[] {
    const out = new Array(SMELL_DIMS.length).fill(0);
    const w = this.wind;
    for (const s of this.smellSources) {
      if (s.node.removed) continue;
      const lim = s.reach * 4, q = s.node.pos;
      if (Math.abs(p.x - q.x) > lim || Math.abs(p.z - q.z) > lim) continue; // cheap reject, same result
      const d = dist(p, q);
      if (d > s.reach * 4) continue;
      const toMe = norm(sub(p, s.node.pos));
      const downwind = Math.max(0, toMe.x * w.dir.x + toMe.z * w.dir.z) * w.strength;
      const upwind = Math.max(0, -(toMe.x * w.dir.x + toMe.z * w.dir.z)) * w.strength;
      const reach = s.reach * (1 + 1.2 * downwind - 0.5 * upwind);
      const c = s.strength * Math.exp(-d / Math.max(0.05, reach));
      for (let i = 0; i < out.length; i++) out[i] += s.vec[i] * c;
    }
    return out;
  }

  /** Raycast against everything solid; returns the first node id hit. */
  raycast(from: V3, to: V3, excludeBody?: number): { node: string; dist: number } | null {
    const d = sub(to, from);
    const L = Math.hypot(d.x, d.y, d.z);
    if (L < 1e-6) return null;
    return this.physics.raycast(from, scale(d, 1 / L), L, excludeBody);
  }

  nearestTops(p: V3, maxDist: number): NodeInst[] {
    return this.nodes.tops.filter((n) => !n.removed && dist2d(n.pos, p) < maxDist + n.size);
  }

  /** Closest point on the pond's water to p, for drinking. */
  waterEdgeDistance(p: V3): number {
    const d = Math.hypot(p.x - POND.x, p.z - POND.z);
    return Math.max(0, d - SHORE_R);
  }
}
