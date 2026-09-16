// WebLLM 0.2.85's TVM RNN fork copies slots inside one GPUBuffer. WebGPU
// forbids that operation, even when the byte ranges do not overlap. Stage
// those copies through a separate GPU-only buffer, preserving command order.
// This shim is installed only during synchronous cache operations on this
// engine instance. No prototypes or dependency files are changed.
export function sameBufferCopies(context) {
  if (
    !context?.device ||
    !context.gpuBufferFromPtr ||
    !context.deviceCopyWithinGPU
  )
    throw new Error('Unsupported WebGPU copy ABI');
  const staging = new Map();
  const original = context.deviceCopyWithinGPU;
  function copy(from, fromOffset, to, toOffset, bytes) {
    const source = context.gpuBufferFromPtr(from);
    const target = context.gpuBufferFromPtr(to);
    if (source !== target)
      return original.call(context, from, fromOffset, to, toOffset, bytes);
    if (!bytes || fromOffset === toOffset) return;
    if (
      [fromOffset, toOffset, bytes].some(
        (value) => !Number.isSafeInteger(value) || value < 0 || value % 4,
      )
    )
      throw new Error('Unaligned GPU state copy');
    let scratch = staging.get(bytes);
    if (!scratch) {
      scratch = context.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        label: 'JEVfire recurrent checkpoint staging',
      });
      staging.set(bytes, scratch);
    }
    context.pendingEncoder ??= context.device.createCommandEncoder();
    context.pendingEncoder.copyBufferToBuffer(
      source,
      fromOffset,
      scratch,
      0,
      bytes,
    );
    context.pendingEncoder.copyBufferToBuffer(
      scratch,
      0,
      target,
      toOffset,
      bytes,
    );
    context.pendingGPUToCPUCopyIsQueueTail = false;
  }
  return {
    run(callback) {
      if (context.deviceCopyWithinGPU !== original)
        throw new Error('GPU copy adapter is already in use');
      context.deviceCopyWithinGPU = copy;
      try {
        return callback();
      } finally {
        context.deviceCopyWithinGPU = original;
      }
    },
    dispose() {
      for (const buffer of staging.values()) buffer.destroy();
      staging.clear();
    },
  };
}
