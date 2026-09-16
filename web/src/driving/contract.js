// The application owns every output field and action. Model text is never parsed.
export const ACTIONS = Object.freeze([
  'accelerate',
  'brake',
  'hold',
  'left',
  'right',
  'boost',
  'risky_left',
  'risky_right',
  'pit',
]);

export const ACTION_LABELS = Object.freeze({
  accelerate: 'Accelerate',
  brake: 'Brake',
  hold: 'Hold speed',
  left: 'Change lane left',
  right: 'Change lane right',
  boost: 'Boost',
  risky_left: 'Risky overtake left',
  risky_right: 'Risky overtake right',
  pit: 'Pit stop',
});

// Labels are positional within the current canonical choice subset.
export const CHOICE_LABELS = Object.freeze([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
]);

// Change only after comparing real-model probes; each mode keeps the same enums.
export const DRIVING_LABEL_MODE = 'letters_compact';
export const DRIVING_LABEL_MODES = Object.freeze([
  'letters',
  'rotated',
  'semantic',
  'semantic_examples',
  'semantic_suffix',
  'letters_suffix',
  'semantic_compact',
  'letters_compact',
  'letters_focused',
]);
export const SEMANTIC_LABEL_CANDIDATES = Object.freeze({
  accelerate: Object.freeze(['Fast', 'Go']),
  brake: Object.freeze(['Slow', 'Brake']),
  hold: Object.freeze(['Stay', 'Hold']),
  left: Object.freeze(['Left']),
  right: Object.freeze(['Right']),
  boost: Object.freeze(['Boost', 'Turbo']),
  risky_left: Object.freeze(['Dive', 'Risk']),
  risky_right: Object.freeze(['Cut', 'Pass']),
  pit: Object.freeze(['Pit', 'Repair']),
});

export const DRIVERS = Object.freeze(
  [
    {
      id: 'nova',
      name: 'Nova',
      number: '01',
      color: '#c34b36',
      style: 'Win or wreck',
      defaultPrompt:
        'Overtake traffic. If a car is ahead within 30m, change into a clear neighboring lane. Prefer risky_left or risky_right to pass. Otherwise accelerate, or boost on a clear straight.',
    },
    {
      id: 'atlas',
      name: 'Atlas',
      number: '02',
      color: '#507766',
      style: 'Finish intact',
      defaultPrompt:
        'Finish intact. Brake early for the safe corner speed and slower traffic. Pass only through a clear lane; avoid risky moves. Accelerate on open straights. Pit when tyres fall below 35 or damage exceeds 45.',
    },
    {
      id: 'juno',
      name: 'Juno',
      number: '03',
      color: '#467ca4',
      style: 'Resource strategist',
      defaultPrompt:
        'Keep 75–85 km/h on clear straights; brake for corner limits. Pass slower cars through safe lanes. Conserve boost for useful overtakes. Accelerate below 75, hold within the band, and pit for worn tyres or serious damage.',
    },
    {
      id: 'milo',
      name: 'Milo',
      number: '04',
      color: '#ccaa50',
      style: 'Patient late charge',
      defaultPrompt:
        'Early laps: hold 65–75 km/h and save boost. Pass slow cars only through safe gaps. Brake for corners. Final lap: boost on clear straights and seek overtakes. If blocked, change lane before boosting.',
    },
  ].map(Object.freeze),
);

export function driverChoices(unitId, supplied) {
  if (!DRIVERS.some((driver) => driver.id === unitId))
    throw new Error('Unknown driver');
  if (supplied === undefined) return [...ACTIONS];
  if (
    !Array.isArray(supplied) ||
    !supplied.length ||
    new Set(supplied).size !== supplied.length ||
    supplied.some((action) => !ACTIONS.includes(action))
  )
    throw new Error('Invalid available driving actions');
  return ACTIONS.filter((action) => supplied.includes(action));
}
