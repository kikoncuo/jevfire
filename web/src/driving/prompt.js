import { DRIVERS, CHOICE_LABELS, driverChoices } from './contract.js';

const MEANINGS = Object.freeze({
  accelerate: 'Raise cruise target by 14.4 km/h, up to the normal maximum.',
  brake:
    'Lower target by 21.6 km/h and cancel boost; brake before corners or traffic.',
  hold: 'Keep the current cruise target; this does not stop the car.',
  left: 'Move one lane left (toward lane 0), keeping cruise target.',
  right: 'Move one lane right (toward lane 2), keeping cruise target.',
  boost:
    'Spend energy for a 2.5s burst up to 140.4 km/h; dangerous into a bend.',
  risky_left:
    'Overtake one lane left through a tighter gap; 1s merge, following assist off for 2.2s.',
  risky_right:
    'Overtake one lane right through a tighter gap; 1s merge, following assist off for 2.2s.',
  pit: 'Commit to right-side pit entry and 6s stopped service; restore tyres, repair damage and refill boost.',
});
const COMPACT_MEANINGS = Object.freeze({
  accelerate: 'target +14.4km/h',
  brake: 'target -21.6km/h; cancel boost',
  hold: 'keep current target speed',
  left: 'safe one-lane move left',
  right: 'safe one-lane move right',
  boost: '2.5s burst to 140.4km/h; consumes energy',
  risky_left: 'tight-gap left pass; following assist off 2.2s',
  risky_right: 'tight-gap right pass; following assist off 2.2s',
  pit: 'automatic pit entry; stop 6s to repair/refill/retyre',
});

const number = (value) =>
  Number.isFinite(value) ? String(Number(value.toFixed(1))) : 'unknown';
const kmh = (mps) => number(Number.isFinite(mps) ? mps * 3.6 : undefined);

// Arithmetic facts help a small model compare observations. They never rank,
// remove or choose actions, and unknown inputs do not become invented zeroes.
export function drivingSpeedFacts(context) {
  const { self = {}, track = {} } = context || {};
  const finite = (value) =>
    Number.isFinite(value) ? Number(value.toFixed(1)) : null;
  const difference = (a, b) =>
    Number.isFinite(a) && Number.isFinite(b) ? finite(a - b) : null;
  const safeHere = Number.isFinite(track.safeSpeedHereMps)
    ? track.safeSpeedHereMps * 3.6
    : null;
  const safeNext = Number.isFinite(track.safeSpeedNextMps)
    ? track.safeSpeedNextMps * 3.6
    : null;
  return {
    actualMinusSafeHereKph: difference(self.speedKph, safeHere),
    targetMinusSafeHereKph: difference(self.targetSpeedKph, safeHere),
    actualMinusSafeNextKph: difference(self.speedKph, safeNext),
    targetMinusSafeNextKph: difference(self.targetSpeedKph, safeNext),
    brakingMarginM: difference(
      track.nextCornerDistanceM,
      track.brakingDistanceM,
    ),
    timeToCornerSeconds:
      Number.isFinite(track.nextCornerDistanceM) &&
      track.nextCornerDistanceM >= 0 &&
      Number.isFinite(self.speedMps) &&
      self.speedMps > 0
        ? finite(track.nextCornerDistanceM / self.speedMps)
        : null,
  };
}

function speedComparison(context) {
  const facts = drivingSpeedFacts(context);
  return `COMPARISONS: actual speed minus safe-now=${number(facts.actualMinusSafeHereKph)}km/h; target minus safe-now=${number(facts.targetMinusSafeHereKph)}km/h; actual minus safe-next=${number(facts.actualMinusSafeNextKph)}km/h; target minus safe-next=${number(facts.targetMinusSafeNextKph)}km/h. Positive means above safe speed. Braking margin (corner distance minus braking distance)=${number(facts.brakingMarginM)}m; negative means the corner is closer than the braking distance. Time to corner at actual speed=${number(facts.timeToCornerSeconds)}s.`;
}

function neighbor(value, direction) {
  if (!value) return `${direction}: clear within view`;
  return `${direction}: gap ${number(value.gapM)}m, speed ${Number.isFinite(value.speedKph) ? number(value.speedKph) : kmh(value.speedMps)}km/h, closing ${number(value.closingMps)}m/s, TTC ${value.ttcSeconds == null ? 'none' : `${number(value.ttcSeconds)}s`}`;
}

function rival(value) {
  if (!value) return 'none';
  const name =
    DRIVERS.find((driver) => driver.id === value.id)?.name || 'rival';
  return `${name} ${number(value.gapM)}m`;
}

function observation(context, unitId, compact = false) {
  if (
    !context ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    !context.self ||
    context.self.id !== unitId ||
    !context.track ||
    !context.race ||
    !Array.isArray(context.traffic) ||
    context.traffic.length > 3
  )
    throw new Error('Invalid driving observation');
  const serialized = JSON.stringify(context);
  if (!serialized || serialized.length > 16000)
    throw new Error('Invalid driving observation');
  const { self, track, race, traffic, assist } = context;
  const lanes = new Set();
  for (const lane of traffic) {
    if (
      !Number.isInteger(lane?.lane) ||
      lane.lane < 0 ||
      lane.lane > 2 ||
      lanes.has(lane.lane)
    )
      throw new Error('Invalid traffic lanes');
    lanes.add(lane.lane);
  }
  if (compact) {
    const car = (other) =>
      other
        ? `${number(other.gapM)}m@${Number.isFinite(other.speedKph) ? number(other.speedKph) : kmh(other.speedMps)}km/h closing=${number(other.closingMps)}m/s TTC=${other.ttcSeconds == null ? 'none' : `${number(other.ttcSeconds)}s`}`
        : 'clear';
    return [
      `YOU: speed=${number(self.speedKph)}km/h target=${number(self.targetSpeedKph)}km/h lane=${number(self.lane)}${self.changingLanes ? ' changing' : ''}; tyres=${number(self.tyres)}/100 damage=${number(self.damage)}/100 boost=${number(self.boostEnergy)}/100 active=${number(self.boostRemaining)}s.`,
      `RACE: position=${number(race.position)}/4 laps-left=${number(race.lapsRemaining)} finish=${number(race.remainingDistanceM)}m leader-gap=${number(race.gapToLeaderM)}m; ahead=${rival(race.carAhead)} behind=${rival(race.carBehind)}.`,
      `CORNER: now=${track.inBend ? 'bend' : 'straight'}/${track.wetHere ? 'wet' : 'dry'} safe=${kmh(track.safeSpeedHereMps)}km/h; next=${number(track.nextCornerDistanceM)}m/${track.nextCornerWet ? 'wet' : 'dry'} safe=${kmh(track.safeSpeedNextMps)}km/h brake-distance=${number(track.brakingDistanceM)}m.`,
      `PIT: entry=${number(track.pitEntryDistanceM)}m service-left=${number(self.pitRemaining)}s.`,
      ...traffic
        .slice()
        .sort((a, b) => a.lane - b.lane)
        .map(
          (lane) =>
            `LANE ${lane.lane}: front=${car(lane.front)}; rear=${car(lane.rear)}; safe-entry=${!!lane.canEnter} risky-entry=${!!lane.canRiskEnter}.`,
        ),
      `Lanes:0=left,2=right. Assist=${assist?.enabled ? 'on' : 'off'}, braking=${!!assist?.active}, risky-override=${number(self.riskyRemaining)}s. Overspeed corners cause spins/damage; assist never brakes for corners. Tyres100=fresh, damage100=DNF.`,
    ].join('\n');
  }
  return [
    `Race: position ${number(race.position)}/4, ${number(race.lapsRemaining)} laps left, ${number(race.remainingDistanceM)}m to finish, leader gap ${number(race.gapToLeaderM)}m. Ahead ${rival(race.carAhead)}; behind ${rival(race.carBehind)}.`,
    `Car: lane ${number(self.lane)}${self.changingLanes ? ' (changing)' : ''}, speed ${number(self.speedKph)}km/h, cruise target ${number(self.targetSpeedKph)}km/h; tyres ${number(self.tyres)}/100, damage ${number(self.damage)}/100, boost energy ${number(self.boostEnergy)}/100, boost active ${number(self.boostRemaining)}s.`,
    `Track: 0 left/inside, 1 middle, 2 right/outside. ${track.inBend ? 'In bend' : 'On straight'}, ${track.wetHere ? 'wet' : 'dry'}, safe now ${kmh(track.safeSpeedHereMps)}km/h. Next corner in ${number(track.nextCornerDistanceM)}m, ${track.nextCornerWet ? 'wet' : 'dry'}, safe ${kmh(track.safeSpeedNextMps)}km/h; braking distance ${number(track.brakingDistanceM)}m.`,
    `Pit entry in ${number(track.pitEntryDistanceM)}m; pit state ${['none', 'requested', 'entering', 'service', 'exiting'].includes(self.pitState) ? self.pitState : 'on track'}, service remaining ${number(self.pitRemaining)}s.`,
    ...traffic
      .slice()
      .sort((a, b) => a.lane - b.lane)
      .map(
        (lane) =>
          `Lane ${lane.lane}${lane.lane === self.lane ? ' (current)' : ''}: ${neighbor(lane.front, 'front')}; ${neighbor(lane.rear, 'rear')}; safe entry ${lane.canEnter ? 'yes' : 'no'}, risky entry ${lane.canRiskEnter ? 'yes' : 'no'}.`,
      ),
    `Following assist ${assist?.enabled ? 'on' : 'off'}, ${assist?.active ? 'braking now' : 'not braking'}; risky override ${number(self.riskyRemaining)}s. It never brakes for corners. Positive closing speed means a shrinking bumper gap; TTC is seconds to contact. View ${number(track.lookaheadM)}m front/${number(track.rearVisibilityM)}m rear.`,
  ].join('\n');
}

export function buildDrivingPrompt(
  unitId,
  context,
  mission = '',
  driverPrompt,
  actions,
  format = {},
) {
  const driver = DRIVERS.find((candidate) => candidate.id === unitId);
  if (!driver) throw new Error('Unknown driver');
  if (typeof mission !== 'string' || mission.length > 500)
    throw new Error('Driving mission must contain at most 500 characters');
  const policy = driverPrompt ?? driver.defaultPrompt;
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 1000)
    throw new Error('Driver policy must contain 1–1000 characters');
  const choices = driverChoices(
    driver.id,
    actions === undefined ? context?.availableActions : actions,
  );
  const labels = format.labels ?? CHOICE_LABELS.slice(0, choices.length);
  if (
    !Array.isArray(labels) ||
    labels.length !== choices.length ||
    new Set(labels).size !== labels.length ||
    labels.some(
      (label) => typeof label !== 'string' || !/^[A-Za-z]{1,12}$/.test(label),
    )
  )
    throw new Error('Invalid driving choice labels');
  const prefix = format.assistantPrefix ?? '';
  if (!['', 'Action:', 'Action:\n'].includes(prefix))
    throw new Error('Invalid driving assistant prefix');
  const examples = [];
  const example = (action, situation) => {
    const index = choices.indexOf(action);
    if (index >= 0) examples.push(`${situation} -> ${labels[index]}.`);
  };
  if (format.examples) {
    example(
      'brake',
      'Policy: cruise below 60km/h. Actual and target speed: 90km/h',
    );
    example(
      'accelerate',
      'Policy: gain speed on clear road. Actual and target: 60km/h, safe straight',
    );
    example(
      'hold',
      'Policy: save boost and hold a steady pace. At desired speed, clear road',
    );
  }
  const system = format.compact
    ? `Choose ${driver.name}'s next racing action. Follow this driver's policy using current traffic and resources. Reply with ONLY one label: ${labels.join(', ')}.\nPOLICY: ${policy}`
    : `You race as ${driver.name} in a three-lap closed-circuit race. Follow your strategy, including its speed limits or resource-saving choices, to earn the best finishing position. Overspeed in bends causes spins, tyre wear and damage; wet roads and worn tyres reduce grip. Damage 100 means race-ending retirement. Speed can win or lose the race. Return one option label: ${labels.join(', ')}.\nStrategy: ${policy}`;
  const meanings = format.compact ? COMPACT_MEANINGS : MEANINGS;
  const user = `${examples.length ? `Examples with other policies, not the current state:\n${examples.join('\n')}\nNow apply your own strategy.\n` : ''}Race order: ${mission || 'Finish three laps as far ahead as possible.'}\n${observation(context, unitId, format.compact)}${format.focused ? `\n${speedComparison(context)}` : ''}\nActions:\n${choices.map((action, i) => `${labels[i]}: ${action} — ${meanings[action]}`).join('\n')}${format.focused ? `\nYOUR DRIVER POLICY: ${policy}\nActual speed is ${number(context.self.speedKph)}km/h; cruise target is ${number(context.self.targetSpeedKph)}km/h. Apply this policy to these values and choose one available action.` : ''}\nChoose ${labels.join(', ')}:`;
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${prefix}`;
}
