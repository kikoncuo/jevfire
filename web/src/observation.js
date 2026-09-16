// A factual presentation layer for the same compact simulation observations.
// It never selects an action, replaces scores, or manufactures a target.
const number = (value) => (Number.isFinite(value) ? String(value) : 'unknown');
const location = (target) =>
  `${target.id}: ${number(target.distance)} units ${target.bearing}`;

export function describeObservation(context) {
  if (!context || !context.self || !context.village)
    throw new Error('Missing villager observation');
  const self = context.self,
    village = context.village;
  const healthRatio = self.health / self.max_health;
  const health =
    healthRatio <= 0
      ? 'dead'
      : healthRatio < 0.3
        ? 'badly wounded'
        : healthRatio < 0.8
          ? 'wounded'
          : 'healthy';
  const fullness =
    self.hunger <= 10
      ? 'almost empty'
      : self.hunger < 35
        ? 'low'
        : self.hunger >= 80
          ? 'well fed'
          : 'partly full';
  const starvation =
    self.starves_in_seconds <= 15 ? ' STARVATION IMMINENT.' : '';
  const lines = [
    `Villager: ${self.id}, ${self.role}, ${self.alive === false ? 'dead' : 'alive'}.`,
    `Health: ${number(self.health)}/${number(self.max_health)} (${health}).`,
    `Food meter: ${number(self.hunger)}/100 (${fullness}; 100 means fed, 0 means starvation death).`,
    `Time until starvation without eating: ${number(self.starves_in_seconds)} seconds.${starvation}`,
    `Walk home: ${number(self.home_walk_seconds)} seconds. Carrying: ${number(self.carrying_food)} food.`,
    `Food stored at home: ${number(village.food)} meals${village.food === 0 ? ' (PANTRY EMPTY)' : ''}. Hall health: ${number(village.hall_health_percent)}%.`,
    `Village: ${number(village.alive)} living villagers. Orc wave: ${number(village.wave)}.`,
    `Orcs targeting you: ${number(self.attacked_by)}. Villagers targeted: ${number(village.threatened_villagers)}. Buildings targeted: ${number(village.threatened_buildings)}.`,
  ];
  if (Number.isFinite(self.stamina))
    lines.push(
      `Stamina: ${self.stamina}/100 (rest restores it). ${context.rest_available_reason || ''}`,
    );
  if (Number.isFinite(self.strength))
    lines.push(`Your attack strength: ${number(self.strength)}.`);
  const orcs = context.nearest_orcs ?? [];
  lines.push(
    orcs.length
      ? `Nearest orcs:\n${orcs.map((orc) => `- ${location(orc)}, level ${number(orc.level)}, health ${number(orc.health)}, target ${orc.attacking}; could reach you in ${number(orc.reaches_me_seconds)} seconds.`).join('\n')}`
      : 'No orcs observed.',
  );
  if (Array.isArray(context.food_routes)) {
    lines.push(
      context.food_routes.length
        ? `Food patches:\n${context.food_routes.map((route) => `- ${location(route)}, ${number(route.food)} food, ${route.risk} route risk; safe collection and return takes about ${number(route.safe_round_trip_seconds)} seconds.`).join('\n')}`
        : 'No food patches have supplies.',
    );
  }
  if (Array.isArray(context.allies_under_attack)) {
    lines.push(
      context.allies_under_attack.length
        ? `Allies under attack:\n${context.allies_under_attack.map((ally) => `- ${location(ally)}, ${ally.role}, health ${number(ally.health)}.`).join('\n')}`
        : 'No other villagers are being targeted by orcs.',
    );
  }
  if (Array.isArray(context.buildings_under_attack)) {
    lines.push(
      context.buildings_under_attack.length
        ? `Buildings under attack: ${context.buildings_under_attack.map(location).join('; ')}.`
        : 'No buildings are being targeted by orcs.',
    );
  }
  if (Array.isArray(context.repairs)) {
    lines.push(
      context.repairs.length
        ? `Damaged buildings needing repair:\n${context.repairs.map((building) => `- ${location(building)}, ${number(building.health_percent)}% health${building.under_attack ? ', under orc attack' : ', not under attack'}.`).join('\n')}`
        : 'No damaged standing buildings need repair.',
    );
    lines.push(
      `Unfinished defense sites: ${number(context.defense_sites_left)}. Operating towers: ${number(context.towers_active)}.`,
    );
  }
  if (Array.isArray(context.wounded_allies)) {
    lines.push(
      context.wounded_allies.length
        ? `Wounded allies: ${context.wounded_allies.map((ally) => `${location(ally)}, ${ally.role}, HP ${number(ally.health)}/${number(ally.max_health)}`).join('; ')}. Healing costs ${number(context.healing_food_cost)} stored food per treatment.`
        : 'No wounded allies need treatment.',
    );
  }
  if (self.needs_override)
    lines.push(`Automatic self-care: ${self.needs_override}.`);
  if (context.available_actions)
    lines.push(
      `Currently available jobs: ${context.available_actions.join(', ')}.`,
    );
  lines.push(`Previous assignment (can be changed): ${self.action}.`);
  return lines.join('\n');
}
