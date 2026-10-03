#pragma once

namespace RNSkiaVideo {

/**
 * How far ahead a seek is served by reading the reader on rather than by
 * building a new one.
 *
 * A drag lands a seek every few frames; measured on a 4K HEVC clip, creating
 * an AVAssetReader costs more than decoding the second of video it skips.
 */
constexpr double kSeekReadOnSeconds = 1.0;

/**
 * Whether a seek to `target` can be served by the reader already running at
 * `last`. Backwards never can: an AVAssetReader only moves forward.
 */
inline bool seekReadsOn(bool readerRunning, bool lastValid, double last,
                        double target) {
  if (!readerRunning || !lastValid) {
    return false;
  }
  double ahead = target - last;
  return ahead >= 0 && ahead <= kSeekReadOnSeconds;
}

} // namespace RNSkiaVideo
