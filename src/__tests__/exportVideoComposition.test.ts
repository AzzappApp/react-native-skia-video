import { exportVideoComposition } from '../exportVideoComposition';
import RNSkiaVideoModule from '../RNSkiaVideoModule';

const mockRuntimeTasks: Array<() => void> = [];
const mockEvents: string[] = [];
const mockSurface = {
  getCanvas: () => ({ drawColor: jest.fn() }),
  flush: jest.fn(),
  getNativeTextureUnstable: jest.fn(),
};

jest.mock('react-native-worklets', () => ({
  createWorkletRuntime: jest.fn(),
  runOnRuntime: (_runtime: unknown, task: () => void) => () => {
    mockRuntimeTasks.push(task);
  },
  scheduleOnRN: (fn: (...args: any[]) => void, ...args: any[]) => fn(...args),
  createSynchronizable: (initial: boolean) => {
    let value = initial;
    return {
      setBlocking: (next: boolean) => {
        value = next;
      },
      getDirty: () => value,
    };
  },
}));

jest.mock('@shopify/react-native-skia', () => ({
  BlendMode: { Clear: 0 },
  Skia: {
    Surface: { MakeOffscreen: () => mockSurface },
    Color: () => 0,
  },
}));

jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    createVideoEncoder: jest.fn(),
    createVideoCompositionFramesExtractorSync: jest.fn(),
  },
}));

const mockEncoder = {
  prepare: jest.fn(),
  encodeFrame: jest.fn(),
  finishWriting: jest.fn(),
  dispose: jest.fn(() => {
    mockEvents.push('encoder disposed');
  }),
};
const mockExtractor = {
  start: jest.fn(),
  decodeCompositionFrames: jest.fn(() => ({})),
  dispose: jest.fn(() => {
    mockEvents.push('extractor disposed');
  }),
};
const options = {
  videoComposition: { duration: 1, items: [] },
  width: 16,
  height: 16,
  frameRate: 2,
  bitRate: 1000,
  outPath: '/tmp/cancellation-test.mp4',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRuntimeTasks.length = 0;
  mockEvents.length = 0;
  (RNSkiaVideoModule.createVideoEncoder as jest.Mock).mockReturnValue(
    mockEncoder
  );
  (
    RNSkiaVideoModule.createVideoCompositionFramesExtractorSync as jest.Mock
  ).mockReturnValue(mockExtractor);
});

it('keeps cancellation pending until the runtime has disposed its resources', async () => {
  const controller = new AbortController();
  const result = exportVideoComposition({
    ...options,
    drawFrame: jest.fn(),
    abortSignal: controller.signal,
  });
  const settled = jest.fn();
  const observed = result.catch((error: unknown) => {
    settled();
    return error;
  });
  controller.abort();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  mockRuntimeTasks.shift()!();
  const error = await observed;
  expect(error).toMatchObject({ name: 'AbortError' });
  expect(mockEvents).toEqual(['extractor disposed', 'encoder disposed']);
  expect(mockEncoder.finishWriting).not.toHaveBeenCalled();
});

it('cleans up before reporting cancellation during frame drawing', async () => {
  const controller = new AbortController();
  const drawFrame = jest.fn(() => controller.abort());
  const result = exportVideoComposition({
    ...options,
    drawFrame,
    abortSignal: controller.signal,
  });
  const observed = result.catch((error: unknown) => {
    expect(mockEvents).toEqual(['extractor disposed', 'encoder disposed']);
    return error;
  });
  mockRuntimeTasks.shift()!();
  expect(await observed).toMatchObject({ name: 'AbortError' });
  expect(drawFrame).toHaveBeenCalledTimes(1);
});

it('disposes resources before reporting drawing errors', async () => {
  const error = new Error('draw failed');
  const result = exportVideoComposition({
    ...options,
    drawFrame: () => {
      throw error;
    },
  });
  const observed = result.catch((failure: unknown) => {
    expect(mockEvents).toEqual(['extractor disposed', 'encoder disposed']);
    return failure;
  });
  mockRuntimeTasks.shift()!();
  expect(await observed).toBe(error);
});

it('finishes and disposes a successful export', async () => {
  const result = exportVideoComposition({ ...options, drawFrame: jest.fn() });
  mockRuntimeTasks.shift()!();
  await result;
  expect(mockEncoder.encodeFrame).toHaveBeenCalledTimes(2);
  expect(mockEncoder.finishWriting).toHaveBeenCalledTimes(1);
  expect(mockEvents).toEqual(['extractor disposed', 'encoder disposed']);
});

it('does not schedule a runtime task for an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportVideoComposition({
      ...options,
      drawFrame: jest.fn(),
      abortSignal: controller.signal,
    })
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(mockRuntimeTasks).toHaveLength(0);
  expect(RNSkiaVideoModule.createVideoEncoder).not.toHaveBeenCalled();
});

it('preserves cancellation after the final frame and its custom reason', async () => {
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  const drawFrame = jest.fn(() => {
    if (drawFrame.mock.calls.length === 2) {
      Object.defineProperty(controller.signal, 'reason', { value: reason });
      controller.abort();
    }
  });
  const result = exportVideoComposition({
    ...options,
    drawFrame,
    abortSignal: controller.signal,
  });
  const observed = result.catch((error: unknown) => error);
  mockRuntimeTasks.shift()!();
  expect(await observed).toBe(reason);
  expect(mockEvents).toEqual(['extractor disposed', 'encoder disposed']);
});
