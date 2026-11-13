import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerViolations } from '../tools/check-layers';
import { loadOntology } from '../src/ontology/types';
import { YAML } from './helpers';

test('the mind imports nothing from the engine, physics or renderer', () => {
  assert.deepEqual(layerViolations(), []);
});

test('the ontology loads and every part carries words', () => {
  const o = loadOntology(YAML);
  const walk = (p: any) => { assert.ok(p.words.length > 0, `${p.path} has no words`); p.parts.forEach(walk); };
  Object.values(o.entities).forEach(walk);
  assert.ok(o.worldVocabulary.has('veins'));
});
