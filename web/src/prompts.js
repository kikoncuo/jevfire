export const DEFAULT_PROMPTS = Object.freeze({
  collector:
    'Keep yourself and the village alive. Forage safely while food is needed. Use bold foraging only when food is critically low and the routes are not dangerous. Relax to walk home and eat before starvation, especially when weak or threatened. If you already carry food, either forage action returns it home. Relaxing also deposits food. Never remain relaxed with full hunger while the village runs out of food.',
  fighter:
    'Protect the villagers so the settlement survives. Defend when an orc is attacking or approaching an ally or a building; this draws nearby orcs onto you. Train when no one is threatened to raise your damage for later waves. Relax before starvation or to heal if badly injured. Defend again when recovered. Do not train while villagers are being attacked.',
  builder:
    'Keep the settlement alive. Repair damaged buildings, giving the hall and occupied defenses priority. Build towers when buildings are healthy; towers shoot orcs automatically. Relax before starvation or to heal if injured. Avoid working next to an orc that is attacking you. A destroyed hall cannot provide food or healing.',
});

export const ACTION_DESCRIPTIONS = Object.freeze({
  forage_safe:
    'Gather food along safer routes, then carry it home; slow and cautious.',
  forage_bold:
    'Rush toward richer food, then carry it home; faster but ignores route danger.',
  train: 'Train at the barracks to permanently increase attack strength.',
  defend:
    'Intercept threatening orcs, taunt them away from villagers, and fight.',
  repair: 'Travel to the most damaged building and repair it.',
  build:
    'Travel to an unfinished tower and construct a defense that shoots orcs.',
  relax:
    'Walk to the hall, deposit cargo, eat shared food, and recover health. No food means no meal.',
});

export function formatContext(context) {
  return JSON.stringify(context);
}
