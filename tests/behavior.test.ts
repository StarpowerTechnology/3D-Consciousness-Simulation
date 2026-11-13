// Behavior tests from the blueprint's build order (15): what "done" means, checked headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, run } from './helpers';

test('eyes: always moving; gaze shifts often and spreads over many things', async () => {
  const sim = await makeSim(4);
  const seen = new Set<string>();
  let shifts = 0, last: string | undefined = '#';
  let microOrSacc = 0;
  let prevYaw = sim.creature.pose.gazeYaw;
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    const e = sim.mind.eye;
    if (e.target !== last) { shifts++; last = e.target; if (e.target) seen.add(e.target); }
    const y = sim.creature.pose.gazeYaw;
    if (Math.abs(y - prevYaw) > 1e-5) microOrSacc++;
    prevYaw = y;
  }
  assert.ok(shifts >= 15, `only ${shifts} gaze shifts in 30 s`);
  assert.ok(seen.size >= 8, `gaze visited only ${seen.size} things`);
  assert.ok(microOrSacc > 60 * 30 * 0.8, 'the eyes stood still');
});

test('naming: things get named once; a second one is recognized, not renamed', async () => {
  const sim = await makeSim(2);
  run(sim, 150);
  const named = sim.mind.mem.named();
  assert.ok(named.length >= 4, `named only ${named.map((c) => c.name).join(', ')}`);
  const counts = new Map<string, number>();
  for (const c of named) counts.set(c.name!, (counts.get(c.name!) ?? 0) + 1);
  for (const [n, k] of counts) assert.equal(k, 1, `'${n}' was named ${k} times`);
  const nameThoughts = sim.thoughtLog.filter((t) => t.intent === 'NAME_IT');
  assert.ok(nameThoughts.length >= 3);
  // naming thoughts describe before they name
  assert.ok(nameThoughts.some((t) => /like|shape|its a/.test(t.text)));
});

test('knowledge only from measurement: unnoticed parts are not in the knowledge graph', async () => {
  const sim = await makeSim(2);
  run(sim, 120);
  const m = sim.mind;
  for (const f of m.mem.facts.values()) {
    if (f.r !== 'part_of') continue;
    // every part it knows about was noticed on some instance, or it was told
    assert.ok(f.sources.has('told') || f.sources.has('seen'), `fact without a source: ${f.s} part_of ${f.o}`);
  }
  // the hair on an ant's leg needs the eye within a few centimetres; it should not know it after 2 minutes
  assert.equal(m.mem.byWord('hair'), undefined);
});

test('taste: a berry eaten now gives energy later, and the creature learns it is food', async () => {
  const sim = await makeSim(3);
  // a low berry on the outside of a bush, approached from outside
  const w = sim.world;
  const above = (n: any) => n.pos.y - w.groundY(n.pos.x, n.pos.z);
  const berry = [...w.nodes.byId.values()]
    .filter((n) => n.spec.key === 'berry' && Math.hypot(n.pos.x - n.top.render.base.x, n.pos.z - n.top.render.base.z) > 0.15)
    .sort((a, b) => above(a) - above(b))[0];
  const base = berry.top.render.base;
  const out = Math.atan2(berry.pos.x - base.x, berry.pos.z - base.z);
  const c = sim.creature;
  // drive the body directly: this test checks the body and digestion, not the decision
  const orig = sim.mind.tick.bind(sim.mind);
  sim.mind.tick = (f, dt) => {
    const i = orig(f, dt);
    i.gaze = { mode: 'fixate', target: berry.id };
    i.locomotion = { mode: 'idle', speed: 0 };
    i.mouth = w.t < 1 ? { action: 'none' } : { action: w.t < 2 ? 'lick' : 'bite', target: berry.id };
    return i;
  };
  w.physics.setPos(c.handle, { x: berry.pos.x + Math.sin(out) * 0.066, y: w.groundY(berry.pos.x, berry.pos.z) + 0.045, z: berry.pos.z + Math.cos(out) * 0.066 });
  c.heading = out + Math.PI;
  run(sim, 0.5);
  const e0 = c.bio.energy;
  run(sim, 3);
  assert.ok(berry.removed, 'berry was not eaten (out of reach?)');
  assert.ok(c.bio.energy <= e0 + 0.01, 'energy should not arrive instantly');
  run(sim, 40);
  assert.ok(c.bio.energy > e0 + 0.05, `energy did not arrive after digestion (${e0.toFixed(2)} → ${c.bio.energy.toFixed(2)})`);
});

test('dialogue: told is not seen; claims are stored as told with a pending check', async () => {
  const sim = await makeSim(2);
  run(sim, 100);
  const m = sim.mind;
  const leaf = m.mem.byWord('leaf');
  assert.ok(leaf, 'should have discovered a leaf by now');
  const a1 = m.dialogue.hear('did you know leafs have spots on them', 'visitor_00', 0)!;
  assert.match(a1, /havent seen|aint seen|never noticed|for real/);
  assert.ok(m.mem.pendingChecks.some((p) => p.part === 'spots'));
  const a2 = m.dialogue.hear('did you know leafs have spots on them', 'visitor_00', 0)!;
  assert.match(a2, /told me|you said/);
  const a3 = m.dialogue.hear('whats a beetle?', 'visitor_00', 0)!;
  assert.match(a3, /beetle/);
  const a4 = m.dialogue.hear('do you know what a leaf is?', 'visitor_00', 0)!;
  assert.match(a4, /leaf|one/);
});

test('no leaks: across hundreds of questions, no answer contains a word it never discovered', async () => {
  const sim = await makeSim(2);
  run(sim, 90);
  const m = sim.mind;
  const vocab = [...sim.ont.worldVocabulary];
  const templates = ['do you know what a {w} is?', 'what is a {w} on a {v}?', 'did you know {w}s have {v} on their legs', 'where is the {w}?', 'what does a {w} taste like?', 'does a {w} look like anything?', 'whats a {w}', 'do you like {w}', 'what have you seen?', 'its something on a {v}', 'how you feel?', 'what are you doing?'];
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const w = vocab[i % vocab.length], v = vocab[(i * 7 + 3) % vocab.length];
    const q = templates[i % templates.length].replace('{w}', w).replace('{v}', v);
    const ans = m.dialogue.hear(q, 'visitor_00', 0);
    if (!ans) continue;
    const heard = new Set(q.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/));
    const g = sim.gate.check(ans, m.lexicon(), heard);
    assert.ok(g.ok, `leak: "${q}" → "${ans}" (${g.offending.join(', ')})`);
    n++;
  }
  assert.ok(n > 300);
  // and nothing it said on its own leaked either
  assert.equal(sim.gate.violations.length, 0);
});
