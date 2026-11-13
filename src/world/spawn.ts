// World layout and builders. Each builder produces semantic part trees AND the render hints for drawing them
// from the same process, so what is drawn and what can be discovered never disagree (blueprint 14.6).
import type { World } from './world';
import type { NodeInst } from './nodes';
import { partSpec } from './nodes';
import { AntColony, Butterflies } from './agents';
import { POND, WATER_LEVEL, surfaceAt, WORLD_SIZE, INNER_SIZE } from './terrain';
import { add, dirFromYawPitch, norm, scale, v3, type V3 } from '../util/vec';
import { Rng } from '../util/rng';

const GOLDEN = 2.39996;

export function spawnWorld(w: World) {
  const rng = w.rng.fork(1);
  const g = (x: number, z: number) => w.groundY(x, z);

  // big trees around the clearing; one near the spawn drops nuts
  const big: [number, number, number][] = [[-4.2, -3.2, 5.2], [4.8, 3.6, 5.8], [-5.2, 4.2, 4.8], [5.6, -5.6, 5.0], [0.4, 6.2, 6.0], [-6.3, -0.8, 5.4]];
  for (const [x, z, h] of big) tree(w, rng, { x, y: g(x, z), z }, h, true, false);
  const nutTree = tree(w, rng, { x: -1.9, y: g(-1.9, -1.7), z: -1.7 }, 3.4, true, true);
  w.nutTrees.push(nutTree);

  // young trees with leaves at a small animal's height
  const young: [number, number, number][] = [[0.75, 0.55, 0.85], [-0.95, 0.35, 0.7], [1.6, -1.25, 0.95], [-1.4, 1.65, 0.8], [2.6, 2.9, 0.9]];
  for (const [x, z, h] of young) tree(w, rng, { x, y: g(x, z), z }, h, false, false);

  // berry bushes
  for (const [x, z] of [[2.1, 1.55], [-3.3, -0.4], [4.4, -0.9]] as [number, number][]) bush(w, rng, { x, y: g(x, z), z });

  // flowers in two patches
  for (let i = 0; i < 14; i++) {
    const c = i < 8 ? { x: 1.2, z: 3.0 } : { x: -1.1, z: 2.6 };
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.55);
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    flower(w, rng, { x, y: g(x, z), z });
  }

  // toxic mushrooms near the log
  for (const [x, z] of [[-2.1, 2.75], [-3.05, 1.55], [-2.3, 2.95]] as [number, number][]) mushroom(w, rng, { x, y: g(x, z), z });

  // rocks
  const rocks: [number, number, number][] = [[1.05, -0.35, 0.16], [-0.55, -1.1, 0.24], [2.9, -1.9, 0.35], [-2.6, 0.6, 0.12], [0.3, 1.7, 0.1], [-4.5, 1.8, 0.55], [3.3, 4.6, 0.4], [-1.2, -3.8, 0.3], [4.4, -3.6, 0.22]];
  for (const [x, z, s] of rocks) rock(w, rng, { x, y: g(x, z), z }, s);

  pond(w);
  log(w, { x: -2.65, z: 2.05 }, 0.45);

  // grass patches on grassy ground, leaving the clearing short
  for (let x = -INNER_SIZE / 2 + 0.6; x < INNER_SIZE / 2 - 0.6; x += 0.85)
    for (let z = -INNER_SIZE / 2 + 0.6; z < INNER_SIZE / 2 - 0.6; z += 0.85) {
      const px = x + rng.range(-0.3, 0.3), pz = z + rng.range(-0.3, 0.3);
      if (surfaceAt(px, pz) !== 'grass') continue;
      if (Math.hypot(px, pz) < 0.9) continue;
      grass(w, rng, { x: px, y: g(px, pz), z: pz });
    }

  // fallen leaves the wind can blow around
  for (let i = 0; i < 18; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0.3, 2.6);
    fallenLeaf(w, rng, { x: Math.cos(a) * r, z: Math.sin(a) * r });
  }

  w.ants = new AntColony(w, { x: 1.0, y: 0, z: 0.6 }, rng.fork(7));
  w.butterflies = new Butterflies(w, rng.fork(9));
  visitorNode(w, { x: 0.2, z: -2.2 });

  // the wider world: drawn from its own random stream, so the clearing above is unchanged by it
  spawnOuter(w, new Rng((w.seed * 2654435761 ^ 0x5bd1e995) >>> 0));
}

/** Forest, meadows and flower fields around the original clearing. */
function spawnOuter(w: World, rng: Rng) {
  const g = (x: number, z: number) => w.groundY(x, z);
  const half = WORLD_SIZE / 2 - 0.8;
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => {
    if (Math.max(Math.abs(x), Math.abs(z)) > half) return false;
    if (Math.max(Math.abs(x), Math.abs(z)) < INNER_SIZE / 2 + r * 0.5) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.4 + r) return false;
    return taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  };
  const place = (n: number, r: number, f: (x: number, z: number) => void, tries = 40) => {
    for (let i = 0; i < n; i++)
      for (let k = 0; k < tries; k++) {
        const x = rng.range(-half, half), z = rng.range(-half, half);
        if (!free(x, z, r)) continue;
        taken.push({ x, z, r });
        f(x, z);
        break;
      }
  };
  // a ring of big trees thickening toward the edge: a forest wall around the meadows
  place(55, 1.6, (x, z) => tree(w, rng, { x, y: g(x, z), z }, rng.range(4.2, 6.8), true, rng.chance(0.15), 0.15));
  place(30, 0.6, (x, z) => tree(w, rng, { x, y: g(x, z), z }, rng.range(0.7, 1.1), false, false, 0.4));
  place(12, 0.7, (x, z) => bush(w, rng, { x, y: g(x, z), z }));
  // flower fields
  place(9, 1.0, (cx, cz) => {
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.8);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      flower(w, rng, { x, y: g(x, z), z });
    }
  });
  // toadstool rings in the shade
  place(6, 0.5, (cx, cz) => {
    for (let i = 0; i < 3; i++) {
      const x = cx + rng.range(-0.25, 0.25), z = cz + rng.range(-0.25, 0.25);
      mushroom(w, rng, { x, y: g(x, z), z });
    }
  });
  place(26, 0.5, (x, z) => rock(w, rng, { x, y: g(x, z), z }, rng.range(0.12, 0.6)));
  // meadow grass, a little sparser than in the clearing
  for (let x = -half; x < half; x += 1.15)
    for (let z = -half; z < half; z += 1.15) {
      const px = x + rng.range(-0.4, 0.4), pz = z + rng.range(-0.4, 0.4);
      if (Math.max(Math.abs(px), Math.abs(pz)) < INNER_SIZE / 2 - 0.6) continue;
      if (surfaceAt(px, pz) !== 'grass' && !rng.chance(0.35)) continue;
      if (Math.hypot(px - POND.x, pz - POND.z) < POND.r * 1.3) continue;
      grass(w, rng, { x: px, y: g(px, pz), z: pz });
    }
}

// ---------------------------------------------------------------- trees

function tree(w: World, rng: Rng, base: V3, H: number, isBig: boolean, nuts: boolean, leafScale = 1): NodeInst {
  const spec = w.spec('tree');
  const trunkH = H * (isBig ? 0.55 : 0.42);
  const r0 = isBig ? 0.1 + H * 0.012 : 0.01 + H * 0.004;
  const lean = { x: rng.range(-1, 1) * 0.04 * trunkH, z: rng.range(-1, 1) * 0.04 * trunkH };
  const top = { x: base.x + lean.x, y: base.y + trunkH, z: base.z + lean.z };
  const node = w.nodes.create(spec, 'tree', null, { x: base.x, y: base.y + H * 0.55, z: base.z }, H, { phase: rng.next() });
  node.render = { kind: 'tree', base, big: isBig };

  const trunkSpec = partSpec(spec, 'trunk');
  const trunk = w.nodes.create(trunkSpec, 'tree', node, { x: base.x + lean.x / 2, y: base.y + trunkH / 2, z: base.z + lean.z / 2 }, trunkH * 0.6);
  trunk.render = { tube: [base, { x: base.x + lean.x * 0.4, y: base.y + trunkH * 0.5, z: base.z + lean.z * 0.4 }, top], radii: [r0 * 1.25, r0 * 0.9, r0 * 0.55] };
  const bark = w.nodes.create(partSpec(trunkSpec, 'bark'), 'tree', trunk, { ...trunk.pos }, r0 * 2.2);
  w.nodes.create(partSpec(partSpec(trunkSpec, 'bark'), 'cracks'), 'tree', bark, { ...trunk.pos }, r0 * 1.6);
  w.physics.addFixed(trunk.id, trunk.pos, { capsule: [trunkH / 2, r0] }, 0, w.material('bark'));

  const brSpec = partSpec(spec, 'branch');
  const leafSpec = partSpec(brSpec, 'leaf');
  const nutSpec = partSpec(spec, 'nut');
  const nB = isBig ? 9 : 4;
  const nL = Math.max(3, Math.round((isBig ? 34 : 16) * leafScale));
  const leafSize = isBig ? 0.09 : 0.055;
  let canopyR = 0;
  for (let i = 0; i < nB; i++) {
    const f = isBig ? rng.range(0.5, 1.0) : rng.range(0.4, 1.0);
    const start = { x: base.x + lean.x * f, y: base.y + trunkH * f, z: base.z + lean.z * f };
    const yaw = i * GOLDEN + rng.range(-0.3, 0.3);
    const pitch = (isBig ? rng.range(18, 50) : rng.range(25, 55)) * (Math.PI / 180);
    const L = H * (isBig ? rng.range(0.32, 0.48) : rng.range(0.3, 0.5));
    const dir = dirFromYawPitch(yaw, pitch);
    const end = add(start, scale(dir, L));
    const ctrl = add(add(start, scale(dir, L * 0.5)), v3(0, L * 0.12, 0));
    const br = w.nodes.create(brSpec, 'tree', node, add(start, scale(dir, L * 0.55)), L * 0.6);
    br.render = { tube: [start, ctrl, end], radii: [r0 * (isBig ? 0.32 : 0.55), r0 * 0.18, r0 * 0.08] };
    canopyR = Math.max(canopyR, Math.hypot(end.x - base.x, end.z - base.z));
    for (let k = 0; k < nL; k++) {
      const t = rng.range(0.35, 1.0);
      const along = bez(start, ctrl, end, t);
      const jitter = scale(norm(v3(rng.gauss(), rng.gauss() * 0.6, rng.gauss())), L * (isBig ? 0.16 : 0.14) * rng.range(0.3, 1));
      const p = add(along, jitter);
      const leaf = makeLeaf(w, rng, leafSpec, br, p, leafSize * rng.range(0.8, 1.2));
      leaf.render.yaw = yaw + rng.range(-1.2, 1.2);
      leaf.render.pitch = rng.range(-0.3, 0.9);
    }
    if (nuts) {
      for (let k = 0; k < 2; k++) {
        const p = add(bez(start, ctrl, end, rng.range(0.5, 0.95)), v3(0, -0.04, 0));
        const nut = w.nodes.create(nutSpec, 'tree', br, p, 0.028, { motion: 'static' });
        nut.render = { attachedNut: true };
      }
    }
  }
  w.canopies.push({ x: base.x, z: base.z, r: Math.max(0.2, canopyR * 1.05), y0: base.y + trunkH, shade: isBig ? 0.65 : 0.3 });
  return node;
}

function makeLeaf(w: World, rng: Rng, leafSpec: ReturnType<typeof partSpec>, parent: NodeInst, p: V3, size: number): NodeInst {
  const leaf = w.nodes.create(leafSpec, parent.entity, parent, p, size, { motion: 'flutter', phase: rng.next() });
  leaf.render = { flutterAmp: size * 0.22, twist: 0 }; // same shape for every leaf keeps the flutter loop fast
  w.nodes.create(partSpec(leafSpec, 'stem'), parent.entity, leaf, p, size * 0.9);
  w.nodes.create(partSpec(leafSpec, 'veins'), parent.entity, leaf, p, size * 0.6);
  return leaf;
}

function bez(a: V3, b: V3, c: V3, t: number): V3 {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y, z: u * u * a.z + 2 * u * t * b.z + t * t * c.z };
}

// ---------------------------------------------------------------- bushes

function bush(w: World, rng: Rng, base: V3) {
  const spec = w.spec('bush');
  const R = rng.range(0.26, 0.34), H = rng.range(0.34, 0.44);
  const node = w.nodes.create(spec, 'bush', null, { x: base.x, y: base.y + H * 0.45, z: base.z }, R * 2, { phase: rng.next() });
  node.render = { kind: 'bush', base, R, H };
  const brSpec = partSpec(spec, 'branch');
  const leafSpec = partSpec(brSpec, 'leaf');
  const berrySpec = partSpec(brSpec, 'berry');
  const nB = 7;
  for (let i = 0; i < nB; i++) {
    const yaw = i * GOLDEN;
    const start = add(base, v3(Math.sin(yaw) * 0.03, 0, Math.cos(yaw) * 0.03));
    const end = add(base, v3(Math.sin(yaw) * R * rng.range(0.7, 1.0), H * rng.range(0.55, 1.0), Math.cos(yaw) * R * rng.range(0.7, 1.0)));
    const ctrl = add(start, v3(Math.sin(yaw) * R * 0.25, H * 0.45, Math.cos(yaw) * R * 0.25));
    const br = w.nodes.create(brSpec, 'bush', node, bez(start, ctrl, end, 0.55), Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) * 0.6);
    br.render = { tube: [start, ctrl, end], radii: [0.007, 0.004, 0.0015] };
    for (let k = 0; k < 11; k++) {
      const p = add(bez(start, ctrl, end, rng.range(0.25, 1)), scale(norm(v3(rng.gauss(), rng.gauss(), rng.gauss())), 0.06 * rng.next()));
      const leaf = makeLeaf(w, rng, leafSpec, br, p, rng.range(0.035, 0.05));
      leaf.render.yaw = yaw + rng.range(-1.5, 1.5);
      leaf.render.pitch = rng.range(-0.2, 1.0);
    }
    for (let k = 0; k < 4; k++) {
      const p = add(bez(start, ctrl, end, rng.range(0.3, 0.85)), v3(Math.sin(yaw) * 0.035, -0.02, Math.cos(yaw) * 0.035));
      p.y = Math.max(base.y + 0.025, Math.min(p.y, base.y + 0.16));
      const berry = w.nodes.create(berrySpec, 'bush', br, p, rng.range(0.014, 0.018));
      w.nodes.create(partSpec(berrySpec, 'seeds'), 'bush', berry, p, berry.size * 0.8);
    }
  }
  w.physics.addFixed(node.id, add(base, v3(0, H * 0.3, 0)), { ball: R * 0.45 }, 0, w.material('leaf'));
}

// ---------------------------------------------------------------- small plants

function flower(w: World, rng: Rng, base: V3) {
  const spec = w.spec('flower');
  const h = rng.range(0.16, 0.3);
  const lean = v3(rng.range(-0.03, 0.03), 0, rng.range(-0.03, 0.03));
  const top = add(base, add(v3(0, h, 0), lean));
  const node = w.nodes.create(spec, 'flower', null, add(base, v3(lean.x / 2, h * 0.55, lean.z / 2)), h, { phase: rng.next() });
  const stalk = w.nodes.create(partSpec(spec, 'stalk'), 'flower', node, add(base, v3(lean.x / 2, h / 2, lean.z / 2)), h * 0.6);
  stalk.render = { tube: [base, add(base, add(v3(0, h * 0.5, 0), scale(lean, 0.3))), top], radii: [0.0025, 0.002, 0.0016] };
  const petals = w.nodes.create(partSpec(spec, 'petals'), 'flower', node, top, rng.range(0.04, 0.05), { motion: 'static' });
  petals.render = { hue: rng.range(0.72, 0.82) };
  w.nodes.create(partSpec(spec, 'center'), 'flower', petals, add(top, v3(0, 0.003, 0)), 0.013);
  const leafSpec = partSpec(spec, 'leaf');
  for (let k = 0; k < 2; k++) {
    const p = add(base, v3(lean.x * 0.4 + (k ? 0.012 : -0.012), h * rng.range(0.25, 0.5), lean.z * 0.4));
    const leaf = makeLeaf(w, rng, leafSpec, node, p, rng.range(0.03, 0.04));
    leaf.render.yaw = rng.range(0, 6.28);
    leaf.render.pitch = 0.5;
  }
  node.render = { kind: 'flower', base, top };
}

function mushroom(w: World, rng: Rng, base: V3) {
  const spec = w.spec('mushroom');
  const h = rng.range(0.035, 0.05), cr = rng.range(0.024, 0.034);
  const node = w.nodes.create(spec, 'mushroom', null, add(base, v3(0, h, 0)), cr * 2, { phase: rng.next() });
  node.render = { kind: 'mushroom', base, h, cr };
  const capSpec = partSpec(spec, 'cap');
  const cap = w.nodes.create(capSpec, 'mushroom', node, add(base, v3(0, h + cr * 0.3, 0)), cr * 2);
  w.nodes.create(partSpec(capSpec, 'spots'), 'mushroom', cap, cap.pos, cr * 0.7);
  w.nodes.create(partSpec(spec, 'stalk'), 'mushroom', node, add(base, v3(0, h / 2, 0)), h);
}

function grass(w: World, rng: Rng, base: V3) {
  const spec = w.spec('grass');
  const h = rng.range(0.06, 0.14) * (Math.hypot(base.x, base.z) < 2.5 ? 0.7 : 1);
  const node = w.nodes.create(spec, 'grass', null, add(base, v3(0, h * 0.5, 0)), 0.45, { motion: 'sway', phase: rng.next() });
  node.render = { kind: 'grass', base, h, r: 0.42 };
  w.nodes.create(partSpec(spec, 'blade'), 'grass', node, add(base, v3(0, h * 0.5, 0)), h * 0.8, { motion: 'sway' });
}

function rock(w: World, rng: Rng, base: V3, s: number) {
  const spec = w.spec('rock');
  const c = add(base, v3(0, s * 0.22, 0));
  const node = w.nodes.create(spec, 'rock', null, c, s, { phase: rng.next() });
  node.render = { kind: 'rock', seed: Math.floor(rng.next() * 1e6), s, yaw: rng.range(0, 6.28) };
  if (rng.chance(0.6)) w.nodes.create(partSpec(spec, 'moss'), 'rock', node, add(c, v3(0, s * 0.25, 0)), s * 0.45);
  w.physics.addFixed(node.id, add(base, v3(0, s * 0.08, 0)), { ball: s * 0.42 }, 0, w.material('rock'));
}

function pond(w: World) {
  const spec = w.spec('pond');
  const node = w.nodes.create(spec, 'pond', null, { x: POND.x, y: WATER_LEVEL, z: POND.z }, POND.r * 1.6);
  node.render = { kind: 'pond', r: POND.r };
  w.nodes.create(partSpec(spec, 'ripples'), 'pond', node, { x: POND.x - POND.r * 0.55, y: WATER_LEVEL, z: POND.z + 0.2 }, 0.3);
}

function log(w: World, at: { x: number; z: number }, rotY: number) {
  const spec = w.spec('log');
  const L = 1.0, R = 0.14, inner = 0.105;
  const y = w.groundY(at.x, at.z) + R - 0.02;
  const pos = { x: at.x, y, z: at.z };
  const node = w.nodes.create(spec, 'log', null, pos, L * 0.7);
  node.render = { kind: 'log', L, R, inner, rotY };
  const ax = { x: Math.cos(rotY), y: 0, z: -Math.sin(rotY) };
  w.nodes.create(partSpec(spec, 'hole'), 'log', node, add(pos, scale(ax, L / 2)), inner * 2);
  w.nodes.create(partSpec(spec, 'bark'), 'log', node, add(pos, v3(0, R * 0.8, 0)), R * 2);
  const boxes = [];
  const nSeg = 12;
  for (let i = 0; i < nSeg; i++) {
    const th = (i / nSeg) * Math.PI * 2;
    const rr = (R + inner) / 2;
    boxes.push({ at: v3(0, Math.cos(th) * rr, Math.sin(th) * rr), half: [L / 2, (R - inner) / 2, rr * Math.sin(Math.PI / nSeg) * 1.1] as [number, number, number], rotX: th });
  }
  w.physics.addFixedCompound(node.id, pos, rotY, boxes, w.material('bark'));
  w.shelters.push({ node: node.id, pos, rotY, halfLen: L / 2, inner });
}

function fallenLeaf(w: World, rng: Rng, at: { x: number; z: number }) {
  const spec = w.spec('leaf');
  const p = { x: at.x, y: w.groundY(at.x, at.z) + 0.02, z: at.z };
  const size = rng.range(0.045, 0.07);
  const node = w.nodes.create(spec, 'leaf', null, p, size, { motion: 'physics', phase: rng.next() });
  node.render = { yaw: rng.range(0, 6.28), hue: rng.range(0, 1) };
  w.nodes.create(partSpec(spec, 'stem'), 'leaf', node, p, size * 0.9, { motion: 'attached', local: v3() });
  w.nodes.create(partSpec(spec, 'veins'), 'leaf', node, p, size * 0.6, { motion: 'attached', local: v3() });
  const m = { ...w.material('leaf'), friction: 0.35 };
  node.body = w.physics.addDynamicBall(node.id, p, 0.006, m, 2.2, 0.5);
}

function visitorNode(w: World, at: { x: number; z: number }) {
  const spec = w.spec('visitor');
  const p = { x: at.x, y: w.groundY(at.x, at.z) + 0.16, z: at.z };
  const node = w.nodes.create(spec, 'visitor', null, p, 0.34, { motion: 'agent' });
  const head = w.nodes.create(partSpec(spec, 'head'), 'visitor', node, p, 0.11, { motion: 'attached', local: v3(0, 0.09, 0.13) });
  for (const s of [-1, 1]) {
    w.nodes.create(partSpec(partSpec(spec, 'head'), 'eyes'), 'visitor', head, p, 0.02, { motion: 'attached', local: v3(s * 0.033, 0.105, 0.19) });
    w.nodes.create(partSpec(partSpec(spec, 'head'), 'ears'), 'visitor', head, p, 0.05, { motion: 'attached', local: v3(s * 0.04, 0.17, 0.11) });
  }
  w.nodes.create(partSpec(partSpec(spec, 'head'), 'nose'), 'visitor', head, p, 0.018, { motion: 'attached', local: v3(0, 0.085, 0.22) });
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]])
    w.nodes.create(partSpec(spec, 'leg'), 'visitor', node, p, 0.13, { motion: 'attached', local: v3(sx * 0.055, -0.08, sz * 0.09) });
  w.nodes.create(partSpec(spec, 'tail'), 'visitor', node, p, 0.18, { motion: 'attached', local: v3(0, 0.02, -0.2) });
  w.nodes.create(partSpec(spec, 'fur'), 'visitor', node, p, 0.025, { motion: 'attached', local: v3(0, 0.04, 0) });
  node.render = { kind: 'visitor' };
}

export { WATER_LEVEL };
