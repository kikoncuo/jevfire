import './style.css';
import { DrivingGame } from './game.js';
import { DrivingRenderer } from './renderer.js';
import { DRIVERS, ACTION_LABELS } from './contract.js';
import { validateDecision } from '../contract.js';
import {
  DecisionScheduler,
  DecisionTelemetry,
  FrameTelemetry,
} from '../controller.js';

const $ = (id) => document.getElementById(id);
const text = (id, value) => {
  const element = $(id);
  if (element.textContent !== String(value)) element.textContent = value;
};
const clock = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kph = (speed) => Math.round(speed * 3.6);
const SOURCE = { model: 'Qwen', scripted: 'Scripted', ready: 'Awaiting start' };
const MISSION =
  'Race to finish three laps ahead of the other drivers. Follow your own strategy for speed, overtaking, corner risk, boost and pit stops. Choose one available maneuver.';
const game = new DrivingGame();
const scheduler = new DecisionScheduler();
const telemetry = new DecisionTelemetry();
const frames = new FrameTelemetry();
const cards = new Map(),
  decisions = new Map(),
  histories = new Map();
const policies = Object.fromEntries(
  DRIVERS.map((driver) => [driver.id, driver.defaultPrompt]),
);
const drafts = { ...policies };
try {
  const stored = JSON.parse(
    localStorage.getItem('jevfire-racing-policies') || '{}',
  );
  for (const driver of DRIVERS)
    if (
      typeof stored?.[driver.id] === 'string' &&
      stored[driver.id].trim() &&
      stored[driver.id].length <= 1000
    )
      policies[driver.id] = drafts[driver.id] = stored[driver.id];
} catch {
  /* Storage is optional; the circuit works without it. */
}

let renderer,
  rendererReady = false,
  selectedId = DRIVERS[0].id;
let worker = null,
  loaded = false,
  loading = false,
  busy = false,
  mode = 'idle',
  gpuAvailable = true;
let epoch = 0,
  sequence = 0,
  pending = null,
  watchdog = null,
  nextInference = 0;
let lastScripted = -Infinity,
  lastUi = 0,
  lastDraw = 0,
  lastFrame = performance.now();
let scoreVersion = null,
  historyVersion = null,
  journalSequence = 0;
let latestLatency = null,
  discarded = 0;
let probe = null,
  eventVersion = null;

function hideError() {
  $('error').hidden = true;
}
function showError(message) {
  text('error', message);
  $('error').hidden = false;
}
function enabled() {
  $('run').disabled =
    loading || !rendererReady || mode === 'idle' || Boolean(probe);
  $('load').disabled = loading || !gpuAvailable;
  $('preview').disabled = loading || !rendererReady || Boolean(probe);
}
function stop(message = 'Paused. Pending decisions are discarded.') {
  game.running = false;
  epoch++;
  text(
    'run',
    game.over ? 'Race again' : game.time ? 'Resume race' : 'Start engines',
  );
  text('run-status', message);
  updateUI();
}
function record(id, action, source) {
  const entries = histories.get(id) || [];
  if (
    source === 'scripted' &&
    entries[0]?.source === source &&
    entries[0]?.action === action
  )
    return;
  histories.set(
    id,
    [
      { id: ++journalSequence, action, source, at: game.time },
      ...entries,
    ].slice(0, 6),
  );
}
function selectDriver(id, reveal = false) {
  const definition = DRIVERS.find((driver) => driver.id === id);
  if (!definition) return;
  selectedId = id;
  renderer?.select(id);
  $('inspector').style.setProperty('--driver', definition.color);
  $('driver-prompt').value = drafts[id];
  text('prompt-count', `${drafts[id].length} / 1000`);
  text(
    'prompt-status',
    drafts[id] === policies[id]
      ? 'Edits affect this car’s next AI decision.'
      : 'Unapplied changes. Apply to use these instructions.',
  );
  if (reveal) $('inspector').classList.add('open');
  for (const [carId, refs] of cards) {
    refs.card.classList.toggle('selected', carId === id);
    refs.card.setAttribute('aria-pressed', String(carId === id));
  }
  updateInspector();
}
function makeCards() {
  for (const definition of DRIVERS) {
    const button = document.createElement('button');
    button.className = 'driver-card';
    button.dataset.driver = definition.id;
    button.style.setProperty('--driver', definition.color);
    button.innerHTML = `<span class="card-top"><span class="card-number">${definition.number}</span><span class="card-name">${definition.name}</span></span><span class="card-style">${definition.style}</span><span class="card-speed"><b>0</b> <small>km/h</small></span><span class="card-action">Awaiting start</span><span class="card-progress">0 laps · 0 passes</span>`;
    button.onclick = () => selectDriver(definition.id, true);
    cards.set(definition.id, {
      card: button,
      speed: button.querySelector('.card-speed b'),
      action: button.querySelector('.card-action'),
      progress: button.querySelector('.card-progress'),
    });
    $('drivers').append(button);
  }
}
const laneNames = ['Left', 'Middle', 'Right'];
for (let lane = 0; lane < 3; lane++) {
  const tr = document.createElement('tr');
  tr.dataset.lane = lane;
  tr.innerHTML = `<td>${laneNames[lane]}</td><td>—</td><td>—</td>`;
  $('traffic').append(tr);
}
function updateInspector() {
  const car = game.drivers.find((driver) => driver.id === selectedId);
  if (!car) return;
  const result = decisions.get(car.id);
  text('selected-name', car.name);
  text('selected-number', car.number);
  text('selected-style', car.style);
  text('selected-speed', kph(car.speed));
  text('selected-target', kph(car.targetSpeed));
  text('selected-laps', car.laps);
  text('selected-passes', car.overtakes);
  text(
    'selected-action',
    car.retired
      ? 'Retired · DNF'
      : car.finished
        ? 'Finished'
        : car.spinning
          ? 'Recovering from a spin'
          : car.pitState === 'service'
            ? 'Pit service'
            : ACTION_LABELS[car.action],
  );
  text('selected-source', SOURCE[car.source] || car.source);
  text(
    'selected-assist',
    car.retired
      ? car.retirementReason || 'Retired from this race.'
      : car.finished
        ? `Finished in ${clock(car.finishTime || game.time)}.`
        : car.spinning
          ? `Lost grip · ${Math.ceil(car.spinRemaining || 0)}s recovery.`
          : car.pitState && car.pitState !== 'none'
            ? `Pit ${car.pitState} · ${Math.ceil(car.pitRemaining || 0)}s service remaining.`
            : car.riskyRemaining > 0
              ? 'Committed pass · following assistance temporarily waived.'
              : car.assisting
                ? `Braking assist · ${car.assistReason}`
                : !game.time
                  ? 'Lane keeping follows the circuit.'
                  : Math.abs(car.lanePosition - car.lane) > 0.03
                    ? `Moving into the ${laneNames[car.lane].toLowerCase()} lane.`
                    : `${laneNames[car.lane]} lane · ${car.assistCount} braking assists · ${car.contacts} contacts`,
  );
  $('selected-assist').parentElement.classList.toggle(
    'assisting',
    car.assisting,
  );
  text(
    'selected-lane',
    car.finished || car.retired
      ? 'Off track'
      : laneNames[car.lane] || 'Pit lane',
  );
  $('no-decision').hidden = Boolean(result);
  $('decision-detail').hidden = !result;
  text(
    'no-decision',
    pending?.unitId === car.id && game.running && mode === 'model'
      ? 'Qwen is reading this car’s traffic…'
      : mode === 'scripted'
        ? 'Scripted drive. No AI scores are produced.'
        : 'No model decision yet. Load Qwen and start driving.',
  );
  text(
    'decision-time',
    result
      ? `${clock(result.appliedAt)} · ${Math.max(0, Math.floor(game.time - result.appliedAt))}s ago`
      : '—',
  );
  const key = `${car.id}:${result?.id ?? 'none'}`;
  if (scoreVersion !== key) {
    scoreVersion = key;
    $('scores').replaceChildren();
    if (result) {
      text('decision-action', ACTION_LABELS[result.parsed_json[car.id]]);
      const field = result.fields[car.id];
      field.options.forEach((action, index) => {
        const row = document.createElement('div');
        row.className = 'score';
        row.classList.toggle('chosen', action === field.value);
        const label = document.createElement('span'),
          meter = document.createElement('meter'),
          value = document.createElement('b');
        label.textContent = ACTION_LABELS[action];
        meter.min = 0;
        meter.max = 1;
        meter.value = field.probabilities[index];
        meter.setAttribute(
          'aria-label',
          `${ACTION_LABELS[action]} relative score`,
        );
        value.textContent = `${Math.round(field.probabilities[index] * 100)}%`;
        row.append(label, meter, value);
        $('scores').append(row);
      });
      text('observation', JSON.stringify(result.observedContext, null, 2));
      text('observed-policy', `Instructions used: ${result.policy}`);
    } else {
      text(
        'observation',
        'An accepted AI decision will save its observation here.',
      );
      text('observed-policy', '');
    }
  }
  const context = game.contextFor(car.id);
  const race = context.race || {};
  text(
    'selected-race',
    car.retired
      ? 'Retired from the race'
      : `P${car.racePosition || race.position || 1} · ${car.finished ? 'finished' : `lap ${Math.min(3, car.lap)} / 3`}${race.gapToLeaderM > 0 && !car.finished ? ` · +${Math.round(race.gapToLeaderM)} m` : ''}`,
  );
  for (const [id, value] of [
    ['tyre', car.tyres ?? 100],
    ['boost', car.boostEnergy ?? 100],
    ['damage', car.damage ?? 0],
  ]) {
    text(`${id}-value`, `${Math.round(value)}%`);
    $(`${id}-meter`).value = value;
  }
  const track = context.track;
  text(
    'corner-title',
    track.inBend
      ? `${track.wetHere ? 'Wet' : 'Dry'} corner · safe speed`
      : 'Next corner · safe speed',
  );
  text(
    'corner-speed',
    Number.isFinite(track.safeSpeedHereMps)
      ? `${kph(track.inBend ? track.safeSpeedHereMps : track.safeSpeedNextMps)} km/h`
      : '—',
  );
  text(
    'corner-note',
    track.inBend
      ? 'Excess speed builds corner load, tyre wear and spin risk.'
      : `${Math.round(track.nextCornerDistanceM || 0)} m ahead · ${Math.ceil(track.brakingDistanceM || 0)} m needed to brake${track.nextCornerWet ? ' · wet surface' : ''}`,
  );
  for (const lane of context.traffic) {
    const tr = $('traffic').children[lane.lane];
    tr.classList.toggle('current-lane', lane.lane === car.lane);
    tr.children[1].textContent = lane.front
      ? `${Math.max(0, Math.round(lane.front.gapM))} m`
      : 'clear';
    tr.children[2].textContent = lane.rear
      ? `${Math.max(0, Math.round(lane.rear.gapM))} m`
      : 'clear';
  }
  const history = histories.get(car.id) || [];
  const historyKey = `${car.id}:${history[0]?.id ?? 'none'}`;
  if (historyVersion !== historyKey) {
    historyVersion = historyKey;
    $('history').replaceChildren();
    if (!history.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No decisions yet.';
      $('history').append(li);
    }
    for (const entry of history) {
      const li = document.createElement('li'),
        time = document.createElement('time'),
        label = document.createElement('span'),
        source = document.createElement('small');
      time.textContent = clock(entry.at);
      label.textContent = ACTION_LABELS[entry.action];
      source.textContent = SOURCE[entry.source];
      li.append(time, label, source);
      $('history').append(li);
    }
  }
}
function updateUI(now = performance.now()) {
  const metrics = telemetry.snapshot(now, game.running && mode === 'model');
  const frameStats = frames.snapshot(now);
  text('clock', clock(game.time));
  text(
    'mode-label',
    loading
      ? 'Loading Qwen…'
      : mode === 'model'
        ? `Qwen · ${game.running ? 'driving' : 'paused'}`
        : mode === 'scripted'
          ? `Scripted · ${game.running ? 'driving' : 'paused'}`
          : 'Choose a controller',
  );
  $('status-dot').classList.toggle('active', game.running);
  text(
    'ai-rate',
    mode === 'model' ? metrics.decisions_per_second.toFixed(2) : '—',
  );
  text('ai-total', metrics.total_decisions);
  text(
    'latency',
    latestLatency === null ? '—' : `${Math.round(latestLatency)} ms`,
  );
  text('fps', rendererReady ? Math.round(frameStats.fps) : '—');
  text('contacts', game.summary().contacts);
  const winner = game.drivers.find((car) => car.id === game.winner);
  $('race-result').hidden = !winner && !game.over;
  text(
    'race-result',
    winner
      ? `${winner.name} wins in ${clock(game.winnerTime)}. ${game.over ? 'Race complete.' : 'The rest of the field is still racing.'}`
      : game.over
        ? game.endReason || 'Race complete. No finisher.'
        : '',
  );
  text('race-weather', `Seed ${game.seed ?? $('seed').value} · one wet bend`);
  for (const car of game.drivers) {
    const refs = cards.get(car.id);
    refs.speed.textContent = kph(car.speed);
    refs.card.classList.toggle('retired', Boolean(car.retired));
    refs.card.classList.toggle('boosting', Boolean(car.boosting));
    refs.action.textContent = car.retired
      ? 'Retired · DNF'
      : car.finished
        ? 'Finished'
        : car.spinning
          ? 'Spinning'
          : car.pitState && car.pitState !== 'none'
            ? `Pit · ${car.pitState}`
            : car.assisting
              ? 'Assist · braking'
              : ACTION_LABELS[car.action];
    refs.progress.textContent = `P${car.racePosition || 1} · ${Math.min(3, car.lap)}/3 laps · ${car.overtakes} passes`;
  }
  const events = game.events
    .filter((event) => event.type !== 'decision')
    .slice(-5)
    .reverse();
  const eventKey = `${events[0]?.time}:${events[0]?.message}:${events.length}`;
  if (eventKey !== eventVersion) {
    eventVersion = eventKey;
    $('events').replaceChildren();
    if (!events.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent =
        'The grid is ready. Watch for overtakes, boost, spins and pit stops.';
      $('events').append(li);
    }
    for (const event of events) {
      const li = document.createElement('li'),
        time = document.createElement('time'),
        type = document.createElement('span'),
        label = document.createElement('span');
      time.textContent = clock(event.time);
      type.textContent = event.type;
      type.className = 'event-type';
      label.textContent = event.message;
      li.classList.toggle(
        'incident',
        ['spin', 'contact', 'retire'].includes(event.type),
      );
      li.append(time, type, label);
      $('events').append(li);
    }
  }
  updateInspector();
}
function failWorker(message) {
  clearTimeout(watchdog);
  probe?.reject(new Error(message));
  probe = null;
  worker?.terminate();
  worker = null;
  loaded = loading = busy = false;
  pending = null;
  mode = 'idle';
  stop('Model stopped. Reload Qwen to continue.');
  $('download').hidden = true;
  text('load', 'Reload Qwen · ~450 MB cached');
  showError(message);
  enabled();
}
function createWorker() {
  const current = new Worker(
    new URL('../inference.worker.js', import.meta.url),
    { type: 'module' },
  );
  worker = current;
  current.onmessage = ({ data }) => {
    if (worker !== current) return;
    if (data.type === 'progress') {
      if (Number.isFinite(data.progress))
        $('progress').value = Math.max(0, Math.min(100, data.progress));
      text('load-status', data.message);
      return;
    }
    if (data.type === 'ready') {
      loaded = true;
      loading = false;
      busy = false;
      mode = 'model';
      $('download').hidden = true;
      text('load', 'Use local Qwen');
      text(
        'compatibility',
        'Qwen is loaded on this device. Each car keeps its own instructions; one shared model takes turns choosing.',
      );
      text(
        'run-status',
        'Ready. Start the engines to let Qwen choose for all four drivers.',
      );
      enabled();
      updateUI();
      return;
    }
    if (data.type === 'error') {
      clearTimeout(watchdog);
      busy = false;
      pending = null;
      if (probe) {
        probe.reject(new Error(data.message));
        probe = null;
        enabled();
        return;
      }
      if (data.operation === 'load') return failWorker(data.message);
      if (data.epoch !== epoch) return;
      stop('Inference failed. No scripted choices were substituted.');
      showError(data.message);
      return;
    }
    if (data.type !== 'decision') return;
    clearTimeout(watchdog);
    busy = false;
    nextInference = performance.now() + ($('pace').value === 'fast' ? 30 : 200);
    const request = pending;
    pending = null;
    if (probe && data.id === probe.id) {
      const active = probe;
      probe = null;
      enabled();
      try {
        if (
          !request ||
          data.epoch !== epoch ||
          game.running ||
          data.unitId !== request.unitId ||
          data.scenario !== 'driving'
        )
          throw new Error('Probe superseded or mismatched');
        validateDecision(data.parsed_json, {
          [request.unitId]: request.actions,
        });
        active.resolve({
          ...data,
          observedContext: request.context,
          policy: request.policy,
        });
      } catch (error) {
        active.reject(error);
      }
      return;
    }
    if (
      !request ||
      request.id !== data.id ||
      data.unitId !== request.unitId ||
      data.epoch !== epoch ||
      !game.running ||
      mode !== 'model'
    ) {
      discarded++;
      return;
    }
    try {
      if (data.scenario !== 'driving')
        throw new Error('Unexpected decision scenario');
      validateDecision(data.parsed_json, { [request.unitId]: request.actions });
      const action = data.parsed_json[request.unitId];
      if (!game.availableActions(request.unitId).includes(action)) {
        discarded++;
        text(
          'run-status',
          'A traffic gap changed before the decision arrived. Taking a fresh look.',
        );
        return;
      }
      game.apply(data.parsed_json, 'model');
      decisions.set(request.unitId, {
        ...data,
        observedContext: request.context,
        policy: request.policy,
        appliedAt: game.time,
      });
      record(request.unitId, action, 'model');
      latestLatency = data.elapsed_ms;
      telemetry.record(
        performance.now(),
        request.unitId,
        game.drivers.filter((car) => car.alive).map((car) => car.id),
        data.elapsed_ms,
      );
      const car = game.drivers.find((driver) => driver.id === request.unitId);
      text(
        'run-status',
        `${car.name}: ${ACTION_LABELS[action].toLowerCase()} · ${data.prompt_tokens} input tokens · one scored output position.`,
      );
      updateUI();
    } catch (error) {
      stop('Decision rejected. No invalid control was applied.');
      showError(error.message);
    }
  };
  current.onerror = (event) => {
    if (worker === current)
      failWorker(event.message || 'Inference worker failed');
  };
}
function requestDecision(car, options = {}) {
  const id = ++sequence;
  const context = options.context ?? game.contextFor(car.id);
  const actions =
    options.actions ?? context.availableActions ?? game.availableActions(car);
  pending = {
    id,
    unitId: car.id,
    epoch,
    context,
    actions,
    policy: options.policy ?? policies[car.id],
    sentAt: performance.now(),
  };
  busy = true;
  worker.postMessage({
    type: 'decide',
    scenario: 'driving',
    id,
    epoch,
    unitId: car.id,
    context,
    actions,
    mission: MISSION,
    rolePrompt: pending.policy,
    pace: $('pace').value,
    testOnly: options.testOnly === true,
    ...(options.testOnly && options.compareWithWhole
      ? { compareWithWhole: true }
      : {}),
    ...(options.labelMode ? { labelMode: options.labelMode } : {}),
  });
  watchdog = setTimeout(
    () =>
      failWorker(
        'Inference took more than 45 seconds. The drive has been paused; try reloading Qwen.',
      ),
    45000,
  );
  return id;
}
$('load').onclick = () => {
  if (loading) return;
  stop();
  hideError();
  if (loaded) {
    mode = 'model';
    text('run-status', 'Local Qwen selected. Resume the drive.');
    enabled();
    updateUI();
    return;
  }
  loading = true;
  mode = 'idle';
  $('download').hidden = false;
  $('progress').value = 0;
  text('load-status', 'Preparing Qwen and the tokenizer…');
  createWorker();
  worker.postMessage({ type: 'load' });
  enabled();
};
$('cancel-load').onclick = () => {
  worker?.terminate();
  worker = null;
  loading = loaded = busy = false;
  pending = null;
  $('download').hidden = true;
  text('run-status', 'Download cancelled. Completed files may remain cached.');
  enabled();
  updateUI();
};
function start() {
  if (mode === 'idle' || loading || !rendererReady || probe) return;
  if (game.over) resetRace();
  epoch++;
  game.running = true;
  telemetry.begin(performance.now());
  text('run', 'Pause');
  text(
    'run-status',
    mode === 'model'
      ? 'Qwen is reading the circuit…'
      : 'Scripted drive. These rules do not read your prompts or count as AI decisions.',
  );
  updateUI();
}
$('preview').onclick = () => {
  if (loading) return;
  stop();
  hideError();
  mode = 'scripted';
  enabled();
  start();
};
$('run').onclick = () => (game.running ? stop() : start());
function resetRace() {
  stop();
  const seed = Math.max(1, Math.min(99999, Number($('seed').value) || 7));
  $('seed').value = seed;
  game.reset({ seed });
  game.assistEnabled = $('assist').checked;
  scheduler.reset();
  telemetry.reset();
  decisions.clear();
  histories.clear();
  historyVersion = scoreVersion = eventVersion = null;
  latestLatency = null;
  discarded = 0;
  lastScripted = -Infinity;
  text('run', 'Start engines');
  text('run-status', 'Grid reset. Your saved driver prompts are retained.');
  hideError();
  updateUI();
}
$('reset').onclick = resetRace;
$('assist').onchange = () => {
  game.assistEnabled = $('assist').checked;
  epoch++;
  updateUI();
};
$('driver-prompt').oninput = () => {
  drafts[selectedId] = $('driver-prompt').value;
  text('prompt-count', `${drafts[selectedId].length} / 1000`);
  text(
    'prompt-status',
    drafts[selectedId] === policies[selectedId]
      ? 'Edits affect this car’s next AI decision.'
      : 'Unapplied changes. Apply to use these instructions.',
  );
};
function applyPrompt(restore = false) {
  if (restore)
    drafts[selectedId] = DRIVERS.find(
      (driver) => driver.id === selectedId,
    ).defaultPrompt;
  const value = drafts[selectedId].trim();
  if (!value || value.length > 1000) {
    text('prompt-status', 'Use between 1 and 1,000 characters.');
    return;
  }
  policies[selectedId] = drafts[selectedId] = value;
  epoch++; // An older prompt must never control a car after this edit.
  try {
    localStorage.setItem('jevfire-racing-policies', JSON.stringify(policies));
  } catch {
    /* Prompts still work for this session. */
  }
  $('driver-prompt').value = value;
  text('prompt-count', `${value.length} / 1000`);
  text(
    'prompt-status',
    mode === 'scripted'
      ? 'Saved. Select Qwen to drive with these instructions.'
      : 'Applied. This car’s next AI choice will use these instructions.',
  );
}
$('apply-prompt').onclick = () => applyPrompt();
$('restore-prompt').onclick = () => applyPrompt(true);
$('close-inspector').onclick = () => $('inspector').classList.remove('open');
$('reset-camera').onclick = () => renderer?.resetCamera();
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('inspector').classList.remove('open');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.running)
    stop('Paused while the tab is hidden. Resume when ready.');
});
window.addEventListener('pagehide', () => {
  worker?.terminate();
  renderer?.dispose();
});
window.addEventListener('pageshow', (event) => {
  // A history-cache restore must not reuse the disposed GPU scene or worker.
  if (event.persisted) location.reload();
});

makeCards();
selectDriver(selectedId);
try {
  renderer = new DrivingRenderer($('circuit'), game, {
    onSelect: (id) => selectDriver(id, true),
  });
  Promise.resolve(renderer.ready)
    .then(() => {
      rendererReady = true;
      renderer.select(selectedId);
      enabled();
    })
    .catch((error) => {
      showError(error.message);
      enabled();
    });
} catch (error) {
  showError(`The circuit could not start: ${error.message}`);
}
enabled();
(async () => {
  try {
    if (!navigator.gpu)
      throw new Error(
        'WebGPU is unavailable. Try a current desktop browser, or use the scripted drive.',
      );
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter?.features.has('shader-f16'))
      throw new Error(
        'This model needs WebGPU with shader-f16. The scripted drive still works.',
      );
  } catch (error) {
    gpuAvailable = false;
    text('compatibility', error.message);
    enabled();
  }
})();

function frame(now) {
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const wasRunning = game.running;
  game.update(dt * Number($('sim-speed').value));
  if (wasRunning && !game.running && game.over)
    stop(game.endReason || 'Race complete.');
  const draw = now - lastDraw >= 1000 / 60 - 0.5;
  if (draw) {
    renderer?.draw(now, Math.min(0.25, (now - lastDraw) / 1000));
    lastDraw = now;
  }
  frames.record(now, draw && rendererReady);
  if (now - lastUi > 250) {
    updateUI(now);
    lastUi = now;
  }
  if (game.running) {
    if (mode === 'model' && loaded && !busy && now >= nextInference) {
      const car = scheduler.next(
        game.drivers.filter(
          (driver) => game.availableActions(driver).length > 1,
        ),
      );
      if (car) requestDecision(car);
    } else if (mode === 'scripted' && game.time - lastScripted >= 1.1) {
      lastScripted = game.time;
      const choices = game.scripted();
      // Revalidate each maneuver against reservations made by earlier cars.
      for (const [id, proposed] of Object.entries(choices)) {
        const options = game.availableActions(id);
        if (!options.length) continue;
        const action = options.includes(proposed) ? proposed : 'hold';
        game.apply({ [id]: action }, 'scripted');
        record(id, action, 'scripted');
      }
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only browser QA. Selection raycasts are opt-in, outside routine telemetry.
window.slipstreamDiagnostics = ({ selectionTargets = false } = {}) => ({
  mode,
  loaded,
  loading,
  busy,
  epoch,
  rendererReady,
  running: game.running,
  time: game.time,
  selectedId,
  discarded,
  pending: pending
    ? {
        id: pending.id,
        unitId: pending.unitId,
        epoch: pending.epoch,
        policy: pending.policy,
      }
    : null,
  policies: { ...policies },
  metrics: telemetry.snapshot(
    performance.now(),
    game.running && mode === 'model',
  ),
  frames: frames.snapshot(performance.now()),
  summary: game.summary(),
  events: [...game.events],
  drivers: game.drivers.map((car) => ({ ...car })),
  selectedDecision: decisions.get(selectedId) ?? null,
  decisions: Object.fromEntries(decisions),
  selectedHistory: histories.get(selectedId) || [],
  selectedContext: game.contextFor(selectedId),
  selectionTargets: selectionTargets ? renderer?.selectionTargets() : undefined,
});

// Paused-only real inference for reproducible policy experiments; never applies
// controls, manufactures game state, or adds model-throughput samples.
window.slipstreamProbe = (options = {}) => {
  if (!loaded || busy || game.running || probe)
    return Promise.reject(
      new Error(
        'Load Qwen, pause the race, and wait for inference to finish before probing.',
      ),
    );
  const car = game.drivers.find((driver) => driver.id === options.unitId);
  if (!car) return Promise.reject(new Error('Unknown driver'));
  return new Promise((resolve, reject) => {
    probe = { id: sequence + 1, resolve, reject };
    enabled();
    try {
      requestDecision(car, { ...options, testOnly: true });
    } catch (error) {
      probe = null;
      enabled();
      reject(error);
    }
  });
};
