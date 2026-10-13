import { Platform } from 'react-native';

/**
 * Development builds, Android: measures where an export spends the time of
 * its frames on the JS side, and logs a summary every `FRAMES_PER_REPORT`
 * frames (`adb logcat -s ReactNativeJS`), next to the native one
 * (ExportDiagnostics.java).
 */
export const EXPORT_DIAGNOSTICS = __DEV__ && Platform.OS === 'android';

const FRAMES_PER_REPORT = 30;

type Timings = {
  /** The first frame of the report. */
  firstFrame: number;
  frames: number;
  /** The total time of each phase, in milliseconds. */
  phases: Record<string, number>;
};

// Only set on the export runtime, while exporting.
const getTimings = () => {
  'worklet';
  return (globalThis as unknown as { __rnskvExportTimings?: Timings })
    .__rnskvExportTimings;
};

/** Starts measuring the frames of an export, on the export runtime. */
export const startExportTimings = () => {
  'worklet';
  if (!EXPORT_DIAGNOSTICS) {
    return;
  }
  (
    globalThis as unknown as { __rnskvExportTimings?: Timings }
  ).__rnskvExportTimings = { firstFrame: 0, frames: 0, phases: {} };
};

/** Stops measuring the frames of the export. */
export const stopExportTimings = () => {
  'worklet';
  if (!EXPORT_DIAGNOSTICS) {
    return;
  }
  (
    globalThis as unknown as { __rnskvExportTimings?: Timings }
  ).__rnskvExportTimings = undefined;
};

/** @returns the start of a phase, for `endPhase`. */
export const startPhase = (): number => {
  'worklet';
  return EXPORT_DIAGNOSTICS && getTimings() != null ? performance.now() : 0;
};

/** Adds the time since `start` to the phase. */
export const endPhase = (phase: string, start: number) => {
  'worklet';
  if (!EXPORT_DIAGNOSTICS || start === 0) {
    return;
  }
  const timings = getTimings();
  if (timings != null) {
    timings.phases[phase] =
      (timings.phases[phase] ?? 0) + performance.now() - start;
  }
};

/** Counts a frame of the export, and logs the report when it is complete. */
export const endExportFrame = () => {
  'worklet';
  const timings = EXPORT_DIAGNOSTICS ? getTimings() : undefined;
  if (timings == null) {
    return;
  }
  timings.frames++;
  if (timings.frames < FRAMES_PER_REPORT) {
    return;
  }
  const phases = Object.keys(timings.phases)
    .map(
      (phase) =>
        `${phase} ${(timings.phases[phase]! / timings.frames).toFixed(1)}`
    )
    .join(', ');
  console.log(
    `[RNSkiaVideoExport] JS frames ${timings.firstFrame}-` +
      `${timings.firstFrame + timings.frames - 1}, ms/frame: ${phases}`
  );
  timings.firstFrame += timings.frames;
  timings.frames = 0;
  timings.phases = {};
};
