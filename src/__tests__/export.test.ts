import { Skia } from '@shopify/react-native-skia';
import RNSkiaVideoModule from '../RNSkiaVideoModule';
import { exportVideoComposition } from '../exportVideoComposition';
import type { VideoComposition } from '../types';

// ---------------------------------------------------------------------------
// Mocks. The export runs on a worklet runtime; the mock runs it inline so the
// whole loop executes synchronously inside the returned promise.
// ---------------------------------------------------------------------------

jest.mock('react-native-worklets', () => ({
  createWorkletRuntime: jest.fn(() => ({ name: 'RNSkiaVideoExportRuntime' })),
  runOnRuntime: jest.fn((_runtime: unknown, fn: () => void) => fn),
  scheduleOnRN: jest.fn(
    (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args)
  ),
  createSynchronizable: jest.fn((initial: boolean) => {
    let value = initial;
    return {
      getDirty: () => value,
      setBlocking: (next: boolean) => {
        value = next;
      },
    };
  }),
}));

let mockSurfaceCount = 0;
const mockMakeSurface = () => {
  const id = mockSurfaceCount++;
  const canvas = { id, drawColor: jest.fn() };
  return {
    id,
    getCanvas: jest.fn(() => canvas),
    flush: jest.fn(),
    getNativeTextureUnstable: jest.fn(() => ({ surface: id })),
    dispose: jest.fn(),
  };
};

jest.mock('@shopify/react-native-skia', () => ({
  Skia: {
    Surface: { MakeOffscreen: jest.fn(() => mockMakeSurface()) },
    Color: jest.fn(() => 0),
  },
  BlendMode: { Clear: 0 },
}));

jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    createVideoEncoder: jest.fn(),
    createVideoCompositionFramesExtractorSync: jest.fn(),
  },
}));

const makeOffscreen = Skia.Surface.MakeOffscreen as jest.Mock;
const createVideoEncoder = RNSkiaVideoModule.createVideoEncoder as jest.Mock;
const createExtractor =
  RNSkiaVideoModule.createVideoCompositionFramesExtractorSync as jest.Mock;

type Surface = ReturnType<typeof mockMakeSurface>;

const createEncoderMock = () => ({
  prepare: jest.fn(),
  encodeFrame: jest.fn(),
  finishWriting: jest.fn(),
  dispose: jest.fn(),
});

const createExtractorMock = () => ({
  start: jest.fn(),
  decodeCompositionFrames: jest.fn(() => ({})),
  dispose: jest.fn(),
});

const composition: VideoComposition = {
  duration: 1,
  items: [
    {
      id: 'clip',
      path: '/videos/clip.mp4',
      compositionStartTime: 0,
      startTime: 0,
      duration: 1,
    },
  ],
};

const baseOptions = {
  videoComposition: composition,
  outPath: '/tmp/out.mp4',
  width: 640,
  height: 360,
  frameRate: 4,
  bitRate: 1_000_000,
};

const runExport = async (
  options: Partial<Parameters<typeof exportVideoComposition>[0]> = {}
) => {
  const encoder = createEncoderMock();
  const extractor = createExtractorMock();
  createVideoEncoder.mockReturnValue(encoder);
  createExtractor.mockReturnValue(extractor);
  const drawFrame = jest.fn();
  await exportVideoComposition({ ...baseOptions, drawFrame, ...options });
  return { encoder, extractor, drawFrame };
};

const surfaceOf = (texture: { surface: number }) =>
  makeOffscreen.mock.results.find(
    (result) => (result.value as Surface).id === texture.surface
  )?.value as Surface;

beforeEach(() => {
  jest.clearAllMocks();
  mockSurfaceCount = 0;
  const cache = globalThis as Record<string, unknown>;
  delete cache.__rnskvExportSurfaces;
  delete cache.__rnskvExportSurfaceWidth;
  delete cache.__rnskvExportSurfaceHeight;
});

describe('exportVideoComposition', () => {
  it('encodes every frame from one surface in copy mode and tears down', async () => {
    const { encoder, extractor, drawFrame } = await runExport();

    expect(makeOffscreen).toHaveBeenCalledTimes(1);
    expect(makeOffscreen).toHaveBeenCalledWith(640, 360);
    expect(encoder.prepare).toHaveBeenCalledTimes(1);
    expect(extractor.start).toHaveBeenCalledTimes(1);

    expect(encoder.encodeFrame).toHaveBeenCalledTimes(4);
    const times = encoder.encodeFrame.mock.calls.map((call) => call[1]);
    expect(times).toEqual([0, 0.25, 0.5, 0.75]);
    const textures = encoder.encodeFrame.mock.calls.map((call) => call[0]);
    expect(new Set(textures.map((texture) => texture.surface)).size).toBe(1);

    // Each frame is decoded at its time, drawn, then flushed synchronously
    // before the encoder reads the texture.
    expect(extractor.decodeCompositionFrames).toHaveBeenCalledTimes(4);
    expect(extractor.decodeCompositionFrames).toHaveBeenNthCalledWith(3, 0.5);
    expect(drawFrame).toHaveBeenCalledTimes(4);
    expect(drawFrame).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ currentTime: 0.5, width: 640, height: 360 })
    );
    expect(surfaceOf(textures[0]).flush).toHaveBeenCalledWith(true);

    expect(encoder.finishWriting).toHaveBeenCalledTimes(1);
    expect(extractor.dispose).toHaveBeenCalledTimes(1);
    expect(encoder.dispose).toHaveBeenCalledTimes(1);
    // The native encoder receives the export options, without an encoder
    // mode when none was asked.
    expect(createVideoEncoder.mock.calls[0]?.[0]).toMatchObject({
      outPath: '/tmp/out.mp4',
      width: 640,
      height: 360,
      frameRate: 4,
      bitRate: 1_000_000,
      audioBitRate: 128000,
    });
    expect(createVideoEncoder.mock.calls[0]?.[0].encoderMode).toBeUndefined();
    expect(createVideoEncoder.mock.calls[0]?.[1]).toBe(composition);
  });

  it('alternates between two surfaces in direct encoder mode', async () => {
    const { encoder, drawFrame } = await runExport({ encoderMode: 'direct' });

    expect(makeOffscreen).toHaveBeenCalledTimes(2);
    expect(createVideoEncoder.mock.calls[0]?.[0]).toMatchObject({
      encoderMode: 'direct',
    });

    const textures = encoder.encodeFrame.mock.calls.map((call) => call[0]);
    expect(textures.map((texture) => texture.surface)).toEqual([0, 1, 0, 1]);
    // drawFrame draws on the canvas of the surface being encoded.
    const canvases = drawFrame.mock.calls.map((call) => call[0].canvas.id);
    expect(canvases).toEqual([0, 1, 0, 1]);
    // Every frame is still flushed synchronously before its texture is read.
    expect(surfaceOf(textures[0]).flush).toHaveBeenCalledTimes(2);
    expect(surfaceOf(textures[1]).flush).toHaveBeenCalledTimes(2);
  });

  it('reuses the surfaces across exports and rebuilds them when the mode changes', async () => {
    await runExport();
    await runExport();
    expect(makeOffscreen).toHaveBeenCalledTimes(1);
    const copySurface = makeOffscreen.mock.results[0]?.value as Surface;

    await runExport({ encoderMode: 'direct' });
    expect(copySurface.dispose).toHaveBeenCalledTimes(1);
    expect(makeOffscreen).toHaveBeenCalledTimes(3);

    await runExport({ encoderMode: 'direct' });
    expect(makeOffscreen).toHaveBeenCalledTimes(3);
  });

  it('reports progress after each frame', async () => {
    const onProgress = jest.fn();
    await runExport({ onProgress });
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith({
      framesCompleted: 4,
      nbFrames: 4,
    });
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runExport({ abortSignal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createVideoEncoder).not.toHaveBeenCalled();
  });
});
