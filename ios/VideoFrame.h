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

class VideoFrame {
public:
  VideoFrame(CVPixelBufferRef pixelBuffer, double width, double height,
             int rotation);
  ~VideoFrame();

  jsi::Value toJS(jsi::Runtime& runtime);
  void release();

private:
  std::atomic_flag released = false;
  CVPixelBufferRef pixelBuffer;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
