import { act } from 'react';
import { PixelRatio } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { Skia } from '@shopify/react-native-skia';
import RNSkiaVideoModule from '../RNSkiaVideoModule';
import { useVideoPlayer } from '../videoPlayer';
import { useVideoCompositionPlayer } from '../videoCompositionPlayer';
import type { VideoComposition, VideoFrame } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Mocks. The hooks run their per-frame work inside Reanimated's
// useFrameCallback: the mock records the latest callback so tests can drive
// the vsync ticks by hand.
// ---------------------------------------------------------------------------

const mockFrame: { callback: (() => void) | null } = { callback: null };

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  return {
    useSharedValue: (initial: unknown) => {
      const ref = ReactModule.useRef(null);
      if (ref.current === null) {
        const mutable: {
          value: unknown;
          modify: (modifier?: (value: unknown) => unknown) => void;
        } = {
          value: initial,
          modify: (modifier) => {
            if (modifier) {
              mutable.value = modifier(mutable.value);
            }
          },
        };
        ref.current = mutable;
      }
      return ref.current;
    },
    useFrameCallback: (callback: () => void) => {
      mockFrame.callback = callback;
      return { setActive: () => {} };
    },
    runOnUI: (fn: (...args: unknown[]) => void) => fn,
  };
});

const mockSurface = {
  getCanvas: jest.fn(() => ({ kind: 'canvas' })),
  flush: jest.fn(),
  getNativeTextureUnstable: jest.fn(() => ({ kind: 'texture' })),
  dispose: jest.fn(),
};

jest.mock('@shopify/react-native-skia', () => ({
  Skia: {
    Surface: { MakeOffscreen: jest.fn(() => mockSurface) },
    Image: {
      MakeImageFromNativeTextureUnstable: jest.fn(
        (
          _texture: unknown,
          _width: number,
          _height: number,
          _mipmapped: boolean,
          output?: unknown
        ) => output ?? { kind: 'image' }
      ),
    },
  },
}));

jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    createVideoPlayer: jest.fn(),
    createVideoCompositionFramesExtractor: jest.fn(),
  },
}));

const createVideoPlayer = RNSkiaVideoModule.createVideoPlayer as jest.Mock;
const createFramesExtractor =
  RNSkiaVideoModule.createVideoCompositionFramesExtractor as jest.Mock;
const makeImage = Skia.Image.MakeImageFromNativeTextureUnstable as jest.Mock;
const makeOffscreen = Skia.Surface.MakeOffscreen as jest.Mock;

const createPlayerMock = () => ({
  isPlaying: false,
  isLooping: false,
  volume: 1,
  playbackSpeed: 1,
  currentTime: 0,
  duration: 10,
  decodeNextFrame: jest.fn<VideoFrame | null, []>(() => null),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  dispose: jest.fn(),
  on: jest.fn(() => () => {}),
});

const createExtractorMock = () => ({
  isPlaying: false,
  isLooping: false,
  currentTime: 0,
  framesVersion: 0,
  decodeCompositionFrames: jest.fn<Record<string, VideoFrame>, []>(() => ({})),
  prepare: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  dispose: jest.fn(),
  on: jest.fn(() => () => {}),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderHook<Props, Result>(
  hook: (props: Props) => Result,
  initialProps: Props
) {
  const result: { current: Result } = {
    current: undefined as unknown as Result,
  };
  function HookHost({ hookProps }: { hookProps: Props }) {
    result.current = hook(hookProps);
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<HookHost hookProps={initialProps} />);
  });
  return {
    result,
    rerender: (props: Props) =>
      act(() => {
        renderer.update(<HookHost hookProps={props} />);
      }),
    unmount: () =>
      act(() => {
        renderer.unmount();
      }),
  };
}

const tick = () =>
  act(() => {
    mockFrame.callback?.();
  });

const composition: VideoComposition = {
  duration: 2,
  items: [
    {
      id: 'clip',
      path: '/videos/clip.mp4',
      compositionStartTime: 0,
      startTime: 0,
      duration: 2,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFrame.callback = null;
});

// ---------------------------------------------------------------------------
// useVideoPlayer
// ---------------------------------------------------------------------------

describe('useVideoPlayer', () => {
  type Options = Parameters<typeof useVideoPlayer>[0];

  const setup = (options: Partial<Options> = {}) => {
    // A fresh native player per creation, as the real module does: the hook
    // tells them apart by identity when it re-creates one.
    createVideoPlayer.mockImplementation(createPlayerMock);
    const rendered = renderHook((props: Options) => useVideoPlayer(props), {
      uri: 'file:///videos/clip.mp4',
      ...options,
    });
    const player = createVideoPlayer.mock.results[0]!.value as ReturnType<
      typeof createPlayerMock
    >;
    return { player, ...rendered };
  };

  it('creates the player in copy texture mode by default', () => {
    setup();
    expect(createVideoPlayer).toHaveBeenCalledTimes(1);
    expect(createVideoPlayer).toHaveBeenCalledWith(
      'file:///videos/clip.mp4',
      undefined,
      undefined
    );
  });

  it('passes textureMode to the native player and re-creates it on change', () => {
    const { player, rerender } = setup({ textureMode: 'direct' });
    expect(createVideoPlayer).toHaveBeenLastCalledWith(
      'file:///videos/clip.mp4',
      undefined,
      { textureMode: 'direct' }
    );

    rerender({ uri: 'file:///videos/clip.mp4', textureMode: 'copy' });
    expect(createVideoPlayer).toHaveBeenCalledTimes(2);
    expect(createVideoPlayer).toHaveBeenLastCalledWith(
      'file:///videos/clip.mp4',
      undefined,
      { textureMode: 'copy' }
    );
    expect(player.dispose).toHaveBeenCalledTimes(1);
  });

  it('polls decodeNextFrame while paused and publishes the frame it returns', () => {
    const { player, result } = setup();
    expect(player.isPlaying).toBe(false);

    tick();
    expect(player.decodeNextFrame).toHaveBeenCalledTimes(1);
    expect(result.current.currentFrame.value).toBeNull();

    // The frame decoded after a seek performed while paused.
    const frame: VideoFrame = {
      texture: { kind: 'texture' },
      width: 1920,
      height: 1080,
      rotation: 0,
    };
    player.decodeNextFrame.mockReturnValueOnce(frame);
    tick();
    expect(result.current.currentFrame.value).toBe(frame);

    // Nothing new: the last frame stays.
    tick();
    expect(player.decodeNextFrame).toHaveBeenCalledTimes(3);
    expect(result.current.currentFrame.value).toBe(frame);
  });

  it('applies looping, volume and playback speed, and auto plays', () => {
    const { player } = setup({
      isLooping: true,
      volume: 0.5,
      playbackSpeed: 2,
      autoPlay: true,
    });
    expect(player.isLooping).toBe(true);
    expect(player.volume).toBe(0.5);
    expect(player.playbackSpeed).toBe(2);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('disposes the player on unmount', () => {
    const { player, unmount } = setup();
    unmount();
    expect(player.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useVideoCompositionPlayer
// ---------------------------------------------------------------------------

describe('useVideoCompositionPlayer', () => {
  type Options = Parameters<typeof useVideoCompositionPlayer>[0];

  const setup = (options: Partial<Options> = {}) => {
    const extractor = createExtractorMock();
    createFramesExtractor.mockReturnValue(extractor);
    const drawFrame = jest.fn();
    const rendered = renderHook(
      (props: Options) => useVideoCompositionPlayer(props),
      { composition, drawFrame, width: 100, height: 50, ...options }
    );
    return { extractor, drawFrame, ...rendered };
  };

  it('prepares the extractor and disposes it on unmount', () => {
    const { extractor, unmount } = setup();
    expect(createFramesExtractor).toHaveBeenCalledWith(composition);
    expect(extractor.prepare).toHaveBeenCalledTimes(1);
    unmount();
    expect(extractor.dispose).toHaveBeenCalledTimes(1);
  });

  it('while paused, draws once then skips until the frames or the time change', () => {
    const { extractor, drawFrame } = setup();

    tick();
    tick();
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(1);
    // The frames are still pulled at every tick: that is how the frame of a
    // seek performed while paused gets noticed.
    expect(extractor.decodeCompositionFrames).toHaveBeenCalledTimes(3);

    extractor.framesVersion = 1;
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(2);
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(2);

    extractor.currentTime = 0.5;
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(3);
  });

  it('redraws at every tick while playing', () => {
    const { extractor, drawFrame } = setup();
    extractor.isPlaying = true;
    tick();
    tick();
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(3);
  });

  it('keeps drawing while paused when drawWhenPaused is set', () => {
    const { drawFrame } = setup({ drawWhenPaused: true });
    tick();
    tick();
    tick();
    expect(drawFrame).toHaveBeenCalledTimes(3);
  });

  it('hands the decoded frames and the time to drawFrame at the surface size', () => {
    const { extractor, drawFrame } = setup();
    const frames: Record<string, VideoFrame> = {
      clip: {
        texture: { kind: 'texture' },
        width: 1280,
        height: 720,
        rotation: 0,
      },
    };
    extractor.decodeCompositionFrames.mockReturnValue(frames);
    extractor.currentTime = 1.25;

    tick();

    const pixelRatio = PixelRatio.get();
    expect(makeOffscreen).toHaveBeenCalledWith(
      100 * pixelRatio,
      50 * pixelRatio
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        frames,
        currentTime: 1.25,
        videoComposition: composition,
        width: 100 * pixelRatio,
        height: 50 * pixelRatio,
      })
    );
  });

  it('creates the surface once and recycles the output image', () => {
    const { extractor, result } = setup();
    extractor.isPlaying = true;

    tick();
    const firstImage = result.current.currentFrame.value;
    expect(firstImage).not.toBeNull();

    tick();
    expect(makeOffscreen).toHaveBeenCalledTimes(1);
    expect(makeImage).toHaveBeenCalledTimes(2);
    // The second wrap is asked to reuse the first image.
    expect(makeImage.mock.calls[1]?.[4]).toBe(firstImage);
    expect(result.current.currentFrame.value).toBe(firstImage);
  });

  it('runs beforeDrawFrame and afterDrawFrame around each draw', () => {
    const context = { kind: 'context' };
    const beforeDrawFrame = jest.fn(() => context);
    const afterDrawFrame = jest.fn();
    const { drawFrame } = setup({
      beforeDrawFrame,
      afterDrawFrame,
    } as unknown as Partial<Options>);

    tick();

    expect(beforeDrawFrame).toHaveBeenCalledTimes(1);
    expect(drawFrame).toHaveBeenCalledWith(
      expect.objectContaining({ context })
    );
    expect(afterDrawFrame).toHaveBeenCalledWith(context);
  });
});
