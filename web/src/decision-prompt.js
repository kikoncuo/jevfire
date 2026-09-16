import { UNIT_DEFINITIONS, ROLE_ACTIONS } from './contract.js';
import { DEFAULT_PROMPTS, CHARACTER_PROMPTS } from './prompts.js';
import { describeObservation } from './observation.js';

export const ACTION_LABELS = Object.freeze({
  forage_safe: 'Forage safely',
  forage_bold: 'Forage aggressively',
  relax: 'Relax & eat',
  train: 'Train',
  defend: 'Attack & protect',
  repair: 'Repair buildings',
  build: 'Build defenses',
  heal: 'Heal villagers',
});

export const ROLE_LABELS = Object.freeze({
  collector: ['A', 'B', 'C'],
  fighter: ['A', 'B', 'C'],
  builder: ['A', 'B', 'C', 'D'],
});

const MEANINGS = {
  forage_safe:
    'Gather food along safer routes, avoiding danger where possible; bring food home.',
  forage_bold:
    'Gather food faster by the direct route, accepting the risk of orc attacks; bring food home.',
  relax:
    'Go to the hearth, eat stored food if hungry, rest and recover. No food means no meal.',
  train: 'Train at home to permanently increase fighting strength.',
  defend:
    'Intercept orcs, attack them, and draw their aggression away from villagers and buildings.',
  repair: 'Go to the most urgent damaged building and repair it.',
  build: 'Construct defenses at a planned site; towers attack nearby orcs.',
  heal: 'Treat a wounded ally; each treatment uses one stored food.',
};

export function decisionChoices(unitId, supplied) {
  const unit = UNIT_DEFINITIONS.find((unit) => unit.id === unitId);
  if (!unit) throw new Error('Unknown villager');
  const legal = ROLE_ACTIONS[unit.role];
  if (supplied === undefined) return [...legal];
  if (
    !Array.isArray(supplied) ||
    !supplied.length ||
    new Set(supplied).size !== supplied.length ||
    supplied.some((action) => !legal.includes(action))
  )
    throw new Error('Invalid available actions');
  return legal.filter((action) => supplied.includes(action));
}

export function buildDecisionPrompt(
  unitId,
  context,
  mission = '',
  rolePrompt,
  actions,
) {
  const unit = UNIT_DEFINITIONS.find((unit) => unit.id === unitId);
  if (!unit) throw new Error('Unknown villager');
  if (typeof mission !== 'string' || mission.length > 500)
    throw new Error('Mission is too long');
  const policy = rolePrompt ?? DEFAULT_PROMPTS[unit.role];
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 1500)
    throw new Error('Role policy must contain 1–1500 characters');
  const serialized = JSON.stringify(context);
  const observation = describeObservation(context);
  if (!serialized || serialized.length > 16000)
    throw new Error('Invalid observation');
  const choices = decisionChoices(unit.id, actions);
  const labels = ROLE_LABELS[unit.role].slice(0, choices.length);
  const system = `You control one ${unit.role} in a village survival game. Choose the action that helps the villagers survive longest. Use the observed facts, not invented positions. Return only one option label: ${labels.join(', ')}.\nPersonality: ${unit.personality || unit.name}.\nRole policy: ${policy}\nCharacter priorities: ${CHARACTER_PROMPTS[unit.id] || ''}`;
  const user = `Village order: ${mission || 'Keep the villagers and hearth alive.'}\nSelected villager: ${unit.name} (${unit.id}).\nCurrent observations:\n${observation}\nActions:\n${choices.map((action, i) => `${labels[i]}: ${action} — ${MEANINGS[action]}`).join('\n')}\nChoose ${labels.join(', ')}:`;
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}
