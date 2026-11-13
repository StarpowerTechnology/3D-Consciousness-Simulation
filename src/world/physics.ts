// Rapier wrapper. Physics is part of the world, not decoration (blueprint 14.2).
import RAPIER from '@dimforge/rapier3d-compat';
import type { V3 } from '../util/vec';
import type { Material } from '../ontology/types';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!ready) {
    // Rapier logs a deprecation note about init parameters; keep the console clean.
    const warn = console.warn;
    console.warn = () => {};
    ready = RAPIER.init().finally(() => { console.warn = warn; });
  }
  return ready;
}

export interface Contact { a: string; b: string; force: number; dir: V3; point: V3 }

export class Physics {
  readonly world: RAPIER.World;
  private queue: RAPIER.EventQueue;
  private colliderNode = new Map<number, string>();
  private bodyNode = new Map<number, string>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.queue = new RAPIER.EventQueue(true);
  }

  private mat(desc: RAPIER.ColliderDesc, m?: Material): RAPIER.ColliderDesc {
    if (m) desc.setFriction(m.friction).setRestitution(m.bounce);
    return desc;
  }

  private register(c: RAPIER.Collider, node: string) {
    this.colliderNode.set(c.handle, node);
  }

  addTerrain(positions: Float32Array, indices: Uint32Array, node: string) {
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.9), b);
    this.register(c, node);
  }

  addFixed(node: string, pos: V3, shape: { ball?: number; capsule?: [number, number]; box?: [number, number, number] }, rotY = 0, m?: Material, tiltZ = 0): number {
    const q = quatYawRoll(rotY, tiltZ);
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
    let d: RAPIER.ColliderDesc;
    if (shape.ball) d = RAPIER.ColliderDesc.ball(shape.ball);
    else if (shape.capsule) d = RAPIER.ColliderDesc.capsule(shape.capsule[0], shape.capsule[1]);
    else d = RAPIER.ColliderDesc.cuboid(...shape.box!);
    const c = this.world.createCollider(this.mat(d, m), b);
    this.register(c, node);
    this.bodyNode.set(b.handle, node);
    return b.handle;
  }

  /** A fixed compound body: boxes placed in the body's local frame. */
  addFixedCompound(node: string, pos: V3, rotY: number, boxes: { at: V3; half: [number, number, number]; rotX?: number; rotZ?: number }[], m?: Material): number {
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(quatYawRoll(rotY, 0)));
    for (const bx of boxes) {
      const d = this.mat(RAPIER.ColliderDesc.cuboid(...bx.half), m).setTranslation(bx.at.x, bx.at.y, bx.at.z);
      if (bx.rotX || bx.rotZ) d.setRotation(quatXZ(bx.rotX ?? 0, bx.rotZ ?? 0));
      this.register(this.world.createCollider(d, b), node);
    }
    this.bodyNode.set(b.handle, node);
    return b.handle;
  }

  addDynamicBall(node: string, pos: V3, r: number, m: Material, damping = 0.05, eventsThreshold = 0.05): number {
    const b = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(damping).setAngularDamping(0.5).setCcdEnabled(true),
    );
    const c = this.world.createCollider(
      this.mat(RAPIER.ColliderDesc.ball(r), m)
        .setDensity(m.density)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(eventsThreshold),
      b,
    );
    this.register(c, node);
    this.bodyNode.set(b.handle, node);
    return b.handle;
  }

  /** A creature body: physical, collides and can be knocked around, but does not tip over. */
  addCharacter(node: string, pos: V3, r: number, halfHeight: number, massKg: number, m: Material): number {
    const b = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).lockRotations().setLinearDamping(0.2).setCcdEnabled(true),
    );
    const vol = halfHeight > 0 ? Math.PI * r * r * (2 * halfHeight) + (4 / 3) * Math.PI * r ** 3 : (4 / 3) * Math.PI * r ** 3;
    const d = (halfHeight > 0 ? RAPIER.ColliderDesc.capsule(halfHeight, r) : RAPIER.ColliderDesc.ball(r))
      .setFriction(0.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min) // the legs, not sliding friction, move it
      .setRestitution(m.bounce)
      .setDensity(massKg / vol)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.02);
    this.register(this.world.createCollider(d, b), node);
    this.bodyNode.set(b.handle, node);
    return b.handle;
  }

  remove(handle: number) {
    const b = this.world.getRigidBody(handle);
    if (!b) return;
    for (let i = 0; i < b.numColliders(); i++) this.colliderNode.delete(b.collider(i).handle);
    this.bodyNode.delete(handle);
    this.world.removeRigidBody(b);
  }

  body(h: number) { return this.world.getRigidBody(h); }

  pos(h: number): V3 { const t = this.world.getRigidBody(h).translation(); return { x: t.x, y: t.y, z: t.z }; }
  vel(h: number): V3 { const v = this.world.getRigidBody(h).linvel(); return { x: v.x, y: v.y, z: v.z }; }
  rot(h: number) { return this.world.getRigidBody(h).rotation(); }
  setVel(h: number, v: V3) { this.world.getRigidBody(h).setLinvel(v, true); }
  setPos(h: number, p: V3) { const b = this.world.getRigidBody(h); b.setTranslation(p, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  impulse(h: number, j: V3) { this.world.getRigidBody(h).applyImpulse(j, true); }
  /** Rapier forces persist between steps; this replaces the force for the coming step. */
  force(h: number, f: V3) { const b = this.world.getRigidBody(h); b.resetForces(false); b.addForce(f, true); }
  mass(h: number) { return this.world.getRigidBody(h).mass(); }
  sleeping(h: number) { return this.world.getRigidBody(h).isSleeping(); }

  step(): Contact[] {
    this.world.step(this.queue);
    const out: Contact[] = [];
    this.queue.drainContactForceEvents((e) => {
      const a = this.colliderNode.get(e.collider1());
      const b = this.colliderNode.get(e.collider2());
      if (!a || !b) return;
      const d = e.maxForceDirection();
      const c1 = this.world.getCollider(e.collider1()).translation();
      const c2 = this.world.getCollider(e.collider2()).translation();
      out.push({ a, b, force: e.totalForceMagnitude(), dir: { x: d.x, y: d.y, z: d.z }, point: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2, z: (c1.z + c2.z) / 2 } });
    });
    this.queue.drainCollisionEvents(() => {});
    return out;
  }

  /** First thing a ray hits, as a node id and distance. */
  raycast(from: V3, dir: V3, maxDist: number, excludeBody?: number): { node: string; dist: number } | null {
    const ray = new RAPIER.Ray(from, dir);
    const ex = excludeBody !== undefined ? this.world.getRigidBody(excludeBody) : undefined;
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, ex);
    if (!hit) return null;
    const node = this.colliderNode.get(hit.collider.handle);
    return node ? { node, dist: hit.timeOfImpact } : null;
  }
}

function quatYawRoll(yaw: number, roll: number) {
  // yaw around y, then roll around z
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return { w: cy * cr, x: sy * sr, y: sy * cr, z: cy * sr };
}

function quatXZ(rx: number, rz: number) {
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2), cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return { w: cx * cz, x: sx * cz, y: sx * sz, z: cx * sz };
}
