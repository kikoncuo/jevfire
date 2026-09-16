export const UNIT_IDS = Object.freeze(['ember', 'moss', 'echo']);
export const ACTIONS = Object.freeze(['recover', 'return', 'evade', 'hold']);
export const SCHEMA = Object.freeze(
  Object.fromEntries(UNIT_IDS.map((id) => [id, ACTIONS])),
);

export function normalize(scores) {
  if (
    !Array.isArray(scores) ||
    !scores.length ||
    !scores.every(Number.isFinite)
  )
    throw new Error('Missing or invalid candidate scores');
  const max = Math.max(...scores);
  const weights = scores.map((value) => Math.exp(value - max));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / total);
}

export function assemble(schema, rows) {
  const fields = Object.entries(schema);
  if (rows.length !== fields.length)
    throw new Error('Scoring row count does not match schema');
  const values = [],
    details = [];
  for (let i = 0; i < fields.length; i++) {
    const [name, options] = fields[i];
    if (
      options.length < 2 ||
      new Set(options).size !== options.length ||
      rows[i].length !== options.length
    )
      throw new Error('Invalid field candidates');
    const probabilities = normalize(rows[i]);
    const winner = probabilities.indexOf(Math.max(...probabilities));
    values.push([name, options[winner]]);
    details.push([
      name,
      { value: options[winner], probabilities, logits: rows[i] },
    ]);
  }
  // Object.fromEntries creates own data properties, including unusual field names.
  return {
    parsed_json: Object.fromEntries(values),
    fields: Object.fromEntries(details),
    scores_are_calibrated: false,
  };
}

export function validateDecision(value) {
  if (
    !value ||
    Object.keys(value).length !== UNIT_IDS.length ||
    !UNIT_IDS.every(
      (id) => Object.hasOwn(value, id) && ACTIONS.includes(value[id]),
    )
  )
    throw new Error('Decision violates the fixed action contract');
  return value;
}

export function guardAction(unit, proposed, source, danger) {
  if (!ACTIONS.includes(proposed)) throw new Error('Unknown action');
  if (unit.health < 25)
    return { action: 'return', reason: 'Low health: return to base' };
  if (danger && proposed === 'recover')
    return { action: 'evade', reason: 'Hazard too close' };
  if (unit.carrying && proposed === 'recover')
    return { action: 'return', reason: 'Cargo secured: return to base' };
  if (!source.stock && proposed === 'recover')
    return { action: 'hold', reason: 'Assigned beacon is empty' };
  return { action: proposed, reason: null };
}

export function isCurrentResult(message, epoch, running) {
  return running && message.epoch === epoch;
}
