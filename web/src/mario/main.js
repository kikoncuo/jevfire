import './style.css';
import { MarioGame } from './game.js';
import { MarioRenderer } from './renderer.js';
import { DEFAULT_POLICY, validateControl } from './contract.js';
import { DecisionTelemetry, FrameTelemetry } from '../controller.js';

const $ = (id) => document.getElementById(id);
const text = (id, value) => {
  if ($(id).textContent !== String(value)) $(id).textContent = value;
};
const game = new MarioGame();
const renderer = new MarioRenderer($('world'), game);
const telemetry = new DecisionTelemetry(),
  frames = new FrameTelemetry();
const keys = new Set();
let mode = 'idle',
  running = false,
  worker = null,
  loaded = false,
  loading = false,
  busy = false;
let epoch = 0,
  sequence = 0,
  pending = null,
  watchdog = null,
  probe = null;
let lastFrame = performance.now(),
  lastUi = 0,
  lastDraw = 0,
  actionRemaining = 0,
  scriptedRemainder = 0;
let lastDecision = null,
  discarded = 0,
  decisions = [],
  eventVersion = '';
let inferenceTotal = 0,
  inputTotal = 0,
  cachedTotal = 0;
let policy = DEFAULT_POLICY;
try {
  const saved = localStorage.getItem('jevfire-mario-policy');
  if (saved?.trim() && saved.length <= 700) policy = saved;
} catch {
  /* Storage is optional. */
}
$('policy').value = policy;
const sourceLabel = {
  idle: 'NO CONTROLLER',
  model: 'LOCAL QWEN',
  manual: 'YOU',
  scripted: 'SCRIPTED',
};
const showError = (message) => {
  text('error', message);
  $('error').hidden = !message;
};
function enabled() {
  $('load').disabled = loading || !navigator.gpu;
  $('manual').disabled = $('scripted').disabled = loading || Boolean(probe);
  $('run').disabled = loading || mode === 'idle' || Boolean(probe);
}
function stop(message = 'Paused. Any pending answer is discarded.') {
  running = false;
  game.running = false;
  epoch++;
  keys.clear();
  text('run', game.over ? 'Try again' : 'Resume');
  text('status', message);
  updateUI();
}
function reset() {
  stop('Level reset. Your player instructions are retained.');
  game.reset();
  inferenceTotal = inputTotal = cachedTotal = 0;
  telemetry.reset();
  decisions = [];
  lastDecision = null;
  actionRemaining = 0;
  scriptedRemainder = 0;
  discarded = 0;
  eventVersion = '';
  text('run', 'Start level');
  text(
    'observation',
    'The next accepted AI update will save its observation here.',
  );
  $('scores').replaceChildren();
  showError('');
  updateUI();
}
function start() {
  if (mode === 'idle' || loading || probe) return;
  if (game.over) reset();
  running = true;
  if (mode === 'manual') $('world').focus({ preventScroll: true });
  epoch++;
  actionRemaining = 0;
  telemetry.begin(performance.now());
  text('run', 'Pause');
  showError('');
  text(
    'status',
    mode === 'model'
      ? 'Qwen is choosing three controls from one shared observation.'
      : mode === 'manual'
        ? 'Arrow keys move · Space jumps · hold Shift to run.'
        : 'Scripted baseline. These rules do not use your prompt or count as AI decisions.',
  );
  if (mode === 'model') requestDecision();
  updateUI();
}
function updateUI(now = performance.now()) {
  const metrics = telemetry.snapshot(now, running && mode === 'model');
  text('player-form', game.player.power.toUpperCase());
  text('coins', String(game.coins).padStart(2, '0'));
  text('time', Math.max(0, Math.ceil(game.timeRemaining)));
  text(
    'distance',
    `${Math.min(100, Math.max(0, Math.round((game.player.x / game.level.goal.flagX) * 100)))}%`,
  );
  text('source', sourceLabel[mode]);
  text(
    'state',
    game.won
      ? 'COURSE CLEAR'
      : game.dead
        ? 'TRY AGAIN'
        : !running
          ? 'PAUSED'
          : mode === 'model' && busy
            ? 'QWEN IS THINKING…'
            : mode === 'model'
              ? 'QWEN IS PLAYING'
              : mode === 'manual'
                ? 'YOUR TURN'
                : 'SCRIPTED RUN',
  );
  text(
    'timing-status',
    $('timing').value === 'step' && mode === 'model'
      ? 'Decision steps · the world waits while Qwen thinks'
      : mode === 'model'
        ? 'Live mode · the world moves during inference'
        : 'Original drawn artwork · approximate World 1-1 physics',
  );
  text(
    'update-rate',
    mode === 'model' ? metrics.decisions_per_second.toFixed(2) : '—',
  );
  text(
    'field-rate',
    mode === 'model' ? (metrics.decisions_per_second * 3).toFixed(2) : '—',
  );
  text(
    'latency',
    telemetry.total
      ? `${Math.round(inferenceTotal / telemetry.total)} ms`
      : '—',
  );
  text(
    'cache',
    inputTotal ? `${Math.round((cachedTotal / inputTotal) * 100)}%` : '—',
  );
  text('fps', Math.round(frames.snapshot(now).fps));
  const control = game.control;
  text('control-direction', control?.direction || 'still');
  text('control-jump', control?.jump ? 'YES' : 'NO');
  text('control-speed', control?.speed || 'walk');
  text(
    'choice-age',
    lastDecision
      ? `Update #${lastDecision.number} · ${Math.max(0, (now - lastDecision.acceptedAt) / 1000).toFixed(1)}s ago · ${Math.round(lastDecision.elapsed_ms)} ms · 3 fields`
      : 'No AI decision yet.',
  );
  const events = game.events
    .filter((event) => event.type !== 'control')
    .slice(-5)
    .reverse();
  const key = JSON.stringify(events);
  if (key !== eventVersion) {
    eventVersion = key;
    $('events').replaceChildren();
    for (const event of events) {
      const li = document.createElement('li'),
        time = document.createElement('time');
      time.textContent = `${Number(event.time || 0).toFixed(1)}s`;
      li.append(time, document.createTextNode(event.message || event.type));
      $('events').append(li);
    }
    if (!events.length) {
      const li = document.createElement('li');
      li.textContent = 'The flag is waiting.';
      $('events').append(li);
    }
  }
}
function renderScores(result) {
  $('scores').replaceChildren();
  for (const [key, field] of Object.entries(result.fields)) {
    const row = document.createElement('div');
    row.className = 'score-field';
    const title = document.createElement('b');
    title.textContent = key;
    const values = document.createElement('span');
    values.textContent = field.options
      .map(
        (value, index) =>
          `${value}: ${Math.round(field.probabilities[index] * 100)}%`,
      )
      .join(' · ');
    row.append(title, values);
    $('scores').append(row);
  }
  const note = document.createElement('p');
  note.className = 'fine';
  note.textContent = 'Relative option scores, not certainty.';
  $('scores').append(note);
}
function fail(message) {
  clearTimeout(watchdog);
  probe?.reject(new Error(message));
  probe = null;
  worker?.terminate();
  worker = null;
  loaded = loading = busy = false;
  pending = null;
  mode = 'idle';
  stop('Model stopped. Reload Qwen to try again.');
  $('download').hidden = true;
  text('load', 'Reload Qwen · cached');
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
      if (Number.isFinite(data.progress)) $('progress').value = data.progress;
      text('load-status', data.message);
      return;
    }
    if (data.type === 'ready') {
      loading = false;
      loaded = true;
      mode = 'model';
      $('download').hidden = true;
      text('load', 'Use local Qwen');
      text(
        'status',
        `Qwen is ready. ${data.sdk_backend?.includes('forked') ? 'Shared-context caching is active.' : 'This runtime uses independent prefills.'} Start the level to play.`,
      );
      enabled();
      updateUI();
      return;
    }
    if (data.type === 'error') {
      if (data.operation === 'load') {
        fail(data.message);
        return;
      }
      clearTimeout(watchdog);
      busy = false;
      pending = null;
      if (probe) {
        probe.reject(new Error(data.message));
        probe = null;
        enabled();
        return;
      }
      if (data.epoch === epoch) {
        stop('Inference failed. No scripted choice was substituted.');
        showError(data.message);
      }
      return;
    }
    if (data.type !== 'marioDecision') return;
    clearTimeout(watchdog);
    const sent = pending;
    pending = null;
    busy = false;
    if (probe && data.id === probe.id) {
      const active = probe;
      probe = null;
      enabled();
      try {
        if (!sent || data.epoch !== epoch || running)
          throw new Error('Probe superseded');
        validateControl(data.parsed_json);
        active.resolve({ ...data, observedContext: sent.context });
      } catch (error) {
        active.reject(error);
      }
      return;
    }
    if (
      !sent ||
      data.id !== sent.id ||
      data.epoch !== epoch ||
      !running ||
      game.over ||
      mode !== 'model'
    ) {
      discarded++;
      return;
    }
    try {
      validateControl(data.parsed_json);
      game.applyControl(data.parsed_json, 'model');
      const now = performance.now();
      telemetry.record(now, 'mario', ['mario'], data.elapsed_ms);
      inferenceTotal += data.elapsed_ms;
      inputTotal += data.usage.input_tokens;
      cachedTotal += data.usage.cached_prefix_tokens;
      lastDecision = {
        ...data,
        observedContext: sent.context,
        policy: sent.policy,
        number: telemetry.total,
        acceptedAt: now,
        roundtrip_ms: now - sent.sentAt,
      };
      decisions.push(lastDecision);
      if (decisions.length > 200) decisions.shift();
      actionRemaining = 0.3;
      renderScores(data);
      text('observation', JSON.stringify(sent.context, null, 2));
      updateUI(now);
    } catch (error) {
      stop('Invalid control rejected.');
      showError(error.message);
    }
  };
  current.onerror = (event) => {
    if (worker === current) fail(event.message || 'Inference worker failed');
  };
}
function requestDecision(options = {}) {
  if (!loaded || busy || (!running && !options.probe)) return;
  const context = options.context ?? game.observe();
  pending = {
    id: ++sequence,
    epoch,
    context,
    policy,
    sentAt: performance.now(),
  };
  busy = true;
  worker.postMessage({
    type: 'decideMario',
    id: pending.id,
    epoch,
    context,
    rolePrompt: policy,
    cache: options.cache !== false,
    pace: 'fast',
    testOnly: options.probe === true,
  });
  watchdog = setTimeout(
    () => fail('Inference took more than 45 seconds. Reload Qwen to retry.'),
    45000,
  );
}
$('load').onclick = () => {
  if (loading) return;
  stop();
  showError('');
  if (loaded) {
    mode = 'model';
    enabled();
    updateUI();
    return;
  }
  loading = true;
  mode = 'idle';
  $('download').hidden = false;
  $('progress').value = 0;
  createWorker();
  worker.postMessage({ type: 'load' });
  enabled();
};
$('cancel').onclick = () => {
  worker?.terminate();
  worker = null;
  loaded = loading = busy = false;
  pending = null;
  $('download').hidden = true;
  text('status', 'Download cancelled. Completed files may remain cached.');
  enabled();
};
$('manual').onclick = () => {
  stop();
  mode = 'manual';
  enabled();
  start();
  $('world').focus({ preventScroll: true });
};
$('scripted').onclick = () => {
  stop();
  mode = 'scripted';
  enabled();
  start();
};
$('run').onclick = () => (running ? stop() : start());
$('reset').onclick = reset;
$('timing').onchange = () => {
  epoch++;
  actionRemaining = 0;
  updateUI();
};
function applyPolicy(restore = false) {
  const value = (restore ? DEFAULT_POLICY : $('policy').value).trim();
  if (!value || value.length > 700) {
    text('policy-status', 'Use between 1 and 700 characters.');
    return;
  }
  policy = value;
  $('policy').value = policy;
  epoch++;
  actionRemaining = 0;
  try {
    localStorage.setItem('jevfire-mario-policy', policy);
  } catch {
    /* Session-only is fine. */
  }
  text(
    'policy-status',
    'Applied. The next AI update will use these instructions.',
  );
}
$('apply').onclick = () => applyPolicy();
$('restore').onclick = () => applyPolicy(true);
$('policy').oninput = () =>
  text(
    'policy-status',
    $('policy').value === policy
      ? 'Changes affect the next AI update.'
      : 'Unapplied changes.',
  );
const inputKey = (event) =>
  event.code === 'Space'
    ? 'Space'
    : event.key.startsWith('Shift')
      ? 'Shift'
      : event.key;
document.addEventListener('keydown', (event) => {
  if (
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(
      document.activeElement?.tagName,
    ) ||
    mode !== 'manual' ||
    !running
  )
    return;
  const key = inputKey(event);
  if (['ArrowLeft', 'ArrowRight', 'Space', 'Shift'].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }
});
document.addEventListener('keyup', (event) => keys.delete(inputKey(event)));
window.addEventListener('blur', () => keys.clear());
for (const button of document.querySelectorAll('[data-key]')) {
  button.onpointerdown = (event) => {
    if (mode !== 'manual' || !running) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keys.add(button.dataset.key);
    button.classList.add('held');
  };
  const release = () => {
    keys.delete(button.dataset.key);
    button.classList.remove('held');
  };
  button.onpointerup =
    button.onpointercancel =
    button.onlostpointercapture =
      release;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop('Paused while this tab is hidden.');
});
window.addEventListener('pagehide', () => {
  worker?.terminate();
  renderer.dispose();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (running && !game.over) {
    if (mode === 'manual')
      game.applyControl(
        {
          direction: keys.has('ArrowRight')
            ? 'right'
            : keys.has('ArrowLeft')
              ? 'left'
              : 'still',
          jump: keys.has('Space'),
          speed: keys.has('Shift') ? 'run' : 'walk',
        },
        'manual',
      );
    const stepMode = mode === 'model' && $('timing').value === 'step';
    game.running = !stepMode || actionRemaining > 0;
    if (game.running) {
      const delta = stepMode ? Math.min(dt, actionRemaining) : dt;
      if (mode === 'scripted') {
        scriptedRemainder += delta;
        while (scriptedRemainder >= 1 / 60 && !game.over) {
          game.applyControl(game.scriptedAction(), 'scripted');
          game.update(1 / 60);
          scriptedRemainder -= 1 / 60;
        }
      } else game.update(delta);
      actionRemaining = Math.max(0, actionRemaining - delta);
    }
    if (game.over)
      stop(
        game.won
          ? `Course clear! ${game.coins} coins · ${game.score} points. Try another controller or prompt.`
          : 'The run ended. Try again, change the prompt, or take the controls yourself.',
      );
    else if (mode === 'model' && actionRemaining <= 0 && !busy)
      requestDecision();
  } else game.running = false;
  const draw = now - lastDraw >= 1000 / 60 - 0.5;
  if (draw) {
    renderer.render(Math.min(0.1, (now - lastDraw) / 1000));
    lastDraw = now;
  }
  frames.record(now, draw);
  if (now - lastUi >= 250) {
    updateUI(now);
    lastUi = now;
  }
  requestAnimationFrame(frame);
}
enabled();
updateUI();
requestAnimationFrame(frame);
window.marioDiagnostics = () => ({
  mode,
  loaded,
  loading,
  busy,
  running,
  epoch,
  discarded,
  timing: $('timing').value,
  time: game.time,
  player: { ...game.player },
  control: { ...game.control },
  won: game.won,
  dead: game.dead,
  over: game.over,
  coins: game.coins,
  score: game.score,
  lastDecision,
  decisions: [...decisions],
  events: [...game.events],
  observation: game.observe(),
  metrics: telemetry.snapshot(performance.now(), running && mode === 'model'),
  frames: frames.snapshot(performance.now()),
});
// Paused-only real inference; this never applies controls or increments counters.
window.marioProbe = (options = {}) => {
  if (!loaded || busy || running || probe)
    return Promise.reject(
      new Error(
        'Load Qwen, pause, and wait for inference to finish before probing.',
      ),
    );
  return new Promise((resolve, reject) => {
    probe = { id: sequence + 1, resolve, reject };
    enabled();
    try {
      requestDecision({ ...options, probe: true });
    } catch (error) {
      probe = null;
      enabled();
      reject(error);
    }
  });
};
