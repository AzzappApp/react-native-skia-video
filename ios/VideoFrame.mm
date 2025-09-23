//
//  VideoFrame.m
//  sheunglaili-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#import "VideoFrame.h"

namespace RNSkiaVideo {

VideoFrame::VideoFrame(id<MTLTexture> mtlTexture, double width, double height,
                       int rotation) {
  this->mtlTexture = mtlTexture;
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

std::vector<jsi::PropNameID> VideoFrame::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("texture")));
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
      auto object = jsi::Object(runtime);
      auto pointer = jsi::BigInt::fromUint64(
          runtime, reinterpret_cast<uintptr_t>(mtlTexture));
      object.setProperty(runtime, "mtlTexture", pointer);
      return object;
    }
  }

  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
