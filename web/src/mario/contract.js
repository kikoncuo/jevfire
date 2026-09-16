export const DIRECTIONS = Object.freeze(['left', 'still', 'right']);
export const SPEEDS = Object.freeze(['walk', 'run']);
export const CONTROL_SCHEMA = Object.freeze({
  direction: DIRECTIONS,
  jump: Object.freeze([false, true]),
  speed: SPEEDS,
});
export const DEFAULT_POLICY =
  'Reach the flag alive. Move right and use the actual obstacle, enemy and gap distances. Jump early enough to clear tall pipes and pits. Hold jump while rising for a high jump, then release it before the next takeoff. Prefer walking near a poorly timed obstacle; running travels farther during each decision. Land on enemies from above, avoid their sides, and collect useful mushrooms when reachable.';

export function validateControl(control) {
  if (!control || typeof control !== 'object' || Array.isArray(control))
    throw new Error('Mario control must be an object');
  const keys = Object.keys(control);
  if (keys.length !== 3 || keys.some((key) => !(key in CONTROL_SCHEMA)))
    throw new Error(
      'Mario control must contain exactly direction, jump and speed',
    );
  for (const [field, choices] of Object.entries(CONTROL_SCHEMA))
    if (!choices.includes(control[field]))
      throw new Error(`Invalid Mario control: ${field}`);
  return control;
}
