import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useVideoCompositionPlayer } from '../videoCompositionPlayer';
import type { FrameDrawer, VideoComposition } from '../types';

// The frame callback the hook registered, run by the test as vsyncs would.
let mockFrameCallback: (() => void) | null = null;

jest.mock('react-native-reanimated', () => {
  const { useState } = require('react');
  return {
    useSharedValue: (initial: unknown) =>
      useState(() => {
        const holder = { value: initial };
        return {
          get value() {
            return holder.value;
          },
          set value(value) {
            holder.value = value;
          },
          get: () => holder.value,
          set: (value: unknown) => {
            holder.value = value;
          },
          modify: () => {},
        };
      })[0],
    useFrameCallback: (callback: () => void) => {
      mockFrameCallback = callback;
    },
    runOnUI:
      (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) =>
        fn(...args),
  };
});

jest.mock('react-native-skia', () => ({
  Skia: {
    Surface: {
      MakeOffscreen: () => ({
        getCanvas: () => ({ save: () => 1, restoreToCount: () => {} }),
        flush: () => {},
        asImage: () => ({ dispose: () => {} }),
        dispose: () => {},
      }),
    },
  },
  useGpu: () => ({}),
}));

jest.mock('../utils/skiaDeviceId', () => () => 'device');

// Each decoded frame stands for its own image (see makeVideoFrames).
jest.mock('../frameImages', () => ({
  createFrameImagesKey: () => 'key',
  getFrameImageContext: () => ({}),
  makeVideoFrames: (
    _context: unknown,
    _key: string,
    frames: Record<string, unknown>
  ) =>
    Object.fromEntries(
      Object.entries(frames).map(([id, image]) => [id, { image }])
    ),
  releaseFrameImages: () => {},
}));

const extractor = {
  isPlaying: false,
  isLooping: false,
  currentTime: 0,
  frames: {} as Record<string, unknown>,
  prepare: () => {},
  play: () => {},
  pause: () => {},
  seekTo: () => {},
  dispose: () => {},
  on: () => () => {},
  decodeCompositionFrames: () => extractor.frames,
};

jest.mock('../RNSkiaVideoModule', () => ({
  createVideoCompositionFramesExtractor: () => extractor,
}));

const composition: VideoComposition = {
  duration: 5,
  items: [
    {
      id: 'video',
      path: '/video.mp4',
      compositionStartTime: 0,
      startTime: 0,
      duration: 5,
    },
  ],
};

let redraw: () => void = () => {};
const setRedraw = (value: () => void) => {
  redraw = value;
};

const Player = ({
  drawFrame,
  drawMode,
}: {
  drawFrame: FrameDrawer;
  drawMode?: 'continuous' | 'onDemand';
}) => {
  const player = useVideoCompositionPlayer({
    composition,
    drawFrame,
    width: 100,
    height: 100,
    drawMode,
  });
  useEffect(() => setRedraw(player.redraw), [player.redraw]);
  return null;
};

const runFrame = () =>
  act(() => {
    mockFrameCallback?.();
  });

const render = async (element: React.ReactElement) => {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(element);
  });
  return renderer!;
};

describe('useVideoCompositionPlayer', () => {
  let drawFrame: jest.Mock;

  beforeEach(() => {
    drawFrame = jest.fn();
    extractor.isPlaying = false;
    extractor.frames = { video: 'frame 1' };
  });

  it('draws every frame by default, even paused', async () => {
    await render(<Player drawFrame={drawFrame} />);

    runFrame();
    runFrame();

    expect(drawFrame).toHaveBeenCalledTimes(2);
  });

  describe("drawMode 'onDemand'", () => {
    it('draws a paused composition once, then again for a new frame only', async () => {
      await render(<Player drawFrame={drawFrame} drawMode="onDemand" />);

      runFrame();
      runFrame();
      expect(drawFrame).toHaveBeenCalledTimes(1);

      // the decoder delivered the frame of a seek
      extractor.frames = { video: 'frame 2' };
      runFrame();
      runFrame();
      expect(drawFrame).toHaveBeenCalledTimes(2);
    });

    it('draws every frame while playing', async () => {
      await render(<Player drawFrame={drawFrame} drawMode="onDemand" />);
      extractor.isPlaying = true;

      runFrame();
      runFrame();

      expect(drawFrame).toHaveBeenCalledTimes(2);
    });

    it('draws again on redraw(), for a change drawFrame reads', async () => {
      await render(<Player drawFrame={drawFrame} drawMode="onDemand" />);
      runFrame();

      redraw();
      runFrame();
      runFrame();

      expect(drawFrame).toHaveBeenCalledTimes(2);
    });

    it('draws again with a new drawFrame', async () => {
      const renderer = await render(
        <Player drawFrame={drawFrame} drawMode="onDemand" />
      );
      runFrame();

      const next = jest.fn();
      await act(() => {
        renderer.update(<Player drawFrame={next} drawMode="onDemand" />);
      });
      runFrame();
      runFrame();

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
