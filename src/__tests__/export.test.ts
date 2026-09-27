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
  const canvas = {
    id,
    drawColor: jest.fn(),
    readPixels: jest.fn(() => new Uint8Array(4)),
  };
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
  ColorType: { RGBA_8888: 4 },
  AlphaType: { Premul: 1 },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockSurfaceCount = 0;
  const cache = globalThis as Record<string, unknown>;
  delete cache.__rnskvExportSurface;
  delete cache.__rnskvExportSurfaceWidth;
  delete cache.__rnskvExportSurfaceHeight;
});

describe('exportVideoComposition', () => {
  it('encodes every frame from the offscreen surface and tears down', async () => {
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

    // Each frame is decoded at its time, drawn, flushed, then the GPU is
    // waited for — a 1×1 readback, the one synchronous wait Skia exposes to
    // JS — before the encoder reads the texture from its own command queue.
    expect(extractor.decodeCompositionFrames).toHaveBeenCalledTimes(4);
    expect(extractor.decodeCompositionFrames).toHaveBeenNthCalledWith(3, 0.5);
    expect(drawFrame).toHaveBeenCalledTimes(4);
    expect(drawFrame).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ currentTime: 0.5, width: 640, height: 360 })
    );
    const surface = makeOffscreen.mock.results[0]?.value as Surface;
    const canvas = surface.getCanvas.mock.results[0]?.value as ReturnType<
      Surface['getCanvas']
    >;
    expect(surface.flush).toHaveBeenCalledTimes(4);
    expect(surface.flush).toHaveBeenCalledWith();
    expect(canvas.readPixels).toHaveBeenCalledTimes(4);
    expect(canvas.readPixels).toHaveBeenCalledWith(
      0,
      0,
      expect.objectContaining({ width: 1, height: 1 })
    );
    // The wait sits between the draw and the encode of the same frame.
    for (let i = 0; i < 4; i++) {
      const drawn = drawFrame.mock.invocationCallOrder[i]!;
      const waited = canvas.readPixels.mock.invocationCallOrder[i]!;
      const encoded = encoder.encodeFrame.mock.invocationCallOrder[i]!;
      expect(drawn).toBeLessThan(waited);
      expect(waited).toBeLessThan(encoded);
    }

    expect(encoder.finishWriting).toHaveBeenCalledTimes(1);
    expect(extractor.dispose).toHaveBeenCalledTimes(1);
    expect(encoder.dispose).toHaveBeenCalledTimes(1);
    // The native encoder receives the export options with the audio
    // defaults filled in, and the composition for its audio tracks.
    expect(createVideoEncoder.mock.calls[0]?.[0]).toMatchObject({
      outPath: '/tmp/out.mp4',
      width: 640,
      height: 360,
      frameRate: 4,
      bitRate: 1_000_000,
      audioBitRate: 128000,
      audioSampleRate: 44100,
      audioChannelCount: 2,
    });
    expect(createVideoEncoder.mock.calls[0]?.[1]).toBe(composition);
  });

  it('forwards encoderMode to the native encoder, and nothing by default', async () => {
    await runExport();
    expect(createVideoEncoder.mock.calls[0]?.[0].encoderMode).toBeUndefined();

    await runExport({ encoderMode: 'direct' });
    expect(createVideoEncoder.mock.calls[1]?.[0]).toMatchObject({
      encoderMode: 'direct',
    });

    await runExport({ encoderMode: 'copy' });
    expect(createVideoEncoder.mock.calls[2]?.[0]).toMatchObject({
      encoderMode: 'copy',
    });
  });

  it('reuses the surface across exports and rebuilds it when the size changes', async () => {
    await runExport();
    await runExport();
    expect(makeOffscreen).toHaveBeenCalledTimes(1);
    const firstSurface = makeOffscreen.mock.results[0]?.value as Surface;

    await runExport({ width: 320, height: 180 });
    expect(firstSurface.dispose).toHaveBeenCalledTimes(1);
    expect(makeOffscreen).toHaveBeenCalledTimes(2);
    expect(makeOffscreen).toHaveBeenLastCalledWith(320, 180);
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

  it('encodes and reports a whole number of frames for a summed duration', async () => {
    for (const duration of [1 - 1e-12, 1 + 1e-12]) {
      jest.clearAllMocks();
      const onProgress = jest.fn();
      const { encoder } = await runExport({
        videoComposition: { ...composition, duration },
        onProgress,
      });
      expect(encoder.encodeFrame).toHaveBeenCalledTimes(4);
      expect(onProgress).toHaveBeenLastCalledWith({
        framesCompleted: 4,
        nbFrames: 4,
      });
    }
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
