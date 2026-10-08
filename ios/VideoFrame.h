//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <CoreVideo/CoreVideo.h>
#import <jsi/jsi.h>
#import <memory>
#import <mutex>

namespace RNSkiaVideo {
using namespace facebook;

/**
 * A decoded frame handed to JS. The frame retains the decoder's own pixel
 * buffer (no copy): JS imports it into a texture (React Native WebGPU's
 * copyExternalImageToTexture) and then calls `release()`, which hands the
 * buffer back to the decoder without waiting for the JS wrapper to be garbage
 * collected. Once released, `buffer` is undefined.
 */
class JSI_EXPORT VideoFrame : public jsi::HostObject,
                              public std::enable_shared_from_this<VideoFrame> {
public:
  VideoFrame(CVPixelBufferRef pixelBuffer, double width, double height,
             int rotation);
  ~VideoFrame();

  /**
   * Releases the pixel buffer. Idempotent.
   */
  void release();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  // The frame is read on the runtime that draws it, but its producer can be
  // released from another thread.
  std::mutex mutex;
  CVPixelBufferRef pixelBuffer;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
