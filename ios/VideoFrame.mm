//
//  VideoFrame.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#import "VideoFrame.h"

namespace RNSkiaVideo {

VideoFrame::VideoFrame(CVPixelBufferRef pixelBuffer, double width,
                       double height, int rotation) {
  CVPixelBufferRetain(pixelBuffer);
  this->pixelBuffer = pixelBuffer;
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

VideoFrame::~VideoFrame() {
  release();
}

jsi::Value VideoFrame::toJS(jsi::Runtime& runtime) {
  if (released.test()) {
    return jsi::Value::null();
  }
  auto frame = jsi::Object(runtime);
  frame.setProperty(runtime, "width", jsi::Value(width));
  frame.setProperty(runtime, "height", jsi::Value(height));
  frame.setProperty(runtime, "rotation", jsi::Value(rotation));
  frame.setProperty(runtime, "buffer",
                    jsi::BigInt::fromUint64(
                        runtime, reinterpret_cast<uintptr_t>(pixelBuffer)));
  return frame;
}

void VideoFrame::release() {
  if (released.test_and_set()) {
    return;
  }
  CVPixelBufferRelease(pixelBuffer);
  pixelBuffer = nullptr;
}
} // namespace RNSkiaVideo
