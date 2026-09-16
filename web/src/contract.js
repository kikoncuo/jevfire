export const ROLE_ACTIONS = Object.freeze({
  collector: Object.freeze(['forage_safe', 'forage_bold', 'relax']),
  fighter: Object.freeze(['train', 'defend', 'relax']),
  builder: Object.freeze(['repair', 'build', 'heal', 'relax']),
});
export const UNIT_DEFINITIONS = Object.freeze(
  [
    {
      id: 'mira',
      name: 'Mira',
      role: 'collector',
      color: '#dca653',
      disposition: 'cautious',
      personality:
        'A cautious scout who chooses safer food routes and brings supplies home.',
    },
    {
      id: 'bram',
      name: 'Bram',
      role: 'collector',
      color: '#d8c077',
      disposition: 'leisurely',
      personality:
        'A lazy forager who likes short trips, full baskets, and a long lunch once the pantry is stocked.',
    },
    {
      id: 'aldric',
      name: 'Aldric',
      role: 'fighter',
      color: '#7eabbc',
      disposition: 'protective',
      personality:
        'A protective veteran who puts threatened villagers and buildings before personal glory.',
    },
    {
      id: 'sable',
      name: 'Sable',
      role: 'fighter',
      color: '#9cb5cb',
      disposition: 'ambitious',
      personality:
        'An ambitious fighter who loves training for stronger attacks but answers real calls for help.',
    },
    {
      id: 'tomas',
      name: 'Tomas',
      role: 'builder',
      color: '#c08160',
      disposition: 'industrious',
      personality:
        'An industrious architect who repairs the hall and builds a strong ring of defenses.',
    },
    {
      id: 'nell',
      name: 'Nell',
      role: 'builder',
      color: '#c4a3a0',
      disposition: 'compassionate',
      personality:
        'A medic and builder who spends food to heal wounded friends before expanding the settlement.',
    },
  ].map(Object.freeze),
);
export const UNIT_IDS = Object.freeze(UNIT_DEFINITIONS.map((unit) => unit.id));
export const ACTIONS = Object.freeze([
  ...new Set(Object.values(ROLE_ACTIONS).flat()),
]);

export function schemaFor(units = UNIT_DEFINITIONS) {
  return Object.fromEntries(
    units
      .filter((unit) => unit.alive !== false)
      .map((unit) => {
        if (
          !UNIT_DEFINITIONS.some(
            (definition) =>
              definition.id === unit.id && definition.role === unit.role,
          )
        )
          throw new Error('Unknown actor or role');
        return [unit.id, ROLE_ACTIONS[unit.role]];
      }),
  );
}
export const SCHEMA = Object.freeze(schemaFor());

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
  if (!Array.isArray(rows) || rows.length !== fields.length)
    throw new Error('Scoring row count does not match schema');
  const values = [],
    details = [];
  for (let i = 0; i < fields.length; i++) {
    const [name, options] = fields[i];
    if (
      !Array.isArray(options) ||
      options.length < 1 ||
      new Set(options).size !== options.length ||
      !Array.isArray(rows[i]) ||
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
  // Only application-owned keys and enum values enter the result. Model text is never parsed.
  return {
    parsed_json: Object.fromEntries(values),
    fields: Object.fromEntries(details),
    scores_are_calibrated: false,
  };
}

export function validateDecision(value, schema = SCHEMA) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(schema).length ||
    !Object.entries(schema).every(
      ([id, options]) =>
        Object.hasOwn(value, id) && options.includes(value[id]),
    )
  )
    throw new Error('Decision violates the fixed action contract');
  return value;
}

export function isCurrentResult(message, epoch, running) {
  return running && message.epoch === epoch;
}
