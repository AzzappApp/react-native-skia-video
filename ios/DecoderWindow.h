#pragma once

namespace RNSkiaVideo {

/**
 * When an item's decoder is open, for a composition with lazy decoders: from a
 * little before the item starts to a little after it ends. Without lazy
 * decoders every decoder is open for the life of the player. Same numbers as
 * android/.../DecoderWindow.java.
 */
class DecoderWindow {
public:
  DecoderWindow(bool lazy, bool realTime)
      : lazy(lazy), lead(realTime ? kPreviewLead : kExportLead) {}

  bool isLazy() const { return lazy; }

  bool opens(double start, double end, double position, double duration,
             bool looping) const {
    return !lazy || within(start - lead, end, position, duration, looping);
  }

  /** Wider than opens, so an item is never closed and reopened at one edge. */
  bool keeps(double start, double end, double position, double duration,
             bool looping) const {
    return !lazy || within(start - lead - kMargin, end + kMargin, position,
                           duration, looping);
  }

private:
  // The preview has to open a reader and decode the first frame before the
  // item is on screen; the export waits for it anyway. Chosen, not measured.
  static constexpr double kPreviewLead = 1.5;
  static constexpr double kExportLead = 0.5;
  // Kept a little past both ends, so a scrub across a cut does not reopen it.
  static constexpr double kMargin = 0.5;

  bool lazy;
  double lead;

  static bool within(double from, double to, double position, double duration,
                     bool looping) {
    if (position >= from && position < to) {
      return true;
    }
    // Near the end of a loop, the items at the start come next.
    double wrapped = position - duration;
    return looping && wrapped >= from && wrapped < to;
  }
};

} // namespace RNSkiaVideo
