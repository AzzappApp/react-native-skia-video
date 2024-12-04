//
//  VideoFrame.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#import "VideoFrame.h"

namespace RNSkiaVideo {

VideoFrame::VideoFrame(id<MTLTexture> mtlTexture, double width, double height,
                       int rotation) {
  CFRetain((CFTypeRef)mtlTexture);
  this->mtlTexture = mtlTexture;
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

VideoFrame::~VideoFrame() {
  release();
}

std::vector<jsi::PropNameID> VideoFrame::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("buffer")));
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
  } else if (propName == "texture") {
    if (mtlTexture) {
      return jsi::BigInt::fromUint64(runtime,
                                     reinterpret_cast<uintptr_t>(mtlTexture));
    }
  }

  return jsi::Value::undefined();
}

void VideoFrame::release() {
  if (released.test_and_set()) {
    return;
  }
  if (mtlTexture) {
    CFRelease((CFTypeRef)mtlTexture);
  }
}

} // namespace RNSkiaVideo
