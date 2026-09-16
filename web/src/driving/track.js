export const TRACK_STRAIGHT = 100;
export const TRACK_RADIUS = 38;
export const LANE_WIDTH = 4.5;
export const LANE_COUNT = 3;
export const TRACK_LENGTH = 2 * TRACK_STRAIGHT + 2 * Math.PI * TRACK_RADIUS;
export const PIT_ENTRY = 12;
export const PIT_STOP = 60;
export const PIT_EXIT = 90;
export const PIT_LANE = 3.8;

export function wetSector(seed = 7) {
  const numeric = Number(seed);
  const value = Math.abs(Math.trunc(Number.isFinite(numeric) ? numeric : 7));
  const index = value % 2;
  const start =
    index === 0 ? TRACK_STRAIGHT : 2 * TRACK_STRAIGHT + Math.PI * TRACK_RADIUS;
  return {
    index,
    start,
    end: start + Math.PI * TRACK_RADIUS,
    gripFactor: 0.72 + ((value * 17) % 9) / 100,
    label: index === 0 ? 'North wet bend' : 'South wet bend',
  };
}

export function isWet(distance, sector) {
  const d = wrapDistance(distance);
  return d >= sector.start && d < sector.end;
}

export function nextBend(distance) {
  const d = wrapDistance(distance);
  if (inBend(d)) return d;
  return d < TRACK_STRAIGHT
    ? TRACK_STRAIGHT
    : 2 * TRACK_STRAIGHT + Math.PI * TRACK_RADIUS;
}

export const wrapDistance = (distance) =>
  ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;

export function laneRadius(lane) {
  return TRACK_RADIUS + (lane - 1) * LANE_WIDTH;
}

export function laneLength(lane) {
  return 2 * TRACK_STRAIGHT + 2 * Math.PI * laneRadius(lane);
}

// Distance is measured on the middle lane, so every lane shares a cross-section.
// Heading is a Three.js Y rotation with the vehicle's nose pointing along +Z.
export function trackPose(distance, lane = 1) {
  const d = wrapDistance(distance);
  const radius = laneRadius(lane);
  const half = TRACK_STRAIGHT / 2;
  const arc = Math.PI * TRACK_RADIUS;
  if (d < TRACK_STRAIGHT) return { x: radius, z: d - half, heading: 0 };
  if (d < TRACK_STRAIGHT + arc) {
    const angle = (d - TRACK_STRAIGHT) / TRACK_RADIUS;
    return {
      x: radius * Math.cos(angle),
      z: half + radius * Math.sin(angle),
      heading: -angle,
    };
  }
  if (d < 2 * TRACK_STRAIGHT + arc)
    return {
      x: -radius,
      z: half - (d - TRACK_STRAIGHT - arc),
      heading: -Math.PI,
    };
  const angle = (d - 2 * TRACK_STRAIGHT - arc) / TRACK_RADIUS;
  return {
    x: -radius * Math.cos(angle),
    z: -half - radius * Math.sin(angle),
    heading: -Math.PI - angle,
  };
}

export function inBend(distance) {
  const d = wrapDistance(distance);
  const arc = Math.PI * TRACK_RADIUS;
  return (
    (d >= TRACK_STRAIGHT && d < TRACK_STRAIGHT + arc) ||
    d >= 2 * TRACK_STRAIGHT + arc
  );
}

export function distanceToBend(distance) {
  const d = wrapDistance(distance);
  if (inBend(d)) return 0;
  if (d < TRACK_STRAIGHT) return TRACK_STRAIGHT - d;
  return 2 * TRACK_STRAIGHT + Math.PI * TRACK_RADIUS - d;
}

// Physical lane distance at a middle-lane progress coordinate. This keeps gaps
// and speeds correct around bends, where outside lanes travel a longer arc.
export function laneDistance(distance, lane) {
  const d = wrapDistance(distance);
  const arc = Math.PI * TRACK_RADIUS;
  const scale = laneRadius(lane) / TRACK_RADIUS;
  if (d < TRACK_STRAIGHT) return d;
  if (d < TRACK_STRAIGHT + arc)
    return TRACK_STRAIGHT + (d - TRACK_STRAIGHT) * scale;
  if (d < 2 * TRACK_STRAIGHT + arc)
    return TRACK_STRAIGHT + arc * scale + d - TRACK_STRAIGHT - arc;
  return (
    2 * TRACK_STRAIGHT + arc * scale + (d - 2 * TRACK_STRAIGHT - arc) * scale
  );
}

export function forwardGap(from, to, lane) {
  const length = laneLength(lane);
  return (laneDistance(to, lane) - laneDistance(from, lane) + length) % length;
}
