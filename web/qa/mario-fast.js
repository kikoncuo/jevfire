const worker = new Worker(
  new URL('../src/inference.worker.js', import.meta.url),
  { type: 'module' },
);
let sequence = 0,
  pending;
window.fastMarioCall = (data) =>
  new Promise((resolve, reject) => {
    if (pending) return reject(new Error('One probe at a time'));
    pending = { resolve, reject };
    worker.postMessage({ ...data, id: ++sequence, epoch: 0, testOnly: true });
  });
worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    document.querySelector('#status').textContent = data.message;
    return;
  }
  if (data.type === 'error') {
    pending?.reject(new Error(data.message));
    pending = null;
    return;
  }
  const active = pending;
  pending = null;
  if (data.type === 'ready') {
    window.fastMarioReady = data;
    document.querySelector('#status').textContent = JSON.stringify(
      data,
      null,
      2,
    );
  }
  active?.resolve(data);
};
window.fastMarioCall({ type: 'load' }).catch((error) => {
  window.fastMarioError = error.message;
  document.querySelector('#status').textContent = error.message;
});
window.addEventListener('pagehide', () => worker.terminate());
