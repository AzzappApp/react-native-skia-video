//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <CoreVideo/CoreVideo.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  // Retains `pixelBuffer` for the lifetime of the frame, so that the pointer
  // handed to JS stays valid even if the decoder that produced it is
  // released.
  VideoFrame(CVPixelBufferRef pixelBuffer, double width, double height,
             int rotation);
  ~VideoFrame();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  CVPixelBufferRef pixelBuffer;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
