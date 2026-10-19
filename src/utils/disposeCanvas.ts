import type { SkCanvas } from 'react-native-skia';

/**
 * Releases a canvas made by `surface.getCanvas()` now: the canvas keeps its
 * surface, and the surface's texture, alive until it is disposed or the
 * runtime collects it, whatever `surface.dispose()`. Canvases only have
 * `dispose()` in the React Native Skia versions after 3.7.0
 * (wcandillon/react-native-skia#4275): a no-op before.
 */
const disposeCanvas = (canvas: SkCanvas | null | undefined) => {
  'worklet';
  (canvas as { dispose?: () => void } | null | undefined)?.dispose?.();
};

export default disposeCanvas;
