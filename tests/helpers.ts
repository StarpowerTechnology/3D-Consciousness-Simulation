import { readFileSync } from 'fs';
import { Simulation } from '../src/sim/simulation';

export const YAML = readFileSync(new URL('../ontology/world.yaml', import.meta.url), 'utf8');

export async function makeSim(seed = 2) {
  return new Simulation(YAML, seed).init();
}

export function run(sim: Simulation, seconds: number) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) sim.step();
}
