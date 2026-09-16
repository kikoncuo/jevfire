import { ACTION_LABELS } from './decision-prompt.js';

export const SOURCE_LABELS = Object.freeze({
  model: 'Qwen',
  scripted: 'Scripted',
  rule: 'Game rule',
  needs: 'Automatic needs',
});

// A compact journal of applied decisions and visible game-rule transitions.
// Records facts only: this scorer does not generate explanations or reasoning.
export class DecisionJournal {
  constructor(limit = 6) {
    this.limit = limit;
    this.reset();
  }
  reset() {
    this.rows = new Map();
    this.commands = new Map();
    this.sequence = 0;
  }
  record(unitId, { action, source, at, detail = '' }) {
    const previous = this.commands.get(unitId);
    if (
      source !== 'model' &&
      source !== 'needs' &&
      previous?.action === action &&
      previous?.source === source
    )
      return;
    const entry = { id: ++this.sequence, action, source, at, detail };
    const rows = [entry, ...(this.rows.get(unitId) || [])].slice(0, this.limit);
    this.rows.set(unitId, rows);
    if (source !== 'needs') this.commands.set(unitId, entry);
    return entry;
  }
  history(unitId) {
    return this.rows.get(unitId) || [];
  }
  command(unitId) {
    return this.commands.get(unitId);
  }
}

export function targetName(game, id) {
  if (!id) return 'No target';
  const unit = game.units.find((u) => u.id === id);
  if (unit) return unit.name;
  const names = {
    hall: 'Hall / canteen',
    training: 'Training yard',
    clinic: 'Medic bench',
    'west-garden': 'West garden',
    'east-garden': 'East garden',
    'north-grove': 'North grove',
    'far-grove': 'Far grove',
  };
  if (names[id]) return names[id];
  const building = game.buildings.find((b) => b.id === id);
  if (building)
    return building.type === 'tower'
      ? `Tower ${id.split('-').pop()}`
      : 'Cottage';
  return id.replaceAll('-', ' ');
}

export function currentActivity(game, unit) {
  if (!unit.alive) return 'Died';
  const target = targetName(game, unit.autoTargetId || unit.targetId);
  if (unit.needsState === 'no_food') return 'Looking for food · none available';
  if (unit.needsState === 'seeking_food') return `Going to eat · ${target}`;
  if (unit.activity === 'eating') return `Eating · ${target}`;
  if (unit.activity === 'walking') return `Walking to ${target}`;
  const activities = {
    training: 'Training',
    gathering: 'Gathering food',
    fighting: 'Fighting',
    healing: 'Treating an ally',
    building: 'Constructing a defense',
    repairing: 'Repairing',
    resting: 'Resting',
    waiting: 'Waiting for a new decision',
    guarding: 'Guarding',
  };
  return activities[unit.activity] || 'Awaiting orders';
}

export function currentJob(unit, command, hasStarted) {
  if (!unit.alive)
    return {
      label: 'Died',
      source: '',
      detail: unit.reason || 'No further decisions',
    };
  if (!hasStarted)
    return {
      label: 'Awaiting orders',
      source: '',
      detail: 'Start the village to see decisions.',
    };
  if (unit.needsOverride)
    return {
      label: unit.needsState === 'no_food' ? 'Find food' : 'Meal break',
      source: 'needs',
      detail: unit.needsOverride,
    };
  if (unit.ruleAction)
    return {
      label: ACTION_LABELS[unit.action] || unit.action,
      source: 'rule',
      detail: unit.ruleReason || 'Only available action',
    };
  if (unit.activity === 'waiting')
    return {
      label: 'Waiting for a decision',
      source: '',
      detail: unit.reason || 'The previous job is no longer available.',
    };
  return {
    label: ACTION_LABELS[unit.action] || unit.action,
    source: command?.source || '',
    detail: unit.reason || 'Following the selected job.',
  };
}
