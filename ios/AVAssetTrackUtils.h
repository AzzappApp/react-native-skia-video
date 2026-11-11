#pragma once

#import <AVFoundation/AVFoundation.h>

#define RADIANS_TO_DEGREES(radians) ((radians) * (180.0 / M_PI))
namespace RNSkiaVideo {

class AVAssetTrackUtils {
public:
  static float radiansToDegrees(CGFloat radians) {
    // Input range [-pi, pi] or [-180, 180]
    CGFloat degrees = RADIANS_TO_DEGREES((float)radians);
    if (degrees < 0) {
      // Convert -90 to 270 and -180 to 180
      return degrees + 360;
    }
    // Output degrees in between [0, 360]
    return degrees;
  };

  static int GetTrackRotationInDegree(AVAssetTrack* track) {
    CGAffineTransform t = track.preferredTransform;
    return round(radiansToDegrees(atan2(t.b, t.a)));
  }

  // The output settings the players and the compositions decode their frames
  // with.
  //
  // NV12 is the decoder's native output: requesting BGRA would make
  // VideoToolbox convert every frame. The YUV to RGB conversion happens on the
  // GPU when the frame is drawn into a texture (React Native WebGPU's
  // importExternalTexture), which needs IOSurface-backed buffers. The frames
  // are SDR BT.709, HDR video (an iPhone's HLG) tone mapped by VideoToolbox:
  // the GPU conversion applies the BT.709 matrix only (see
  // src/frameImages/gpuConversion.ts).
  //
  // With a `resolution`, the frames are scaled to it: a size in the file's
  // encoded orientation, as the track's naturalSize.
  static NSDictionary* DecodedFrameOutputSettings(CGSize resolution) {
    NSMutableDictionary* settings =
        [NSMutableDictionary dictionaryWithDictionary:@{
          (id)kCVPixelBufferPixelFormatTypeKey :
              @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
          (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
          (id)kCVPixelBufferMetalCompatibilityKey : @YES,
          AVVideoColorPropertiesKey : @{
            AVVideoColorPrimariesKey : AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey : AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey : AVVideoYCbCrMatrix_ITU_R_709_2,
          },
        }];
    if (resolution.width > 0 && resolution.height > 0) {
      settings[(id)kCVPixelBufferWidthKey] = @(resolution.width);
      settings[(id)kCVPixelBufferHeightKey] = @(resolution.height);
    }
    return settings;
  }

  // The size the frames of a track are decoded at for their long side not to
  // exceed `maxLongSide`, keeping their aspect ratio, or CGSizeZero if they
  // already fit.
  //
  // Resolved against the track's naturalSize and nothing else: it is the
  // file's encoded frame, and the output settings are read in that same
  // orientation. A caller capping the size itself would have to pass encoded
  // dimensions, the ones it cannot know, since every API hands it display
  // dimensions (a portrait phone clip is a 1920x1080 file with a 90°
  // transform). Ask it for the long side and there is nothing left to get
  // wrong.
  static CGSize SizeCappedToLongSide(CGSize naturalSize, double maxLongSide) {
    double longSide = MAX(naturalSize.width, naturalSize.height);
    if (maxLongSide <= 0 || longSide <= maxLongSide) {
      return CGSizeZero;
    }
    // Even sizes: the frames are 4:2:0, their chroma planes half the size.
    double scale = maxLongSide / longSide;
    return CGSizeMake(MAX(2, 2 * round(naturalSize.width * scale / 2)),
                      MAX(2, 2 * round(naturalSize.height * scale / 2)));
  }
};
} // namespace RNSkiaVideo
