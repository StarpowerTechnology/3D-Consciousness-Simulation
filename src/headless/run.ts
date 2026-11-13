// Headless runner: a creature's life, fast-forwarded, with its stream of thoughts printed.
//   npm run headless -- --minutes 10 --seed 1 [--say "60:do you know what a leaf is?"]
import { readFileSync } from 'fs';
import { Simulation } from '../sim/simulation';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const minutes = Number(opt('minutes', '5'));
const seed = Number(opt('seed', '1'));
const says: { at: number; text: string }[] = [];
args.forEach((a, i) => { if (a === '--say') { const [t, ...rest] = args[i + 1].split(':'); says.push({ at: Number(t), text: rest.join(':') }); } });

const yaml = readFileSync(new URL('../../ontology/world.yaml', import.meta.url), 'utf8');
const sim = await new Simulation(yaml, seed).init();
const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
sim.onThought = (t) => console.log(`${fmt(t.t)}  ${t.aloud ? 'SAYS ' : '     '}[${t.intent}] ${t.text}`);
sim.onSpeech = (text, who) => { if (who === 'you') console.log(`${fmt(sim.world.t)}  YOU   ${text}`); };

const t0 = performance.now();
const total = minutes * 60;
let lastBeh = '';
while (sim.world.t < total) {
  for (const s of says) if (s.at <= sim.world.t && s.at > sim.world.t - 1 / 60) {
    // walk the player over first, so it can be heard
    const c = sim.creature.pos;
    sim.world.physics.setPos(sim.player.handle, { x: c.x + 0.5, y: sim.world.groundY(c.x + 0.5, c.z) + 0.12, z: c.z });
    sim.say(s.text);
  }
  sim.step();
  const b = sim.lastReport?.behavior ?? '';
  if (b !== lastBeh && args.includes('--behaviors')) { console.log(`${fmt(sim.world.t)}        <${b}> ${sim.mind.behavior.target ?? ''}`); lastBeh = b; }
}
const ms = performance.now() - t0;
const m = sim.mind;
console.log(`\n${minutes} simulated minutes in ${(ms / 1000).toFixed(1)} s (${(total / (ms / 1000)).toFixed(1)}x real time)`);
console.log('named:', m.mem.named().map((c) => c.name + (c.isPart ? '*' : '')).join(', '));
console.log('body:', Object.entries(sim.creature.bio).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
console.log('gate violations:', sim.gate.violations.length, sim.gate.violations.slice(0, 3));
if (args.includes('--facts')) console.log(m.knowledge().join('\n'));
