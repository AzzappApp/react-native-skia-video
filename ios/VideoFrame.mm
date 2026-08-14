//
//  VideoFrame.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#import "VideoFrame.h"
#import "MTLTextureUtils.h"
#import <IOSurface/IOSurfaceRef.h>

namespace RNSkiaVideo {

VideoFrame::VideoFrame(CVPixelBufferRef pixelBuffer, double width,
                       double height, int rotation) {
  this->pixelBuffer = CVPixelBufferRetain(pixelBuffer);
  this->cvMetalTexture =
      [MTLTextureUtils createTextureViewForPixelBuffer:pixelBuffer];
  this->mtlTexture =
      cvMetalTexture ? CVMetalTextureGetTexture(cvMetalTexture) : nil;
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

VideoFrame::~VideoFrame() {
  releaseBuffer();
}

void VideoFrame::releaseTextureLocked() {
  mtlTexture = nil;
  if (cvMetalTexture) {
    CFRelease(cvMetalTexture);
    cvMetalTexture = NULL;
  }
}

void VideoFrame::releaseBufferLocked() {
  releaseTextureLocked();
  if (pixelBuffer) {
    CVPixelBufferRelease(pixelBuffer);
    pixelBuffer = NULL;
  }
}

void VideoFrame::releaseTexture() {
  std::lock_guard<std::mutex> guard(mutex);
  releaseTextureLocked();
}

bool VideoFrame::tryReleaseBuffer() {
  std::lock_guard<std::mutex> guard(mutex);
  // Our own texture view must go first: it pins the surface's use count.
  releaseTextureLocked();
  if (!pixelBuffer) {
    return true;
  }
  IOSurfaceRef surface = CVPixelBufferGetIOSurface(pixelBuffer);
  if (surface && IOSurfaceIsInUse(surface)) {
    // The GPU (or another consumer) still reads the surface: keep our
    // retain so the pool cannot recycle it under pending sampling work.
    return false;
  }
  CVPixelBufferRelease(pixelBuffer);
  pixelBuffer = NULL;
  return true;
}

void VideoFrame::releaseBuffer() {
  std::lock_guard<std::mutex> guard(mutex);
  releaseBufferLocked();
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
    std::lock_guard<std::mutex> guard(mutex);
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
