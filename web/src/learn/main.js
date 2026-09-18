import './style.css';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const methods = {
  finite: {
    nodes: [
      ['Read the context', 'Reuse an exact cached prefix.'],
      ['Score the vocabulary', 'Same model, same tokenizer.'],
      ['Keep A / B / C', 'Choose the highest-scoring label.'],
      ['Build JSON in code', 'Map A to the typed value jump.'],
    ],
    steps: [0, 1, 2, 3],
    outputs: [
      '—',
      'Scores for existing tokens',
      'A → jump',
      '{ "maneuver": "jump" }',
    ],
    note: 'Independent fields can be batched on CUDA. Browser fields run sequentially with shared context.',
  },
  grammar: {
    nodes: [
      ['Read context + schema', 'Prefix caching can work here too.'],
      [
        'Score + mask illegal tokens',
        'The grammar restricts what may come next.',
      ],
      ['Append; update grammar state', 'Repeat for the next generated token.'],
      [
        'Complete the JSON',
        'Nested objects, arrays, and strings are possible.',
      ],
    ],
    steps: [0, 1, 2, 1, 2, 1, 2, 3],
    outputs: [
      '—',
      'Mask: allowed continuations',
      '{',
      '{',
      '{ "maneuver":',
      '{ "maneuver":',
      '{ "maneuver": "jump"',
      '{ "maneuver": "jump" }',
    ],
    note: 'Schematic chunks, not actual tokens or a latency comparison. Some engines skip forced text. Schema validity does not guarantee correctness.',
  },
  classifier: {
    nodes: [
      [
        'Read context + candidate descriptions',
        'For example: jump / wait / run.',
      ],
      ['Run a trained encoder', 'Weights learned from labeled examples.'],
      [
        'Score with a classification head',
        'Candidate scores, not vocabulary generation.',
      ],
      [
        'Build JSON in code',
        'Select a candidate and assemble the typed result.',
      ],
    ],
    steps: [0, 1, 2, 3],
    outputs: [
      '—',
      'Hidden representations',
      'jump → highest score',
      '{ "maneuver": "jump" }',
    ],
    note: 'Example: Verdict / ModernBERT. A new trained head does not automatically produce calibrated confidence.',
  },
};
let pathTimer;
function resetPath() {
  clearTimeout(pathTimer);
  $('animate-path').disabled = false;
  const method = methods[$('path').value];
  $('pipeline').replaceChildren(
    ...method.nodes.map(([title, description]) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      const span = document.createElement('span');
      b.textContent = title;
      span.textContent = description;
      li.append(b, span);
      return li;
    }),
  );
  $('path-output').textContent = '{ "maneuver": "jump" }';
  $('path-state').textContent = 'Ready';
  $('path-note').textContent = method.note;
}
$('path').addEventListener('change', resetPath);
$('animate-path').addEventListener('click', () => {
  resetPath();
  const method = methods[$('path').value];
  $('animate-path').disabled = true;
  let step = reducedMotion.matches ? method.steps.length - 1 : 0;
  function advance() {
    [...$('pipeline').children].forEach((node, i) =>
      node.classList.toggle('active', i === method.steps[step]),
    );
    $('path-output').textContent = method.outputs[step];
    $('path-state').textContent = `Step ${step + 1} / ${method.steps.length}`;
    step += 1;
    if (step < method.steps.length) pathTimer = setTimeout(advance, 650);
    else {
      $('animate-path').disabled = false;
      $('path-state').textContent = 'Complete';
    }
  }
  advance();
});

let normalized = false;
$('normalize').addEventListener('click', () => {
  normalized = !normalized;
  const bar = $('restricted');
  bar.querySelector('.a').style.width = normalized ? '66.6667%' : '10%';
  bar.querySelector('.b').style.width = normalized ? '33.3333%' : '5%';
  bar.setAttribute(
    'aria-label',
    normalized
      ? 'Restricted distribution: A 66.7%, B 33.3%'
      : 'Retained mass: A 10%, B 5%',
  );
  $('retained').textContent = normalized
    ? '100% of allowed choices'
    : '15% retained';
  $('restricted-values').textContent = normalized
    ? 'A 66.7% · B 33.3%'
    : 'A 10% · B 5%';
  $('normalize').textContent = normalized
    ? 'Show original scale ←'
    : 'Rescale to 100% →';
  $('probability-status').textContent = normalized
    ? '66.7% is a relative preference, not a success rate.'
    : 'No weights changed. No tokenizer changed.';
});

$('outcomes').replaceChildren(
  ...Array.from({ length: 100 }, (_, i) => {
    const dot = document.createElement('span');
    if (i >= 70) dot.className = 'wrong';
    return dot;
  }),
);
const svg = $('calibration-chart');
const penalty = (p) => 0.7 * (1 - p) ** 2 + 0.3 * p ** 2;
let x, y, animation;
function element(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) =>
    node.setAttribute(key, value),
  );
  if (text !== undefined) node.textContent = text;
  svg.append(node);
  return node;
}
function updateConfidence() {
  const confidence = Number($('confidence').value);
  $('confidence-value').textContent = `${confidence}%`;
  $('penalty').textContent = `Penalty: ${penalty(confidence / 100).toFixed(3)}`;
  const marker = svg.querySelector('[data-current]');
  if (marker) {
    marker.setAttribute('cx', x(confidence));
    marker.setAttribute('cy', y(penalty(confidence / 100)));
  }
  svg.setAttribute(
    'aria-label',
    `At ${confidence}% confidence, average binary Brier penalty is ${penalty(confidence / 100).toFixed(3)}. Minimum at 70% confidence.`,
  );
}
function drawChart() {
  const width = svg.clientWidth,
    height = 240;
  const left = 48,
    right = width - 15,
    top = 18,
    bottom = 194;
  x = (value) => left + 6 + (value / 100) * (right - left - 12);
  y = (value) => bottom - 6 - (value / 0.75) * (bottom - top - 12);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const text = {
    fill: 'var(--ink)',
    'font-size': 11,
    'font-family': 'var(--mono)',
  };
  element('rect', {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    fill: 'none',
    stroke: 'var(--line)',
  });
  [0, 0.2, 0.4, 0.6].forEach((tick) => {
    element(
      'text',
      { ...text, x: left - 8, y: y(tick) + 4, 'text-anchor': 'end' },
      tick.toFixed(1),
    );
  });
  (width < 360 ? [0, 50, 100] : [0, 25, 50, 75, 100]).forEach((tick) => {
    element(
      'text',
      {
        ...text,
        x: x(tick),
        y: bottom + 19,
        'text-anchor': tick === 0 ? 'start' : tick === 100 ? 'end' : 'middle',
      },
      `${tick}%`,
    );
  });
  element(
    'text',
    { ...text, x: (left + right) / 2, y: height - 3, 'text-anchor': 'middle' },
    'Reported confidence',
  );
  element(
    'text',
    {
      ...text,
      transform: `translate(12 ${(top + bottom) / 2}) rotate(-90)`,
      'text-anchor': 'middle',
    },
    'Average penalty',
  );
  const path = Array.from(
    { length: 101 },
    (_, v) => `${v ? 'L' : 'M'}${x(v)},${y(penalty(v / 100))}`,
  ).join(' ');
  element('path', {
    d: path,
    fill: 'none',
    stroke: 'var(--green)',
    'stroke-width': 2,
  });
  const bx = x(70),
    by = y(penalty(0.7));
  element('path', {
    d: `M${bx},${by - 7}l5,7 -5,7 -5,-7Z`,
    fill: 'var(--red)',
  });
  element('circle', { 'data-current': '', r: 5, fill: 'var(--ink)' });
  updateConfidence();
}
$('confidence').addEventListener('input', () => {
  cancelAnimationFrame(animation);
  $('learn-confidence').disabled = false;
  updateConfidence();
});
$('learn-confidence').addEventListener('click', () => {
  cancelAnimationFrame(animation);
  const start = Number($('confidence').value),
    started = performance.now();
  $('learn-confidence').disabled = true;
  function frame(now) {
    const progress = reducedMotion.matches
      ? 1
      : Math.min(1, (now - started) / 1500);
    $('confidence').value = Math.round(
      start + (70 - start) * (1 - (1 - progress) ** 3),
    );
    updateConfidence();
    if (progress < 1) animation = requestAnimationFrame(frame);
    else $('learn-confidence').disabled = false;
  }
  animation = requestAnimationFrame(frame);
});
new ResizeObserver(drawChart).observe(svg);
drawChart();
