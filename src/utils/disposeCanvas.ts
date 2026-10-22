import type { SkCanvas } from 'react-native-skia';

/**
 * Releases a canvas made by `surface.getCanvas()` now: the canvas keeps its
 * surface, and the surface's texture, alive until it is disposed or the
 * runtime collects it, whatever `surface.dispose()`. Canvases only have
 * `dispose()` once wcandillon/react-native-skia#4275 is released (not in
 * 3.7.2): a no-op until then.
 */
const disposeCanvas = (canvas: SkCanvas | null | undefined) => {
  'worklet';
  (canvas as { dispose?: () => void } | null | undefined)?.dispose?.();
};

export default disposeCanvas;
