import { __RNSkiaVideoPrivateAPI } from '@azzapp/react-native-skia-video';

export type Summary = {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

export const summarize = (values: number[]): Summary | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted[sorted.length - 1]!),
  };
};

/**
 * Frames missed by the display, from the intervals between two UI frames: an
 * interval of n refresh periods means n - 1 missed frames.
 */
export const countDroppedFrames = (intervals: number[]) => {
  const period = summarize(intervals)?.p50;
  if (period == null || period <= 0) {
    return 0;
  }
  return intervals.reduce(
    (dropped, interval) =>
      dropped + Math.max(0, Math.round(interval / period) - 1),
    0
  );
};

/**
 * The memory used by the process in bytes (iOS: physical footprint, as shown
 * by Xcode; Android: total PSS, including graphics memory).
 */
export const readMemoryFootprint = (): number | null =>
  __RNSkiaVideoPrivateAPI.getMemoryFootprint?.() ?? null;

export const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const formatBytes = (bytes: number | null | undefined) => {
  if (bytes == null) {
    return 'n/a';
  }
  const sign = bytes < 0 ? '-' : '';
  return `${sign}${(Math.abs(bytes) / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatSummary = (summary: Summary | null | undefined) =>
  summary == null
    ? 'n/a'
    : `p50 ${summary.p50} · p95 ${summary.p95} · max ${summary.max}`;
