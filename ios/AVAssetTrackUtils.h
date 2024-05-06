#pragma once

namespace RNSkiaVideo {
#define RADIANS_TO_DEGREES(radians) ((radians) * (180.0 / M_PI))
float radiansToDegrees(CGFloat radians) {
  // Input range [-pi, pi] or [-180, 180]
  CGFloat degrees = RADIANS_TO_DEGREES((float)radians);
  if (degrees < 0) {
    // Convert -90 to 270 and -180 to 180
    return degrees + 360;
  }
  // Output degrees in between [0, 360]
  return degrees;
};

int GetTrackRotationInDegree(AVAssetTrack* track) {
  CGAffineTransform t = track.preferredTransform;
  return round(radiansToDegrees(atan2(t.b, t.a)));
}

} // namespace RNSkiaVideo
