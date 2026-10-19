import type { FrameImageContext } from '../frameImages';
import {
  makeVideoFrame,
  makeVideoFrames,
  releaseFrameImages,
} from '../frameImages';
import type { DecodedFrame } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('react-native-skia', () => ({
  Skia: {
    Image: {
      MakeImageFromGPUTexture: jest.fn(() => ({ dispose: jest.fn() })),
    },
  },
}));

jest.mock('react-native-webgpu', () => ({
  GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_DST: 2 },
  importDevice: jest.fn(),
}));

const WIDTH = 16;
const HEIGHT = 8;
const RELEASE_FENCE = 42n;

// A decoder's buffer imported into Skia's device. Its access ends with the
// fence signaled once the copy out of it is done.
const makeMemory = () => {
  const texture = { width: WIDTH, height: HEIGHT, destroy: jest.fn() };
  const releaseFence = {
    export: jest.fn(() => ({ type: 'sync-fd', handle: RELEASE_FENCE })),
    destroy: jest.fn(),
  };
  return {
    texture,
    releaseFence,
    createTexture: jest.fn(() => texture),
    beginAccess: jest.fn(),
    endAccess: jest.fn(() => ({
      initialized: true,
      fences: [{ fence: releaseFence, signaledValue: 1n }],
    })),
    destroy: jest.fn(),
  };
};

const makeContext = () => {
  const memories: ReturnType<typeof makeMemory>[] = [];
  const readyFences: { destroy: jest.Mock }[] = [];
  const device = {
    features: new Set(['shared-fence-sync-fd']),
    importSharedTextureMemory: jest.fn(() => {
      const memory = makeMemory();
      memories.push(memory);
      return memory;
    }),
    importSharedFence: jest.fn(() => {
      const fence = { destroy: jest.fn() };
      readyFences.push(fence);
      return fence;
    }),
    createTexture: jest.fn(
      ({ size: [width, height] }: { size: [number, number] }) => ({
        width,
        height,
        destroy: jest.fn(),
      })
    ),
    createCommandEncoder: jest.fn(() => ({
      copyTextureToTexture: jest.fn(),
      finish: jest.fn(() => ({})),
    })),
    queue: {
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
    },
  };
  const context = { device, webgpu: {} } as unknown as FrameImageContext;
  return { context, device, memories, readyFences };
};

const makeFrame = (buffer: bigint, id: number): DecodedFrame => ({
  buffer,
  id,
  readyFence: 7n,
  width: WIDTH,
  height: HEIGHT,
  rotation: 0,
  release: jest.fn(),
  waitForReady: jest.fn(),
});

let nextKey = 0;
const makeKey = () => `android-test-${nextKey++}`;

describe('makeVideoFrame on Android', () => {
  it('releases the fences of a copy once it is submitted', () => {
    const { context, device, memories, readyFences } = makeContext();
    const frame = makeFrame(1n, 1);

    makeVideoFrame(context, makeKey(), frame);

    const memory = memories[0]!;
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    // The copy waits for the frame's ready fence.
    expect(memory.beginAccess).toHaveBeenCalledWith(memory.texture, true, [
      { fence: readyFences[0], signaledValue: 1n },
    ]);
    expect(readyFences[0]!.destroy).toHaveBeenCalledTimes(1);
    // The fence signaled once the copy is done goes back to the decoder.
    expect(memory.releaseFence.destroy).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledWith([RELEASE_FENCE]);
  });

  it('releases a buffer evicted from the buffers imported for a key', () => {
    const { context, memories } = makeContext();
    const key = makeKey();

    for (let id = 1; id <= 5; id++) {
      makeVideoFrame(context, key, makeFrame(BigInt(id), id));
    }

    expect(memories).toHaveLength(5);
    expect(memories[0]!.texture.destroy).toHaveBeenCalledTimes(1);
    expect(memories[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(memories[1]!.destroy).not.toHaveBeenCalled();
  });
});

describe('releaseFrameImages on Android', () => {
  it('releases the buffers imported for the key, after their textures', () => {
    const { context, device, memories } = makeContext();
    const key = makeKey();

    makeVideoFrame(context, key, makeFrame(1n, 1));
    makeVideoFrame(context, key, makeFrame(2n, 2));
    releaseFrameImages(key);

    expect(memories).toHaveLength(2);
    for (const memory of memories) {
      expect(memory.texture.destroy).toHaveBeenCalledTimes(1);
      expect(memory.destroy).toHaveBeenCalledTimes(1);
      expect(memory.texture.destroy.mock.invocationCallOrder[0]).toBeLessThan(
        memory.destroy.mock.invocationCallOrder[0]!
      );
    }
    // A submission after the release, for Dawn to free the buffers now.
    expect(device.queue.submit).toHaveBeenLastCalledWith([]);
    expect(device.queue.submit.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      memories[1]!.destroy.mock.invocationCallOrder[0]!
    );
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  });
});

describe('makeVideoFrames on Android', () => {
  it('releases the textures of the items without a frame', () => {
    const { context, device, memories } = makeContext();
    const key = makeKey();

    const first = makeVideoFrames(context, key, {
      a: makeFrame(1n, 1),
      b: makeFrame(2n, 2),
    });
    const textureA = first.a!.texture as unknown as { destroy: jest.Mock };
    const textureB = first.b!.texture as unknown as { destroy: jest.Mock };
    // The item `a` is no longer live.
    const second = makeVideoFrames(context, key, { b: makeFrame(3n, 3) });

    expect(textureA.destroy).toHaveBeenCalledTimes(1);
    expect(memories[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textureB.destroy).not.toHaveBeenCalled();
    expect(memories[1]!.destroy).not.toHaveBeenCalled();
    expect(second.b!.texture).toBe(textureB);
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);

    // Back to life: a texture of its own again.
    const third = makeVideoFrames(context, key, {
      a: makeFrame(1n, 4),
      b: makeFrame(3n, 3),
    });
    expect(third.a!.texture).not.toBe(textureA);
  });
});
