import RNSkiaVideoModule from './RNSkiaVideoModule';

/**
 * What the library measures for the benchmark of the example app: the memory
 * footprint of the process, and how long each exported frame waits for the
 * decoders. Measured in development builds, or once the app enables it (the
 * benchmark runs in Release builds).
 *
 * Not part of the public API (exported as `__RNSkiaVideoBenchmark`).
 */
let enabled = __DEV__;

/**
 * Measures the benchmark stats in a Release build too. Exports started before
 * are not measured.
 */
export const enableBenchmarkStats = () => {
  enabled = true;
};

/** Whether the benchmark stats are measured. */
export const areBenchmarkStatsEnabled = () => enabled;

/**
 * The memory used by the process in bytes (iOS: physical footprint, Android:
 * total PSS), or null if the stats are not measured or it is unavailable.
 * Slow on Android: not to be called per frame.
 */
export const getMemoryFootprint = (): number | null =>
  enabled ? RNSkiaVideoModule.getMemoryFootprint() : null;
