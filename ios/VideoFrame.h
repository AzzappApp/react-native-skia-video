//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  VideoFrame(CVPixelBufferRef pixelBuffer, double width, double height,
             int rotation);
  ~VideoFrame();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void release();

private:
  std::atomic_flag released = false;
  CVPixelBufferRef pixelBuffer;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
