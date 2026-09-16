import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { describeObservation } from '../src/observation.js';

test('hunger description explains the direction of the meter and imminent death', () => {
  const game = new Game(),
    unit = game.units[0];
  unit.hunger = 3;
  Object.assign(unit, { x: unit.home.x, y: unit.home.y });
  const text = describeObservation(game.contextFor('mira'));
  assert.match(text, /Food meter: 3\/100/);
  assert.match(text, /100 means fed, 0 means starvation death/);
  assert.match(
    text,
    /starvation without eating: 4 seconds\. STARVATION IMMINENT/,
  );
  assert.match(text, /Walk home: 0 seconds/);
  assert.match(text, /Food stored at home: 6 meals/);
});
test('work descriptions expose empty repair lists and real defense sites', () => {
  const game = new Game();
  const text = describeObservation(game.contextFor('nell'));
  assert.match(text, /No damaged standing buildings need repair/);
  assert.match(text, /Unfinished defense sites: 4\. Operating towers: 0/);
  assert.match(text, /No orcs observed/);
  assert.doesNotMatch(text, /choose|recommended action|must build/i);
});
test('enemy positions and attack targets are factual and remain role-specific', () => {
  const game = new Game();
  const orc = game.spawnOrc(12, 15, 2);
  orc.targetId = 'mira';
  const text = describeObservation(game.contextFor('aldric'));
  assert.match(text, /level 2, health 70, target mira/);
  assert.match(text, /Allies under attack/);
  assert.match(text, /mira:/);
  assert.match(text, /Your attack strength: 11/);
  assert.doesNotMatch(text, /Food patches|Unfinished defense sites/);
});
test('body descriptions do not silently select any action', () => {
  const game = new Game(),
    unit = game.units[0];
  unit.hunger = 3;
  unit.action = 'forage_bold';
  game.food = 0;
  const text = describeObservation(game.contextFor('mira'));
  assert.match(text, /PANTRY EMPTY/);
  assert.match(text, /Previous assignment \(can be changed\): forage_bold/);
  assert.doesNotMatch(text, /Choose C|Choose relax|recommended|forbidden/i);
  assert.equal(unit.action, 'forage_bold');
});
