import { exportVideoComposition } from '../exportVideoComposition';
import type { FrameDrawer } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('react-native-skia', () => ({
  BlendMode: { Clear: 0 },
  Skia: {
    Color: jest.fn(() => 0),
    Surface: {
      MakeFromGPUTexture: jest.fn(() => ({
        getCanvas: () => ({ drawColor: jest.fn() }),
        flush: jest.fn(),
        dispose: jest.fn(),
      })),
    },
  },
}));

jest.mock('react-native-webgpu', () => ({
  GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1 },
}));

// What happened, in order: the native resources released and the promise
// settled (see scheduleOnRN).
const events: string[] = [];

// The export runtime runs its job when the test says so, later than the call
// that queued it, as a worklet runtime does.
const queuedJobs: (() => void)[] = [];
const runExportRuntime = () => queuedJobs.splice(0).forEach((job) => job());

jest.mock('react-native-worklets', () => ({
  createWorkletRuntime: jest.fn(() => ({})),
  runOnRuntime: (_runtime: unknown, job: () => void) => () =>
    queuedJobs.push(job),
  // Only the settlement of the export goes through it here (no onProgress).
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    events.push('settle');
    fn(...args);
  },
  createSynchronizable: (initial: boolean) => {
    let value = initial;
    return {
      getDirty: () => value,
      setBlocking: (next: boolean) => {
        value = next;
      },
    };
  },
}));

const mockEncoder = () => ({
  nativeWindow: 1n,
  prepare: jest.fn(),
  beginFrame: jest.fn(),
  endFrame: jest.fn(),
  finishWriting: jest.fn(),
  dispose: jest.fn(() => events.push('encoder.dispose')),
});
let encoder: ReturnType<typeof mockEncoder>;
const mockExtractor = () => ({
  start: jest.fn(),
  decodeCompositionFrames: jest.fn(() => ({})),
  dispose: jest.fn(() => events.push('extractor.dispose')),
});

jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    createVideoEncoder: jest.fn(() => (encoder = mockEncoder())),
    createVideoCompositionFramesExtractorSync: jest.fn(() => mockExtractor()),
  },
}));

jest.mock('../benchmarkStats', () => ({
  areBenchmarkStatsEnabled: () => false,
}));

jest.mock('../frameImages', () => ({
  createFrameImagesKey: () => 'export-test',
  getFrameImageContext: () => ({
    device: {},
    webgpu: {
      MakeWebGPUCanvasContextFromNativeWindow: () => ({
        configure: jest.fn(),
        getCurrentTexture: jest.fn(() => ({})),
        present: jest.fn(),
        unconfigure: jest.fn(),
      }),
    },
  }),
  makeVideoFrames: jest.fn(() => ({})),
  releaseFrameImages: jest.fn(),
}));

// 3 frames.
const startExport = (drawFrame: FrameDrawer, abortSignal?: AbortSignal) => {
  const promise = exportVideoComposition({
    videoComposition: { duration: 1, items: [] },
    drawFrame,
    abortSignal,
    outPath: '/tmp/out.mp4',
    width: 1080,
    height: 1920,
    frameRate: 3,
    bitRate: 1_000_000,
  });
  // Whether the promise has settled, read without awaiting it.
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true)
  );
  return { promise, state };
};

// The native resources are released before the promise settles.
const expectReleasedBeforeSettling = () => {
  expect(events).toEqual(['extractor.dispose', 'encoder.dispose', 'settle']);
};

beforeEach(() => {
  events.length = 0;
  queuedJobs.length = 0;
});

describe('exportVideoComposition', () => {
  it('resolves once the encoder is released', async () => {
    const { promise } = startExport(() => {});
    runExportRuntime();

    await expect(promise).resolves.toBeUndefined();
    expect(encoder.endFrame).toHaveBeenCalledTimes(3);
    expect(encoder.finishWriting).toHaveBeenCalledTimes(1);
    expectReleasedBeforeSettling();
  });

  it('rejects an abort only once the export has released its resources', async () => {
    const controller = new AbortController();
    const { promise, state } = startExport(() => {}, controller.signal);
    controller.abort();

    // Not before the export runtime has stopped the export.
    await Promise.resolve();
    expect(state.settled).toBe(false);

    runExportRuntime();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(encoder.endFrame).not.toHaveBeenCalled();
    expect(encoder.finishWriting).not.toHaveBeenCalled();
    expectReleasedBeforeSettling();
  });

  it('stops at the next frame when aborted during a frame', async () => {
    const controller = new AbortController();
    const { promise } = startExport(({ currentTime }) => {
      if (currentTime > 0) {
        controller.abort();
      }
    }, controller.signal);
    runExportRuntime();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(encoder.endFrame).toHaveBeenCalledTimes(2);
    expect(encoder.finishWriting).not.toHaveBeenCalled();
    expectReleasedBeforeSettling();
  });

  it('rejects an abort that comes with the last frame', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled by the user');
    const { promise } = startExport(({ currentTime }) => {
      if (currentTime >= 2 / 3) {
        controller.abort(reason);
      }
    }, controller.signal);
    runExportRuntime();

    await expect(promise).rejects.toBe(reason);
    expectReleasedBeforeSettling();
  });

  it('rejects a drawing error once the encoder is released', async () => {
    const error = new Error('drawFrame failed');
    const { promise } = startExport(() => {
      throw error;
    });
    runExportRuntime();

    await expect(promise).rejects.toBe(error);
    expect(encoder.finishWriting).not.toHaveBeenCalled();
    expectReleasedBeforeSettling();
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { promise } = startExport(() => {}, controller.signal);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(queuedJobs).toHaveLength(0);
  });
});
