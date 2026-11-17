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
  this->pixelBuffer = CVPixelBufferRetain(pixelBuffer);
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

VideoFrame::~VideoFrame() {
  release();
}

void VideoFrame::release() {
  std::lock_guard<std::mutex> guard(mutex);
  if (pixelBuffer) {
    CVPixelBufferRelease(pixelBuffer);
    pixelBuffer = NULL;
  }
}

std::vector<jsi::PropNameID> VideoFrame::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("buffer")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("release")));
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
  } else if (propName == "buffer") {
    std::lock_guard<std::mutex> guard(mutex);
    if (pixelBuffer) {
      return jsi::BigInt::fromUint64(runtime,
                                     reinterpret_cast<uintptr_t>(pixelBuffer));
    }
  } else if (propName == "release") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "release"), 0,
        [weakFrame = weak_from_this()](
            jsi::Runtime& runtime, const jsi::Value& thisValue,
            const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (auto frame = weakFrame.lock()) {
            frame->release();
          }
          return jsi::Value::undefined();
        });
  }

  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
