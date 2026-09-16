import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  decisionChoices,
  buildDecisionPrompt,
} from '../src/decision-prompt.js';

test('dynamic jobs preserve canonical label-to-action order', () => {
  assert.deepEqual(decisionChoices('nell', ['relax', 'heal']), [
    'heal',
    'relax',
  ]);
  const prompt = buildDecisionPrompt(
    'nell',
    new Game().contextFor('nell'),
    '',
    'Help wounded friends.',
    ['relax', 'heal'],
  );
  assert.match(prompt, /A: heal/);
  assert.match(prompt, /B: relax/);
  assert.doesNotMatch(prompt, /C:|D:/);
});

test('prompt candidate sets reject unknown, duplicate, and cross-role jobs', () => {
  for (const actions of [[], ['heal', 'heal'], ['fly'], ['train']])
    assert.throws(() => decisionChoices('nell', actions));
  assert.deepEqual(decisionChoices('nell', ['build']), ['build']);
});

test('the full editable policy limit leaves room for separate character instructions', () => {
  const context = new Game().contextFor('mira');
  assert.doesNotThrow(() =>
    buildDecisionPrompt('mira', context, '', 'x'.repeat(1500)),
  );
  assert.throws(
    () => buildDecisionPrompt('mira', context, '', 'x'.repeat(1501)),
    /1500/,
  );
  assert.match(
    buildDecisionPrompt('mira', context, '', 'Gather food.'),
    /Character priorities: You are Mira/,
  );
});
