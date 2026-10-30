import { act, type ReactNode } from 'react';

interface Renderer {
  update(element: ReactNode): void;
  unmount(): void;
}
const TestRenderer = require('react-test-renderer') as {
  create(element: ReactNode): Renderer;
};
import { useFrameCallback } from 'react-native-reanimated';
import { useVideoCompositionPlayer } from '../videoCompositionPlayer';

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    useSharedValue: (initial: unknown) =>
      React.useRef({ value: initial }).current,
    useFrameCallback: jest.fn(),
    runOnUI: (fn: () => void) => fn,
  };
});
jest.mock('@shopify/react-native-skia', () => ({ Skia: {} }));
jest.mock('../RNSkiaVideoModule', () => ({
  __esModule: true,
  default: {
    createVideoCompositionFramesExtractor: () => ({
      prepare: jest.fn(),
      dispose: jest.fn(),
    }),
  },
}));
jest.mock('../utils/useEventListener', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const composition = { duration: 1, items: [] };
const drawFrame = jest.fn();
function Player({
  width = 100,
  draw = drawFrame,
}: {
  width?: number;
  draw?: typeof drawFrame;
}) {
  useVideoCompositionPlayer({
    composition,
    drawFrame: draw,
    width,
    height: 100,
  });
  return null;
}
const lastCallback = () =>
  (useFrameCallback as jest.Mock).mock.calls.at(-1)![0];

it('retains the callback across unrelated renders and updates it when drawing inputs change', async () => {
  let renderer: Renderer;
  await act(() => {
    renderer = TestRenderer.create(<Player />);
  });
  const initial = lastCallback();
  await act(() => {
    renderer.update(<Player />);
  });
  expect(lastCallback()).toBe(initial);

  await act(() => {
    renderer.update(<Player width={200} />);
  });
  const resized = lastCallback();
  expect(resized).not.toBe(initial);

  const newDrawFrame = jest.fn();
  await act(() => {
    renderer.update(<Player width={200} draw={newDrawFrame} />);
  });
  expect(lastCallback()).not.toBe(resized);
  await act(() => {
    renderer.unmount();
  });
});
