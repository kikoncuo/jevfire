import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DrivingGame,
  CAR_LENGTH,
  MAX_SPEED,
  BOOST_SPEED,
  RACE_DISTANCE,
  RACE_TIME_LIMIT,
} from '../src/driving/game.js';
import {
  TRACK_LENGTH,
  TRACK_STRAIGHT,
  TRACK_RADIUS,
  LANE_WIDTH,
  trackPose,
  laneLength,
  forwardGap,
  PIT_ENTRY,
  PIT_STOP,
  PIT_LANE,
  wetSector,
} from '../src/driving/track.js';

const advance = (game, seconds, dt = 1 / 60) => {
  for (let time = 0; time < seconds - 1e-9; time += dt)
    game.update(Math.min(dt, seconds - time));
};
const place = (car, distance, lane, speed) => {
  Object.assign(car, {
    distance,
    progress: distance,
    lane,
    lanePosition: lane,
    speed,
    targetSpeed: speed,
    cruiseSpeed: speed,
    ...trackPose(distance, lane),
  });
};
const pair = () => {
  const game = new DrivingGame();
  const driver = game.drivers[0];
  const traffic = game.cars.find((car) => !car.controlled);
  game.cars = [driver, traffic];
  game.drivers = [driver];
  game.previousOrder.clear();
  game.running = true;
  return { game, driver, traffic };
};

test('stadium poses are continuous, wrap and align +Z with travel', () => {
  const start = trackPose(0, 1);
  assert.deepEqual(start, {
    x: TRACK_RADIUS,
    z: -TRACK_STRAIGHT / 2,
    heading: 0,
  });
  assert.deepEqual(trackPose(TRACK_LENGTH, 1), start);
  for (const boundary of [
    100,
    100 + Math.PI * 38,
    200 + Math.PI * 38,
    TRACK_LENGTH,
  ]) {
    const before = trackPose(boundary - 0.001, 1);
    const after = trackPose(boundary + 0.001, 1);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.003);
  }
  const onBend = trackPose(130, 2);
  const next = trackPose(130.01, 2);
  assert.ok(
    Math.abs(
      Math.atan2(next.x - onBend.x, next.z - onBend.z) - onBend.heading,
    ) < 0.001,
  );
  assert.equal(trackPose(0, 2).x - trackPose(0, 1).x, LANE_WIDTH);
  assert.ok(laneLength(2) > laneLength(1));
  assert.ok(forwardGap(TRACK_LENGTH - 4, 4, 1) < 8.001);
  assert.ok(
    trackPose(0, 3.5).x > trackPose(0, 2).x,
    'renderer can extrapolate road edges',
  );
});

test('four prompted drivers and six traffic cars start with genuine held cruise targets', () => {
  const game = new DrivingGame();
  assert.deepEqual(
    game.drivers.map((car) => car.id),
    ['nova', 'atlas', 'juno', 'milo'],
  );
  assert.equal(game.cars.length, 10);
  assert.equal(new Set(game.drivers.map((car) => car.defaultPrompt)).size, 4);
  for (const driver of game.drivers) {
    assert.equal(driver.action, 'hold');
    assert.equal(driver.source, 'ready');
    assert.equal(driver.targetSpeed, 17);
    assert.equal(driver.alive, true);
    assert.ok(game.availableActions(driver).includes('hold'));
  }
  assert.deepEqual(game.availableActions('traffic-1'), []);
});

test('typed commands change only declared targets and invalid batches do not partially apply', () => {
  const { game, driver } = pair();
  place(driver, 20, 1, 17);
  const before = driver.targetSpeed;
  assert.throws(() => game.apply({ nova: 'accelerate', invalid: 'hold' }));
  assert.equal(driver.targetSpeed, before);
  assert.throws(() => game.apply({ nova: 'teleport' }));
  assert.throws(() => game.apply({ 'traffic-1': 'hold' }));
  game.apply({ nova: 'accelerate' });
  assert.equal(driver.targetSpeed, 21);
  assert.equal(driver.source, 'model');
  game.apply({ nova: 'hold' });
  assert.equal(driver.targetSpeed, 21);
  game.apply({ nova: 'brake' });
  assert.equal(driver.targetSpeed, 15);
  driver.targetSpeed = MAX_SPEED;
  assert.ok(!game.availableActions(driver).includes('accelerate'));
  driver.targetSpeed = 0;
  assert.ok(!game.availableActions(driver).includes('brake'));
  assert.ok(game.availableActions(driver).includes('hold'));
});

test('lane moves respect fast rear traffic, front gaps, boundaries, and transition duration', () => {
  const { game, driver, traffic } = pair();
  place(driver, 60, 1, 17);
  place(traffic, 44, 0, 31);
  assert.ok(
    !game.availableActions(driver).includes('left'),
    'fast rear car makes the merge unsafe',
  );
  place(traffic, 20, 0, 31);
  assert.ok(game.availableActions(driver).includes('left'));
  place(traffic, 69, 0, 12);
  assert.ok(
    !game.availableActions(driver).includes('left'),
    'small front gap is unsafe',
  );
  place(traffic, 180, 2, 12);
  game.apply({ nova: 'left' });
  advance(game, 1);
  assert.ok(driver.lanePosition > 0.45 && driver.lanePosition < 0.55);
  assert.ok(
    !game.availableActions(driver).includes('right'),
    'another lane change cannot interrupt the current one',
  );
  advance(game, 1);
  assert.ok(Math.abs(driver.lanePosition) < 0.001);
  assert.ok(
    !game.availableActions(driver).includes('left'),
    'cannot leave the road',
  );
});

test('two simultaneous merges cannot reserve the same gap', () => {
  const game = new DrivingGame();
  const [a, b] = game.drivers;
  game.cars = [a, b];
  place(a, 40, 0, 17);
  place(b, 40, 2, 17);
  assert.throws(
    () => game.apply({ nova: 'right', atlas: 'left' }),
    /Conflicting/,
  );
  assert.equal(a.lane, 0);
  assert.equal(b.lane, 2);
});

test('emergency assist brakes for slower traffic without replacing the model command', () => {
  const { game, driver, traffic } = pair();
  place(driver, 20, 1, 23);
  place(traffic, 45, 1, 8);
  game.apply({ nova: 'accelerate' });
  const chosenSpeed = driver.targetSpeed;
  advance(game, 1);
  assert.equal(driver.action, 'accelerate');
  assert.equal(driver.source, 'model');
  assert.equal(driver.targetSpeed, chosenSpeed);
  assert.equal(driver.assisting, true);
  assert.ok(driver.assistCount > 0);
  assert.ok(driver.speed < 23);
  advance(game, 6);
  assert.equal(game.summary().contacts, 0);
  assert.ok(forwardGap(driver.distance, traffic.distance, 1) > CAR_LENGTH);
  assert.ok(game.events.some((event) => event.type === 'assist'));
});

test('disabling assist exposes actual contacts and collision events are not counted each frame', () => {
  const { game, driver, traffic } = pair();
  game.assistEnabled = false;
  place(driver, 20, 1, 23);
  place(traffic, 38, 1, 8);
  advance(game, 2);
  assert.ok(driver.contacts >= 1);
  assert.ok(game.summary().contacts >= 1);
  assert.ok(game.summary().contacts <= 2);
  assert.equal(driver.assistCount, 0);
  assert.equal(driver.assisting, false);
  assert.equal(driver.source, 'ready');
});

test('observations identify real front and rear cars with explicit units and closing TTC', () => {
  const { game, driver, traffic } = pair();
  place(driver, 20, 1, 20);
  place(traffic, 40, 1, 10);
  const context = game.contextFor(driver.id);
  assert.equal(context.self.speedMps, 20);
  assert.equal(context.self.speedKph, 72);
  const front = context.traffic[1].front;
  assert.equal(front.id, traffic.id);
  assert.equal(front.gapM, 15.6);
  assert.equal(front.closingMps, 10);
  assert.equal(front.ttcSeconds, 1.6);
  assert.equal(context.traffic[0].front, null);
  assert.equal(
    context.traffic[1].rear,
    null,
    'distant traffic is outside rear sensor range',
  );
  place(traffic, 10, 1, 25);
  const rear = game.contextFor(driver.id).traffic[1].rear;
  assert.equal(rear.gapM, 5.6);
  assert.equal(rear.closingMps, 5);
  assert.equal(rear.ttcSeconds, 1.1);
  assert.deepEqual(context.availableActions, [
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
  assert.doesNotThrow(() => JSON.stringify(context));
});

test('fixed physics is independent of frame grouping and clamps background-tab time', () => {
  const a = new DrivingGame();
  const b = new DrivingGame();
  a.running = b.running = true;
  advance(a, 4, 1 / 60);
  advance(b, 4, 0.1);
  for (let index = 0; index < a.cars.length; index++) {
    assert.ok(Math.abs(a.cars[index].distance - b.cars[index].distance) < 1e-7);
    assert.ok(Math.abs(a.cars[index].speed - b.cars[index].speed) < 1e-7);
  }
  const before = b.time;
  b.update(10);
  assert.ok(Math.abs(b.time - before - 0.25) < 1e-7);
  b.update(NaN);
  b.update(-1);
  assert.ok(Math.abs(b.time - before - 0.25) < 1e-7);
});

test('laps and repeated overtakes survive the circuit wrap without false finish-line passes', () => {
  const { game, driver, traffic } = pair();
  place(driver, 20, 1, 18);
  place(traffic, 30, 2, 4);
  game.captureOrder();
  advance(game, 40);
  assert.ok(driver.laps >= 1);
  assert.ok(
    driver.overtakes >= 2,
    'lapping the same traffic car is another pass',
  );
  assert.equal(driver.contacts, 0);
  const tied = pair();
  place(tied.driver, TRACK_LENGTH - 8, 1, 17);
  place(tied.traffic, TRACK_LENGTH - 2, 1, 17);
  tied.game.captureOrder();
  advance(tied.game, 1);
  assert.equal(tied.driver.overtakes, 0);
});

test('the explicit scripted race finishes, risky driving can retire, and reset clears all race state', () => {
  const game = new DrivingGame();
  game.running = true;
  for (let seconds = 0; seconds < 180 && !game.over; seconds += 1.5) {
    const decisions = game.scripted();
    if (Object.keys(decisions).length) game.apply(decisions, 'scripted');
    advance(game, 1.5);
  }
  assert.equal(game.over, true);
  assert.ok(game.drivers.some((car) => car.finished));
  assert.ok(game.drivers.some((car) => car.retired));
  assert.ok(game.winner);
  assert.ok(game.drivers.every((car) => car.source === 'scripted'));
  assert.ok(game.summary().overtakes > 4);
  assert.ok(game.summary().spins > 0);
  assert.ok(game.events.length <= 80);
  game.reset();
  assert.equal(game.running, false);
  assert.equal(game.time, 0);
  assert.equal(game.events.length, 0);
  assert.equal(game.summary().contacts, 0);
  assert.equal(game.summary().overtakes, 0);
  assert.equal(game.summary().assists, 0);
  assert.equal(game.over, false);
  assert.equal(game.winner, null);
  assert.ok(
    game.drivers.every((car) => car.totalDistance === 0 && car.laps === 0),
  );
});

test('boost is a finite timed burst and braking cancels it without refilling energy', () => {
  const { game, driver, traffic } = pair();
  place(driver, 0, 1, 26);
  place(traffic, 210, 2, 12);
  game.apply({ nova: 'boost' });
  assert.equal(driver.boostRemaining, 2.5);
  assert.ok(!game.availableActions(driver).includes('boost'));
  advance(game, 2);
  assert.ok(driver.speed > MAX_SPEED && driver.speed <= BOOST_SPEED);
  assert.ok(Math.abs(driver.boostEnergy - 75) < 0.01);
  const energy = driver.boostEnergy;
  game.apply({ nova: 'brake' });
  assert.equal(driver.boostRemaining, 0);
  assert.equal(driver.boosting, false);
  advance(game, 0.2);
  assert.equal(driver.boostEnergy, energy);
  driver.boostEnergy = 0;
  assert.ok(!game.availableActions(driver).includes('boost'));
});

test('corner overload causes real spin damage despite following assist; safe speed avoids it', () => {
  const fast = pair();
  const careful = pair();
  for (const setup of [fast, careful]) {
    place(setup.driver, setup.game.wetSector.start + 4, 1, 31);
    place(setup.traffic, 20, 0, 12);
  }
  careful.driver.speed = careful.driver.targetSpeed =
    careful.game.safeSpeed(careful.driver) * 0.85;
  advance(fast.game, 3);
  advance(careful.game, 3);
  assert.equal(fast.game.assistEnabled, true);
  assert.ok(fast.driver.spins >= 1);
  assert.ok(fast.driver.damage > 0);
  assert.ok(fast.driver.tyres < 90);
  assert.equal(
    fast.driver.action,
    'hold',
    'physics does not rewrite the chosen action',
  );
  assert.equal(careful.driver.spins, 0);
  assert.equal(careful.driver.damage, 0);
  const damaged = pair();
  damaged.driver.damage = 80;
  place(damaged.driver, damaged.game.wetSector.start + 4, 1, 31);
  place(damaged.traffic, 20, 0, 12);
  advance(damaged.game, 4);
  assert.equal(damaged.driver.retired, true);
  assert.equal(damaged.driver.damage, 100);
  assert.equal(damaged.driver.alive, false);
  assert.deepEqual(damaged.game.availableActions(damaged.driver), []);
});

test('risky merges expose tighter gaps and actual contact instead of silently invoking the brake assist', () => {
  const { game, driver, traffic } = pair();
  place(driver, 20, 1, 31);
  place(traffic, 40, 0, 8);
  assert.ok(!game.availableActions(driver).includes('left'));
  assert.ok(game.availableActions(driver).includes('risky_left'));
  game.apply({ nova: 'risky_left' });
  assert.equal(driver.riskyRemaining, 2.2);
  advance(game, 1.2);
  assert.ok(driver.contacts > 0);
  assert.ok(driver.damage > 0);
  assert.equal(driver.assistCount, 0);
  assert.equal(driver.action, 'risky_left');
  assert.equal(driver.source, 'model');
});

test('pit service requires physical entry, a six-second stop and a merge back onto the track', () => {
  const { game, driver, traffic } = pair();
  place(driver, 0, 2, 12);
  place(traffic, 200, 0, 12);
  driver.tyres = 40;
  driver.damage = 55;
  driver.boostEnergy = 10;
  driver.targetSpeed = 0;
  game.apply({ nova: 'pit' });
  assert.equal(driver.distance, 0, 'request does not teleport the car');
  assert.equal(driver.damage, 55, 'request does not instantly repair');
  assert.deepEqual(game.availableActions(driver), ['hold']);
  for (let time = 0; time < 20 && driver.pitState !== 'service'; time += 1 / 60)
    game.update(1 / 60);
  assert.equal(driver.pitState, 'service');
  assert.equal(driver.distance, PIT_STOP);
  assert.ok(Math.abs(driver.lanePosition - PIT_LANE) < 0.05);
  assert.equal(driver.speed, 0);
  assert.deepEqual(game.availableActions(driver), []);
  advance(game, 5.8);
  assert.equal(driver.damage, 55);
  assert.equal(driver.pitState, 'service');
  advance(game, 0.3);
  assert.equal(driver.damage, 0);
  assert.equal(driver.tyres, 100);
  assert.equal(driver.boostEnergy, 100);
  assert.equal(driver.pitStops, 1);
  assert.equal(driver.pitState, 'exiting');
  advance(game, 10);
  assert.equal(driver.pitState, 'none');
  assert.equal(driver.lane, 2);
  assert.ok(driver.speed > 0);
  assert.ok(
    game.events.some((event) => event.type === 'pit' && event.phase === 'exit'),
  );
});

test('requesting a pit after its entry waits for the next circuit instead of teleporting backwards', () => {
  const { game, driver, traffic } = pair();
  place(driver, PIT_ENTRY + 20, 2, 17);
  place(traffic, 240, 0, 12);
  game.apply({ nova: 'pit' });
  advance(game, 2);
  assert.equal(driver.pitState, 'requested');
  assert.ok(driver.progress > PIT_ENTRY + 40);
  assert.equal(driver.pitStops, 0);
});

test('the common finish declares the first winner and lets other drivers complete the race', () => {
  const game = new DrivingGame();
  const [a, b] = game.drivers;
  game.drivers = [a, b];
  game.cars = [a, b];
  place(a, RACE_DISTANCE - 0.1, 0, 17);
  place(b, RACE_DISTANCE - 9, 2, 17);
  game.running = true;
  game.update(1 / 60);
  assert.equal(a.finished, true);
  assert.equal(game.winner, a.id);
  assert.equal(game.over, false);
  assert.equal(a.distance, 0);
  assert.equal(a.raceDistance, RACE_DISTANCE);
  assert.equal(a.speed, 0);
  advance(game, 1);
  assert.equal(b.finished, true);
  assert.equal(game.over, true);
  assert.equal(game.running, false);
  assert.equal(game.winner, a.id);
  assert.ok(a.finishTime < b.finishTime);
  assert.equal(a.racePosition, 1);
  assert.equal(b.racePosition, 2);
});

test('the race time limit classifies unfinished cars as DNF and freezes the simulation', () => {
  const { game, driver } = pair();
  game.time = RACE_TIME_LIMIT - 0.005;
  game.update(1 / 60);
  assert.equal(game.over, true);
  assert.equal(driver.retired, true);
  assert.equal(driver.retirementReason, 'Time limit');
  assert.equal(game.winner, null);
  const stoppedAt = game.time;
  game.update(0.25);
  assert.equal(game.time, stoppedAt);
});

test('observed risk values are factual, tyre-sensitive and seed-repeatable', () => {
  const { game, driver, traffic } = pair();
  place(driver, game.wetSector.start + 5, 1, 25);
  place(traffic, 40, 0, 12);
  const healthy = game.contextFor(driver.id);
  assert.equal(healthy.track.wetHere, true);
  assert.ok(healthy.track.safeSpeedHereMps < 25);
  assert.ok(healthy.track.brakingDistanceM > 0);
  assert.equal(healthy.assist.cornersProtected, false);
  driver.tyres = 25;
  const worn = game.contextFor(driver.id);
  assert.ok(worn.track.safeSpeedHereMps < healthy.track.safeSpeedHereMps);
  assert.equal(worn.self.tyres, 25);
  assert.equal(worn.race.totalDistanceM, Number(RACE_DISTANCE.toFixed(1)));
  assert.deepEqual(wetSector(7), wetSector(7));
  assert.notDeepEqual(wetSector(7), wetSector(8));
  const a = new DrivingGame({ seed: 8 });
  const b = new DrivingGame({ seed: 8 });
  a.running = b.running = true;
  for (let second = 0; second < 20; second += 1.5) {
    for (const simulation of [a, b]) {
      const commands = simulation.scripted();
      if (Object.keys(commands).length) simulation.apply(commands, 'scripted');
      advance(simulation, 1.5);
    }
  }
  assert.deepEqual(a.summary(), b.summary());
});

test('driver identity and personality do not alter race physics under the same commands', () => {
  const a = new DrivingGame({ seed: 7 });
  const b = new DrivingGame({ seed: 7 });
  const fastPrompt = a.drivers[0];
  const cautiousPrompt = b.drivers[1];
  for (const [simulation, car] of [
    [a, fastPrompt],
    [b, cautiousPrompt],
  ]) {
    simulation.cars = [car];
    simulation.drivers = [car];
    place(car, 0, 1, 23);
    simulation.running = true;
    simulation.apply({ [car.id]: 'boost' });
    advance(simulation, 2);
  }
  for (const field of ['speed', 'progress', 'boostEnergy', 'tyres', 'damage'])
    assert.equal(fastPrompt[field], cautiousPrompt[field], field);
  for (const [simulation, car] of [
    [a, fastPrompt],
    [b, cautiousPrompt],
  ]) {
    place(car, simulation.wetSector.start + 4, 1, 31);
    advance(simulation, 3);
  }
  for (const field of ['speed', 'progress', 'tyres', 'damage', 'spins'])
    assert.equal(fastPrompt[field], cautiousPrompt[field], field);
});

test('side-by-side grid ties do not count as overtakes before anyone has passed', () => {
  const { game, driver, traffic } = pair();
  place(driver, 20, 0, 17);
  place(traffic, 20, 2, 16);
  game.captureOrder();
  game.update(1 / 60);
  assert.equal(driver.overtakes, 0);
});
