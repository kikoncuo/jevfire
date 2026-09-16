import test from 'node:test';
import assert from 'node:assert/strict';
import { sameBufferCopies } from '../src/sdk/webgpu-copy.js';

test('recurrent slot copies use a separate buffer and preserve overlapping source bytes', () => {
  const saved = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { COPY_SRC: 4, COPY_DST: 8 };
  try {
    const buffer = { bytes: Uint8Array.from({ length: 32 }, (_, i) => i) };
    const commands = [];
    const allocated = [];
    const context = {
      device: {
        createBuffer: ({ size }) => {
          const b = {
            bytes: new Uint8Array(size),
            destroy() {
              this.destroyed = true;
            },
          };
          allocated.push(b);
          return b;
        },
        createCommandEncoder: () => ({
          copyBufferToBuffer: (a, x, b, y, n) => {
            assert.notEqual(a, b);
            commands.push(() => b.bytes.set(a.bytes.slice(x, x + n), y));
          },
        }),
      },
      gpuBufferFromPtr: () => buffer,
      deviceCopyWithinGPU() {
        throw new Error('Unsafe direct copy');
      },
    };
    const original = context.deviceCopyWithinGPU;
    const shim = sameBufferCopies(context);
    shim.run(() => context.deviceCopyWithinGPU(1, 0, 1, 4, 16));
    assert.equal(context.deviceCopyWithinGPU, original);
    for (const command of commands) command();
    assert.deepEqual(
      [...buffer.bytes.slice(4, 20)],
      Array.from({ length: 16 }, (_, i) => i),
    );
    assert.equal(allocated.length, 1);
    assert.throws(
      () =>
        shim.run(() => {
          throw new Error('abort');
        }),
      /abort/,
    );
    assert.equal(context.deviceCopyWithinGPU, original);
    shim.dispose();
    assert.equal(allocated[0].destroyed, true);
  } finally {
    globalThis.GPUBufferUsage = saved;
  }
});
