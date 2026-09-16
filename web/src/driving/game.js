import { ACTIONS, DRIVERS } from './contract.js';
import {
  LANE_COUNT,
  TRACK_LENGTH,
  TRACK_RADIUS,
  PIT_ENTRY,
  PIT_STOP,
  PIT_EXIT,
  PIT_LANE,
  distanceToBend,
  forwardGap,
  inBend,
  isWet,
  nextBend,
  laneRadius,
  trackPose,
  wetSector,
  wrapDistance,
} from './track.js';

export const MAX_SPEED = 31;
export const BOOST_SPEED = 39;
export const RACE_LAPS = 3;
export const RACE_DISTANCE = RACE_LAPS * TRACK_LENGTH;
export const RACE_TIME_LIMIT = 180;
export const CAR_LENGTH = 4.4;
export const FIXED_STEP = 1 / 60;
export const BOOST_BURST_SECONDS = 2.5;
export const PIT_SERVICE_SECONDS = 6;
const ACCELERATION = 3.4;
const BRAKE_DECELERATION = 6;
const EMERGENCY_DECELERATION = 12;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const ttc = (gap, closing) =>
  closing > 0.1 ? Math.max(0, gap / closing) : null;
const pairKey = (a, b) => [a.id, b.id].sort().join(':');
const laneDelta = (action) =>
  action.endsWith('left') ? -1 : action.endsWith('right') ? 1 : 0;
const riskyAction = (action) =>
  action === 'risky_left' || action === 'risky_right';
const inPit = (car) =>
  ['entering', 'service', 'exiting'].includes(car.pitState);
const terminal = (car) => car.finished || car.retired;
const competingMerge = (a, b, lane) => {
  const separation =
    Math.min(
      forwardGap(a.distance, b.distance, lane),
      forwardGap(b.distance, a.distance, lane),
    ) - CAR_LENGTH;
  return separation < Math.max(8, a.speed, b.speed);
};

function makeCar(definition, progress, lane, speed, controlled) {
  const distance = wrapDistance(progress);
  return {
    ...definition,
    controlled,
    alive: true,
    distance,
    progress,
    startProgress: progress,
    totalDistance: 0,
    lane,
    lanePosition: lane,
    speed,
    targetSpeed: speed,
    cruiseSpeed: speed,
    action: 'hold',
    source: controlled ? 'ready' : 'traffic',
    braking: false,
    assisting: false,
    assistReason: '',
    assistCount: 0,
    lastAssistTime: -Infinity,
    lap: 1,
    laps: 0,
    overtakes: 0,
    contacts: 0,
    lastDecisionAt: null,
    tyres: 100,
    damage: 0,
    boostEnergy: 100,
    boostRemaining: 0,
    boosting: false,
    riskyRemaining: 0,
    spinning: false,
    spinRemaining: 0,
    spinAngle: 0,
    spins: 0,
    cornerStress: 0,
    finished: false,
    retired: false,
    retirementReason: '',
    finishTime: null,
    racePosition: 0,
    raceDistance: 0,
    pitState: 'none',
    pitRemaining: 0,
    pitStops: 0,
    pitLap: null,
    offTrack: false,
    safeSpeedHere: MAX_SPEED,
    safeSpeedNext: MAX_SPEED,
    nextCornerDistance: 0,
    brakingDistance: 0,
    ...trackPose(distance, lane),
  };
}

export class DrivingGame {
  constructor(options = {}) {
    this.assistEnabled = true;
    this.reset(options);
  }

  reset({ seed = this.seed ?? 7 } = {}) {
    this.seed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 7;
    this.wetSector = wetSector(this.seed);
    this.time = 0;
    this.running = false;
    this.over = false;
    this.endReason = '';
    this.winner = null;
    this.winnerTime = null;
    this.accumulator = 0;
    this.events = [];
    this.contactCount = 0;
    this.contactTimes = new Map();
    this.passTimes = new Map();
    const slots = [
      { progress: -6, lane: 0 },
      { progress: -6, lane: 2 },
      { progress: -13, lane: 0 },
      { progress: -13, lane: 2 },
    ];
    const rotation = ((this.seed % 4) + 4) % 4;
    this.drivers = DRIVERS.map((driver, index) => {
      const slot = slots[(index + rotation) % slots.length];
      return makeCar(driver, slot.progress, slot.lane, 17, true);
    });
    this.cars = [
      ...this.drivers,
      ...[72, 133, 200, 268, 331, 397].map((distance, index) =>
        makeCar(
          {
            id: `traffic-${index + 1}`,
            name: `Traffic ${index + 1}`,
            number: String(index + 5).padStart(2, '0'),
            color: ['#a6a9a3', '#9eaaa8', '#c4c0b7'][index % 3],
          },
          distance,
          index % 3,
          [15, 19, 17, 21, 16, 20][index],
          false,
        ),
      ),
    ];
    this.previousOrder = new Map();
    this.captureOrder();
    this.updateRanking();
    for (const car of this.cars) this.updateRiskState(car);
    return this;
  }

  car(carOrId) {
    const car =
      typeof carOrId === 'string'
        ? this.cars.find((candidate) => candidate.id === carOrId)
        : carOrId;
    if (!car || !this.cars.includes(car)) throw new Error('Unknown car');
    return car;
  }

  event(type, car, message, detail = {}) {
    this.events.push({
      type,
      carId: car.id,
      time: this.time,
      message,
      ...detail,
    });
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
  }

  onRoad(car) {
    return (
      !terminal(car) && car.pitState !== 'service' && car.lanePosition < 2.7
    );
  }

  nearby(carOrId, lane, includeReservations = true) {
    const car = this.car(carOrId);
    let front = null,
      rear = null;
    for (const other of this.cars) {
      if (other === car || !this.onRoad(other)) continue;
      const occupiesLane =
        Math.abs(other.lanePosition - lane) < 0.7 ||
        (includeReservations && other.lane === lane);
      if (!occupiesLane) continue;
      const ahead = forwardGap(car.distance, other.distance, lane) - CAR_LENGTH;
      const behind =
        forwardGap(other.distance, car.distance, lane) - CAR_LENGTH;
      if (!front || ahead < front.gap) front = { car: other, gap: ahead };
      if (!rear || behind < rear.gap) rear = { car: other, gap: behind };
    }
    return { front, rear };
  }

  canEnter(carOrId, lane, risky = false) {
    const car = this.car(carOrId);
    if (lane < 0 || lane >= LANE_COUNT || !Number.isInteger(lane)) return false;
    if (
      Math.abs(car.lanePosition - car.lane) > 0.03 ||
      terminal(car) ||
      car.spinning
    )
      return false;
    const { front, rear } = this.nearby(car, lane);
    if (risky) return (!front || front.gap > 1.2) && (!rear || rear.gap > 1.2);
    const frontClosing = front ? Math.max(0, car.speed - front.car.speed) : 0;
    const rearClosing = rear ? Math.max(0, rear.car.speed - car.speed) : 0;
    return (
      (!front ||
        front.gap > Math.max(8, car.speed * 0.55, frontClosing * 2.4)) &&
      (!rear || rear.gap > Math.max(7, rear.car.speed * 0.4, rearClosing * 2.4))
    );
  }

  availableActions(carOrId) {
    const car = this.car(carOrId);
    if (
      !car.controlled ||
      terminal(car) ||
      car.spinning ||
      inPit(car) ||
      this.over
    )
      return [];
    if (car.pitState === 'requested') return ['hold'];
    return ACTIONS.filter((action) => {
      if (action === 'accelerate') return car.targetSpeed < MAX_SPEED - 0.01;
      if (action === 'brake')
        return car.targetSpeed > 0.01 || car.boostRemaining > 0;
      if (action === 'left')
        return car.pitState === 'none' && this.canEnter(car, car.lane - 1);
      if (action === 'right')
        return car.pitState === 'none' && this.canEnter(car, car.lane + 1);
      if (riskyAction(action))
        return (
          car.pitState === 'none' &&
          this.canEnter(car, car.lane + laneDelta(action), true)
        );
      if (action === 'boost')
        return (
          car.boostEnergy > 3 &&
          car.boostRemaining <= 0 &&
          car.pitState === 'none'
        );
      if (action === 'pit') return car.pitState === 'none';
      return action === 'hold';
    });
  }

  apply(decisions, source = 'model') {
    if (
      !decisions ||
      typeof decisions !== 'object' ||
      Array.isArray(decisions) ||
      !Object.keys(decisions).length
    )
      throw new Error('Decisions must be an object keyed by driver id');
    const entries = Object.entries(decisions).map(([id, action]) => {
      const car = this.car(id);
      if (!car.controlled || !this.availableActions(car).includes(action))
        throw new Error(`Unavailable action for ${id}: ${String(action)}`);
      return { car, action };
    });
    const laneRequests = entries
      .filter(({ action }) => laneDelta(action) !== 0)
      .map(({ car, action }) => ({
        car,
        action,
        lane: car.lane + laneDelta(action),
      }));
    for (let i = 0; i < laneRequests.length; i++) {
      for (let j = i + 1; j < laneRequests.length; j++) {
        const a = laneRequests[i],
          b = laneRequests[j];
        if (a.lane !== b.lane || riskyAction(a.action) || riskyAction(b.action))
          continue;
        if (competingMerge(a.car, b.car, a.lane))
          throw new Error('Conflicting simultaneous lane changes');
      }
    }
    for (const { car, action } of entries) {
      car.action = action;
      car.source = source;
      car.lastDecisionAt = this.time;
      if (action === 'accelerate')
        car.targetSpeed = Math.min(MAX_SPEED, car.targetSpeed + 4);
      if (action === 'brake') {
        car.targetSpeed = Math.max(0, car.targetSpeed - 6);
        car.boostRemaining = 0;
        car.boosting = false;
      }
      if (laneDelta(action)) car.lane += laneDelta(action);
      if (riskyAction(action)) car.riskyRemaining = 2.2;
      if (action === 'boost') {
        car.boostRemaining = Math.min(
          BOOST_BURST_SECONDS,
          car.boostEnergy / 12.5,
        );
        car.boosting = true;
        this.event('boost', car, `${car.name} engaged boost`, {
          seconds: car.boostRemaining,
        });
      }
      if (action === 'pit') {
        car.pitState = 'requested';
        car.boostRemaining = 0;
        car.boosting = false;
        this.event('pit', car, `${car.name} requested a pit stop`, {
          phase: 'requested',
        });
      }
      this.event('decision', car, `${car.name}: ${action}`, { action, source });
    }
    return decisions;
  }

  safeSpeed(car, distance = car.distance, lane = car.lanePosition) {
    if (!inBend(distance)) return MAX_SPEED;
    const tyreGrip = 0.66 + (0.34 * clamp(car.tyres, 0, 100)) / 100;
    const damageGrip = 1 - clamp(car.damage, 0, 100) * 0.0012;
    const weatherGrip = isWet(distance, this.wetSector)
      ? this.wetSector.gripFactor
      : 1;
    return (
      27.5 *
      Math.sqrt(laneRadius(clamp(lane, 0, 2)) / TRACK_RADIUS) *
      tyreGrip *
      damageGrip *
      weatherGrip
    );
  }

  updateRiskState(car) {
    car.safeSpeedHere = this.safeSpeed(car);
    car.safeSpeedNext = this.safeSpeed(car, nextBend(car.distance));
    car.nextCornerDistance = distanceToBend(car.distance);
    car.brakingDistance = Math.max(
      0,
      (car.speed ** 2 - car.safeSpeedNext ** 2) / (2 * BRAKE_DECELERATION),
    );
  }

  // This baseline is deliberately labelled scripted. Model mode never calls it.
  scripted() {
    const reservations = [];
    const choices = {};
    for (const [index, car] of this.drivers.entries()) {
      const options = this.availableActions(car);
      if (!options.length) continue;
      const front = this.nearby(car, car.lane).front;
      const reckless = index === 0;
      const cautious = index === 1;
      const lateCharge = index === 3 && car.laps >= 2;
      const braking =
        inBend(car.distance) ||
        car.nextCornerDistance < car.brakingDistance + (cautious ? 20 : 12);
      const desired = reckless
        ? 31
        : braking
          ? car.safeSpeedNext * (cautious ? 0.9 : 0.98)
          : cautious
            ? 26
            : 31;
      let action = 'hold';
      if (
        options.includes('pit') &&
        !reckless &&
        (car.damage > 38 ||
          car.tyres < 47 ||
          (index === 2 && car.boostEnergy < 10 && car.laps < 2))
      )
        action = 'pit';
      else if (car.pitState === 'requested') action = 'hold';
      else if (
        !reckless &&
        (car.speed > desired + 1.2 || car.targetSpeed > desired + 2)
      )
        action = 'brake';
      else {
        if (front && front.gap < 48 && front.car.speed < desired - 1) {
          const alternatives = [
            { action: reckless ? 'risky_left' : 'left', lane: car.lane - 1 },
            { action: reckless ? 'risky_right' : 'right', lane: car.lane + 1 },
          ]
            .filter(
              (entry) =>
                options.includes(entry.action) &&
                (reckless ||
                  !reservations.some(
                    (reservation) =>
                      reservation.lane === entry.lane &&
                      competingMerge(car, reservation.car, entry.lane),
                  )),
            )
            .sort(
              (a, b) =>
                (this.nearby(car, b.lane).front?.gap ?? TRACK_LENGTH) -
                (this.nearby(car, a.lane).front?.gap ?? TRACK_LENGTH),
            );
          if (alternatives.length) action = alternatives[0].action;
          else if (
            front.gap < Math.max(13, car.speed) &&
            car.speed > front.car.speed + 1 &&
            !reckless
          )
            action = 'brake';
        }
        if (
          action === 'hold' &&
          options.includes('boost') &&
          (reckless ||
            (!braking &&
              car.nextCornerDistance > 75 &&
              (index === 2 || lateCharge)))
        )
          action = 'boost';
        else if (action === 'hold' && car.targetSpeed < desired - 1.5)
          action = 'accelerate';
      }
      if (!options.includes(action)) action = 'hold';
      if (laneDelta(action))
        reservations.push({ car, lane: car.lane + laneDelta(action) });
      choices[car.id] = action;
    }
    return choices;
  }

  contextFor(id) {
    const car = this.car(id);
    this.updateRiskState(car);
    const describe = (entry, rear = false) => {
      if (!entry || entry.gap > (rear ? 80 : 140)) return null;
      const closing = rear
        ? entry.car.speed - car.speed
        : car.speed - entry.car.speed;
      const seconds = ttc(entry.gap, closing);
      return {
        id: entry.car.id,
        name: entry.car.name,
        controlled: entry.car.controlled,
        speedMps: round(entry.car.speed),
        speedKph: round(entry.car.speed * 3.6),
        gapM: round(entry.gap),
        closingMps: round(closing),
        ttcSeconds: seconds === null ? null : round(seconds),
      };
    };
    const standings = this.orderedDrivers();
    const ahead = standings
      .filter(
        (other) =>
          other !== car && !other.retired && other.progress > car.progress,
      )
      .at(-1);
    const behind = standings.find(
      (other) =>
        other !== car && !other.retired && other.progress < car.progress,
    );
    const leader = standings.find((other) => !other.retired) ?? standings[0];
    const pitDistance =
      (PIT_ENTRY - car.distance + TRACK_LENGTH) % TRACK_LENGTH;
    return {
      scenario:
        'Three-lap closed-circuit race. First across the shared finish wins; all traffic moves forward.',
      timeSeconds: round(this.time),
      self: {
        id: car.id,
        name: car.name,
        lane: car.lane,
        lanePosition: round(car.lanePosition, 2),
        changingLanes: Math.abs(car.lanePosition - car.lane) > 0.03,
        distanceAlongTrackM: round(car.distance),
        speedMps: round(car.speed),
        speedKph: round(car.speed * 3.6),
        targetSpeedMps: round(car.targetSpeed),
        targetSpeedKph: round(car.targetSpeed * 3.6),
        action: car.action,
        source: car.source,
        laps: car.laps,
        overtakes: car.overtakes,
        contacts: car.contacts,
        assists: car.assistCount,
        tyres: round(car.tyres),
        damage: round(car.damage),
        boostEnergy: round(car.boostEnergy),
        boostRemaining: round(car.boostRemaining),
        spinning: car.spinning,
        spinRemaining: round(car.spinRemaining),
        riskyRemaining: round(car.riskyRemaining),
        pitState: car.pitState,
        pitRemaining: round(car.pitRemaining),
        finished: car.finished,
        retired: car.retired,
        racePosition: car.racePosition,
        raceDistanceM: round(car.raceDistance),
      },
      race: {
        laps: RACE_LAPS,
        totalDistanceM: round(RACE_DISTANCE),
        position: car.racePosition,
        remainingDistanceM: round(Math.max(0, RACE_DISTANCE - car.progress)),
        lapsRemaining: Math.max(0, RACE_LAPS - car.laps),
        leaderId: leader?.id ?? null,
        gapToLeaderM: round(
          Math.max(0, (leader?.progress ?? car.progress) - car.progress),
        ),
        carAhead: ahead
          ? { id: ahead.id, gapM: round(ahead.progress - car.progress) }
          : null,
        carBehind: behind
          ? { id: behind.id, gapM: round(car.progress - behind.progress) }
          : null,
        timeLimitSeconds: RACE_TIME_LIMIT,
        winnerId: this.winner,
      },
      track: {
        lanes: LANE_COUNT,
        laneOrder: '0 left/inside, 1 middle, 2 right/outside',
        lengthM: round(TRACK_LENGTH),
        maximumSpeedMps: MAX_SPEED,
        boostMaximumSpeedMps: BOOST_SPEED,
        speedLimitKph: round(MAX_SPEED * 3.6),
        inBend: inBend(car.distance),
        distanceToBendM: round(car.nextCornerDistance),
        safeSpeedHereMps: round(car.safeSpeedHere),
        safeSpeedNextMps: round(car.safeSpeedNext),
        nextCornerDistanceM: round(car.nextCornerDistance),
        brakingDistanceM: round(car.brakingDistance),
        wetHere: isWet(car.distance, this.wetSector),
        nextCornerWet: isWet(nextBend(car.distance), this.wetSector),
        wetSector: {
          startM: round(this.wetSector.start),
          endM: round(this.wetSector.end),
          gripFactor: this.wetSector.gripFactor,
        },
        pitEntryDistanceM: round(pitDistance),
        lookaheadM: 140,
        rearVisibilityM: 80,
      },
      traffic: [0, 1, 2].map((lane) => {
        const nearby = this.nearby(car, lane);
        return {
          lane,
          label: ['left / inside', 'middle', 'right / outside'][lane],
          front: describe(nearby.front),
          rear: describe(nearby.rear, true),
          canEnter: lane !== car.lane && this.canEnter(car, lane),
          canRiskEnter: lane !== car.lane && this.canEnter(car, lane, true),
        };
      }),
      assist: {
        enabled: this.assistEnabled,
        active: car.assisting,
        interventions: car.assistCount,
        reason: car.assistReason,
        suppressedForRisk: car.riskyRemaining > 0,
        cornersProtected: false,
      },
      availableActions: this.availableActions(car),
      units: {
        speed: 'm/s and km/h explicitly named',
        distance: 'metres',
        time: 'seconds',
        resources:
          '0–100; higher tyres/boost is better, lower damage is better',
      },
    };
  }

  update(dt) {
    if (!this.running || this.over || !Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(0.25, dt);
    while (this.accumulator + 1e-10 >= FIXED_STEP && !this.over) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
  }

  pitController(car, dt) {
    if (car.pitState === 'none') return null;
    if (car.pitState === 'requested') {
      if (car.lane < 2 && this.canEnter(car, car.lane + 1)) car.lane += 1;
      const distance = (PIT_ENTRY - car.distance + TRACK_LENGTH) % TRACK_LENGTH;
      if (
        car.lane === 2 &&
        Math.abs(car.lanePosition - 2) < 0.03 &&
        car.distance >= PIT_ENTRY &&
        car.distance <= PIT_ENTRY + 7 &&
        car.speed < 19
      ) {
        car.pitState = 'entering';
        car.pitLap = Math.floor(car.progress / TRACK_LENGTH);
        car.lane = PIT_LANE;
        this.event('pit', car, `${car.name} entered the pit lane`, {
          phase: 'entering',
        });
      }
      const cornerApproach =
        inBend(car.distance) ||
        car.nextCornerDistance < car.brakingDistance + 18;
      return Math.min(
        24,
        distance < 80 ? 12 : MAX_SPEED,
        cornerApproach ? car.safeSpeedNext * 0.92 : MAX_SPEED,
      );
    }
    if (car.pitState === 'service') {
      car.speed = 0;
      car.pitRemaining = Math.max(0, car.pitRemaining - dt);
      if (car.pitRemaining <= 0) {
        car.tyres = 100;
        car.damage = 0;
        car.boostEnergy = 100;
        car.cornerStress = 0;
        car.pitStops++;
        car.pitState = 'exiting';
        car.targetSpeed = Math.max(car.targetSpeed, 17);
        this.event('pit', car, `${car.name} completed six-second service`, {
          phase: 'serviced',
        });
      }
      return 0;
    }
    if (car.pitState === 'entering') {
      const stopDistance = car.pitLap * TRACK_LENGTH + PIT_STOP - car.progress;
      return Math.min(
        12,
        Math.sqrt(2 * BRAKE_DECELERATION * Math.max(0, stopDistance - 0.1)),
      );
    }
    if (car.pitState === 'exiting') {
      if (
        car.distance >= PIT_EXIT - 17 &&
        car.lane === PIT_LANE &&
        this.canEnter(car, 2)
      )
        car.lane = 2;
      if (car.lane === 2 && Math.abs(car.lanePosition - 2) < 0.03) {
        car.pitState = 'none';
        this.event('pit', car, `${car.name} rejoined the race`, {
          phase: 'exit',
        });
        return car.targetSpeed;
      }
      if (car.lane === PIT_LANE)
        return Math.min(
          12,
          Math.sqrt(
            2 * BRAKE_DECELERATION * Math.max(0, PIT_EXIT - 2 - car.distance),
          ),
        );
      return 12;
    }
    return null;
  }

  step(dt) {
    this.time += dt;
    const oldProgress = this.cars.map((car) => car.progress);
    const accelerations = this.cars.map((car) => {
      this.updateRiskState(car);
      car.riskyRemaining = Math.max(0, car.riskyRemaining - dt);
      if (terminal(car)) return -EMERGENCY_DECELERATION;
      if (car.spinning) {
        car.spinRemaining = Math.max(0, car.spinRemaining - dt);
        car.spinAngle = ((2.4 - car.spinRemaining) / 2.4) * Math.PI * 4;
        if (car.spinRemaining <= 0) {
          car.spinning = false;
          car.spinAngle = 0;
        }
        car.assisting = false;
        car.braking = true;
        return -4;
      }
      const pitTarget = this.pitController(car, dt);
      car.boosting =
        car.boostRemaining > 0 &&
        car.boostEnergy > 0 &&
        car.pitState === 'none';
      if (car.boosting) {
        const consumed = Math.min(
          dt,
          car.boostRemaining,
          car.boostEnergy / 12.5,
        );
        car.boostEnergy = Math.max(0, car.boostEnergy - consumed * 12.5);
        car.boostRemaining = Math.max(0, car.boostRemaining - consumed);
      }
      const damagePower = 1 - car.damage * 0.0025;
      const maximum = (car.boosting ? BOOST_SPEED : MAX_SPEED) * damagePower;
      const target = Math.min(
        maximum,
        pitTarget ??
          (car.controlled
            ? car.boosting
              ? BOOST_SPEED
              : car.targetSpeed
            : car.cruiseSpeed),
      );
      let acceleration = clamp(
        (target - car.speed) * 1.8,
        -BRAKE_DECELERATION,
        (car.boosting ? 7 : ACCELERATION) * damagePower,
      );
      const targetFront = this.nearby(car, car.lane).front;
      const currentFront = this.nearby(car, car.lanePosition, false).front;
      const front = !targetFront
        ? currentFront
        : !currentFront || targetFront.gap < currentFront.gap
          ? targetFront
          : currentFront;
      let assisting = false,
        reason = '';
      if (
        front &&
        this.onRoad(car) &&
        (!car.controlled || (this.assistEnabled && car.riskyRemaining <= 0))
      ) {
        const closing = car.speed - front.car.speed;
        const seconds = ttc(front.gap, closing);
        const critical =
          front.gap < 4 + car.speed * 0.7 ||
          (seconds !== null && seconds < 2.1);
        if (critical) {
          const stoppingSpeed = Math.sqrt(
            front.car.speed ** 2 +
              2 * EMERGENCY_DECELERATION * Math.max(0, front.gap - 3),
          );
          const followSpeed =
            front.car.speed + Math.max(-front.car.speed, (front.gap - 5) / 1.3);
          const safeAcceleration = clamp(
            (Math.min(stoppingSpeed, followSpeed) - car.speed) * 2.5,
            -EMERGENCY_DECELERATION,
            ACCELERATION,
          );
          if (safeAcceleration < acceleration - 0.1) {
            acceleration = safeAcceleration;
            assisting = car.controlled;
            reason = `Braking for ${front.car.name}, ${round(Math.max(0, front.gap))} m ahead`;
          }
        }
      }
      if (assisting && !car.assisting && this.time - car.lastAssistTime > 2) {
        car.assistCount++;
        car.lastAssistTime = this.time;
        this.event('assist', car, `${car.name}: emergency braking`, { reason });
      }
      car.assisting = assisting;
      car.assistReason = reason;
      car.braking = acceleration < -0.3;
      return acceleration;
    });
    this.cars.forEach((car, index) => {
      if (terminal(car)) car.lane = -1;
      const laneRate =
        terminal(car) || inPit(car) ? 1.4 : car.riskyRemaining > 0 ? 1 : 0.5;
      car.lanePosition += clamp(
        car.lane - car.lanePosition,
        -dt * laneRate,
        dt * laneRate,
      );
      car.speed = clamp(car.speed + accelerations[index] * dt, 0, BOOST_SPEED);
      if (car.pitState === 'service') car.speed = 0;
      const travelled = car.speed * dt;
      const metric = inBend(car.distance)
        ? laneRadius(car.lanePosition) / TRACK_RADIUS
        : 1;
      if (!terminal(car)) {
        car.progress += travelled / metric;
        car.totalDistance += travelled;
      }
      car.distance = wrapDistance(car.progress);
      if (
        car.pitState === 'entering' &&
        car.progress >= car.pitLap * TRACK_LENGTH + PIT_STOP - 0.15
      ) {
        car.progress = car.pitLap * TRACK_LENGTH + PIT_STOP;
        car.distance = PIT_STOP;
        car.speed = 0;
        car.pitState = 'service';
        car.pitRemaining = PIT_SERVICE_SECONDS;
        this.event(
          'pit',
          car,
          `${car.name} stopped for tyres, repairs and boost`,
          { phase: 'service' },
        );
      }
      if (car.controlled && !terminal(car)) {
        const laps = Math.max(0, Math.floor(car.progress / TRACK_LENGTH));
        if (laps > car.laps && laps < RACE_LAPS)
          this.event('lap', car, `${car.name} completed lap ${laps}`);
        car.laps = Math.min(RACE_LAPS, laps);
        car.lap = Math.min(RACE_LAPS, laps + 1);
        car.raceDistance = clamp(car.progress, 0, RACE_DISTANCE);
        this.applyCornerLoad(car, dt);
      }
      car.offTrack = terminal(car) || inPit(car);
      const pose = trackPose(car.distance, car.lanePosition);
      Object.assign(car, pose, { heading: pose.heading + car.spinAngle });
    });
    this.resolveContacts();
    this.captureOrder(true);
    this.checkFinish(oldProgress, dt);
    this.updateRanking();
    for (const car of this.cars) this.updateRiskState(car);
    if (this.time >= RACE_TIME_LIMIT || this.drivers.every(terminal)) {
      if (this.time >= RACE_TIME_LIMIT)
        for (const car of this.drivers)
          if (!terminal(car)) this.retire(car, 'Time limit');
      this.over = true;
      this.running = false;
      this.endReason = this.winner ? 'Race complete' : 'No classified finisher';
      this.updateRanking();
    }
  }

  applyCornerLoad(car, dt) {
    if (inPit(car) || car.spinning || terminal(car)) return;
    const bending = inBend(car.distance);
    const safe = this.safeSpeed(car);
    const load = bending ? (car.speed / safe) ** 2 : 0;
    car.tyres = Math.max(
      0,
      car.tyres -
        dt *
          (0.035 +
            (car.speed / MAX_SPEED) ** 2 * 0.07 +
            (bending ? 0.12 * load ** 2 : 0) +
            (car.boosting ? 0.35 : 0)),
    );
    car.cornerStress = Math.max(
      0,
      car.cornerStress + (load > 1 ? load - 1 : -1.2) * dt,
    );
    if (car.cornerStress >= 1.45) this.spin(car, load);
  }

  spin(car, load) {
    car.spins++;
    car.spinning = true;
    car.spinRemaining = 2.4;
    car.spinAngle = 0;
    car.cornerStress = 0;
    car.boostRemaining = 0;
    car.boosting = false;
    car.speed = Math.min(car.speed, 9);
    car.tyres = Math.max(0, car.tyres - 15);
    const damage = clamp(28 + Math.max(0, load - 1) * 22, 28, 64);
    this.event('spin', car, `${car.name} spun after exceeding corner grip`, {
      load: round(load, 2),
      damage: round(damage),
      wet: isWet(car.distance, this.wetSector),
    });
    this.damageCar(car, damage, 'Repeated corner impacts');
  }

  damageCar(car, amount, reason) {
    if (!car.controlled || terminal(car)) return;
    car.damage = Math.min(100, car.damage + amount);
    if (car.damage >= 100) this.retire(car, reason);
  }

  retire(car, reason) {
    if (terminal(car)) return;
    car.retired = true;
    car.alive = false;
    car.retirementReason = reason;
    car.boostRemaining = 0;
    car.boosting = false;
    car.spinning = false;
    car.spinRemaining = 0;
    car.spinAngle = 0;
    car.assisting = false;
    car.targetSpeed = 0;
    car.speed = 0;
    car.offTrack = true;
    car.pitState = 'none';
    this.event('retire', car, `${car.name} retired: ${reason}`, { reason });
  }

  resolveContacts() {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i],
          b = this.cars[j];
        if (
          !this.onRoad(a) ||
          !this.onRoad(b) ||
          Math.abs(a.lanePosition - b.lanePosition) > 0.48
        )
          continue;
        const lane = (a.lanePosition + b.lanePosition) / 2;
        const aToB = forwardGap(a.distance, b.distance, lane),
          bToA = forwardGap(b.distance, a.distance, lane);
        if (Math.min(aToB, bToA) >= CAR_LENGTH) continue;
        const key = pairKey(a, b);
        if (this.time - (this.contactTimes.get(key) ?? -Infinity) > 3) {
          a.contacts++;
          b.contacts++;
          this.contactCount++;
          this.contactTimes.set(key, this.time);
          const severity = clamp(
            13 +
              Math.abs(a.speed - b.speed) * 2.8 +
              (Math.abs(a.lanePosition - b.lanePosition) > 0.12 ? 12 : 0),
            13,
            65,
          );
          this.event('contact', a, `${a.name} collided with ${b.name}`, {
            otherId: b.id,
            damage: round(severity),
          });
          const rear = aToB <= bToA ? a : b;
          this.damageCar(rear, severity, 'Collision damage');
          this.damageCar(
            rear === a ? b : a,
            severity * 0.7,
            'Collision damage',
          );
        }
        const rear = aToB <= bToA ? a : b,
          front = rear === a ? b : a;
        rear.speed = Math.min(rear.speed, front.speed * 0.75);
        front.speed *= 0.94;
        const metric = inBend(rear.distance)
          ? laneRadius(lane) / TRACK_RADIUS
          : 1;
        rear.progress -= (CAR_LENGTH + 0.25 - Math.min(aToB, bToA)) / metric;
        rear.distance = wrapDistance(rear.progress);
        rear.raceDistance = clamp(rear.progress, 0, RACE_DISTANCE);
        Object.assign(rear, trackPose(rear.distance, rear.lanePosition));
      }
    }
  }

  captureOrder(count = false) {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i],
          b = this.cars[j];
        const difference = a.progress - b.progress,
          key = pairKey(a, b),
          previous = this.previousOrder.get(key);
        if (
          count &&
          previous !== undefined &&
          previous !== 0 &&
          Math.floor(previous / TRACK_LENGTH) !==
            Math.floor(difference / TRACK_LENGTH)
        ) {
          const passer = difference > previous ? a : b,
            passed = passer === a ? b : a;
          if (
            passer.controlled &&
            this.onRoad(passer) &&
            this.onRoad(passed) &&
            Math.abs(passer.lanePosition - passed.lanePosition) > 0.5 &&
            this.time - (this.passTimes.get(key) ?? -Infinity) > 4
          ) {
            passer.overtakes++;
            this.passTimes.set(key, this.time);
            this.event(
              'overtake',
              passer,
              `${passer.name} passed ${passed.name}`,
              { otherId: passed.id },
            );
          }
        }
        this.previousOrder.set(key, difference);
      }
    }
  }

  checkFinish(previousProgress, dt) {
    const finished = this.drivers.filter(
      (car) => !terminal(car) && car.progress >= RACE_DISTANCE,
    );
    for (const car of finished) {
      const index = this.cars.indexOf(car);
      const fraction = clamp(
        (RACE_DISTANCE - previousProgress[index]) /
          Math.max(0.0001, car.progress - previousProgress[index]),
        0,
        1,
      );
      car.finishTime = this.time - dt + fraction * dt;
      car.progress = RACE_DISTANCE;
      car.raceDistance = RACE_DISTANCE;
      car.distance = 0;
      car.finished = true;
      car.alive = false;
      car.laps = RACE_LAPS;
      car.lap = RACE_LAPS;
      car.boostRemaining = 0;
      car.boosting = false;
      car.targetSpeed = 0;
      car.speed = 0;
      car.assisting = false;
      car.offTrack = true;
      car.pitState = 'none';
      car.pitRemaining = 0;
      Object.assign(car, trackPose(car.distance, car.lanePosition));
    }
    finished.sort((a, b) => a.finishTime - b.finishTime);
    for (const car of finished) {
      if (!this.winner) {
        this.winner = car.id;
        this.winnerTime = car.finishTime;
      }
      this.event(
        'finish',
        car,
        `${car.name} ${this.winner === car.id ? 'won the race' : 'finished'}`,
        { finishTime: car.finishTime, winner: this.winner === car.id },
      );
    }
  }

  orderedDrivers() {
    return [...this.drivers].sort((a, b) => {
      if (a.finished || b.finished)
        return a.finished && b.finished
          ? a.finishTime - b.finishTime
          : a.finished
            ? -1
            : 1;
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return b.progress - a.progress || a.id.localeCompare(b.id);
    });
  }

  updateRanking() {
    this.orderedDrivers().forEach((car, index) => {
      car.racePosition = index + 1;
    });
  }

  summary() {
    return {
      time: this.time,
      drivers: this.drivers.length,
      traffic: this.cars.length - this.drivers.length,
      laps: this.drivers.reduce((sum, car) => sum + car.laps, 0),
      overtakes: this.drivers.reduce((sum, car) => sum + car.overtakes, 0),
      contacts: this.contactCount,
      assists: this.drivers.reduce((sum, car) => sum + car.assistCount, 0),
      meanSpeed:
        this.drivers.reduce((sum, car) => sum + car.speed, 0) /
        this.drivers.length,
      distance: this.drivers.reduce((sum, car) => sum + car.totalDistance, 0),
      spins: this.drivers.reduce((sum, car) => sum + car.spins, 0),
      pitStops: this.drivers.reduce((sum, car) => sum + car.pitStops, 0),
      finished: this.drivers.filter((car) => car.finished).length,
      retired: this.drivers.filter((car) => car.retired).length,
      winner: this.winner,
      winnerTime: this.winnerTime,
      over: this.over,
      raceLaps: RACE_LAPS,
      standings: this.orderedDrivers().map((car) => ({
        id: car.id,
        name: car.name,
        position: car.racePosition,
        laps: car.laps,
        raceDistance: car.raceDistance,
        finished: car.finished,
        retired: car.retired,
        finishTime: car.finishTime,
        damage: car.damage,
        tyres: car.tyres,
        boostEnergy: car.boostEnergy,
      })),
    };
  }
}
