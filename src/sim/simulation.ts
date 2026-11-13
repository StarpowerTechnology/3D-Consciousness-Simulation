// Orchestration: the fast loop (physics, motion, reflexes at 60 Hz) and the slow loop (senses → mind at 15 Hz).
// Shared by the browser app and the headless runner. Contains no rendering.
import { loadOntology, type Ontology } from '../ontology/types';
import { World, FIXED_DT } from '../world/world';
import { initPhysics } from '../world/physics';
import { CreatureBody } from '../body/creature';
import { PlayerBody } from '../body/player';
import { Senses } from '../senses/senses';
import { Mind } from '../mind/mind';
import { Gate } from '../gate/gate';
import type { MindReport, ThoughtRecord } from '../protocol/types';

export const MIND_HZ = 15;

export class Simulation {
  readonly ont: Ontology;
  world!: World;
  creature!: CreatureBody;
  player!: PlayerBody;
  senses!: Senses;
  mind!: Mind;
  gate!: Gate;
  private acc = 0;
  private mindAcc = 0;
  lastReport: MindReport | null = null;
  thoughtLog: ThoughtRecord[] = [];
  onThought: ((t: ThoughtRecord) => void) | null = null;
  onSpeech: ((text: string, who: string) => void) | null = null;

  constructor(ontologyYaml: string, readonly seed = 1) {
    this.ont = loadOntology(ontologyYaml);
  }

  async init() {
    await initPhysics();
    this.world = new World(this.ont, this.seed);
    this.creature = new CreatureBody(this.world, { x: -0.25, z: -0.35 }, 0.7);
    this.player = new PlayerBody(this.world);
    this.senses = new Senses(this.world, this.creature);
    this.mind = new Mind(this.seed * 7 + 3);
    this.gate = new Gate(this.ont.worldVocabulary);
    return this;
  }

  /** Advance by real seconds (accumulated into fixed steps). */
  advance(seconds: number, maxSteps = 8) {
    this.acc += seconds;
    let n = 0;
    while (this.acc >= FIXED_DT && n < maxSteps) {
      this.step();
      this.acc -= FIXED_DT;
      n++;
    }
    if (n >= maxSteps) this.acc = 0;
    return n;
  }

  step() {
    this.world.observers = [this.creature.pose.head, this.player.pose.head];
    this.world.step(FIXED_DT);
    this.mindAcc += FIXED_DT;
    if (this.mindAcc >= 1 / MIND_HZ) {
      const dt = this.mindAcc;
      this.mindAcc = 0;
      const frame = this.senses.frame();
      const intent = this.mind.tick(frame, dt);
      // the gate checks speech before it reaches the mouth
      if (intent.voice) {
        const g = this.gate.check(intent.voice.say, this.mind.lexicon(), this.mind.lastHeardWords, this.world.t);
        intent.voice.say = g.text;
        this.onSpeech?.(g.text, 'creature');
      }
      this.creature.setIntent(intent);
      const r = this.mind.report();
      for (const t of r.thoughts) {
        this.thoughtLog.push(t);
        this.onThought?.(t);
      }
      if (this.thoughtLog.length > 500) this.thoughtLog.splice(0, 100);
      this.lastReport = r;
    }
  }

  say(text: string) {
    this.player.say(text);
    this.onSpeech?.(text, 'you');
  }
}
