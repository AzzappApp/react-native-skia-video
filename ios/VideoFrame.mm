//
//  VideoFrame.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#import "VideoFrame.h"

namespace RNSkiaVideo {

VideoFrame::VideoFrame(CVPixelBufferRef pixelBuffer, int rotation) {
  this->pixelBuffer = CVPixelBufferRetain(pixelBuffer);
  this->width = CVPixelBufferGetWidth(pixelBuffer);
  this->height = CVPixelBufferGetHeight(pixelBuffer);
  this->rotation = rotation;
}

VideoFrame::~VideoFrame() {
  CVPixelBufferRelease(pixelBuffer);
}

std::vector<jsi::PropNameID> VideoFrame::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("handle")));
  return result;
}

jsi::Value VideoFrame::get(jsi::Runtime& runtime,
                           const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "width") {
    return jsi::Value(width);
  } else if (propName == "height") {
    return jsi::Value(height);
  } else if (propName == "rotation") {
    return jsi::Value(rotation);
  } else if (propName == "handle") {
    // The IOSurface stays alive as long as this frame retains the pixel
    // buffer.
    IOSurfaceRef surface = CVPixelBufferGetIOSurface(pixelBuffer);
    if (surface) {
      return jsi::BigInt::fromUint64(runtime,
                                     reinterpret_cast<uintptr_t>(surface));
    }
  }

  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
