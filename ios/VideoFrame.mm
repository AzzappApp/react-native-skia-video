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

void VideoFrameRing::push(const std::shared_ptr<VideoFrame>& frame) {
  std::lock_guard<std::mutex> guard(mutex);
  issuedFrames.push_back(frame);
  bool retired = false;
  while (issuedFrames.size() > depth) {
    issuedFrames.front()->releaseTexture();
    retiredFrames.push_back(issuedFrames.front());
    issuedFrames.pop_front();
    retired = true;
  }
  if (!retired && retiredFrames.empty()) {
    return;
  }
  // Let go of the cache's own references to the textures we just dropped:
  // while it holds them the surfaces stay alive whatever we do here, so
  // their pool could never recycle them. Textures of frames still in the
  // ring are retained by those frames and survive the flush.
  [MTLTextureUtils flushTextureCache];
  for (auto it = retiredFrames.begin(); it != retiredFrames.end();) {
    if ((*it)->tryReleaseBuffer()) {
      it = retiredFrames.erase(it);
    } else {
      ++it;
    }
  }
  while (retiredFrames.size() > kRetiredFramesHardCap) {
    retiredFrames.front()->releaseBuffer();
    retiredFrames.pop_front();
  }
}

void VideoFrameRing::releaseAll() {
  std::lock_guard<std::mutex> guard(mutex);
  for (const auto& frame : issuedFrames) {
    frame->releaseBuffer();
  }
  issuedFrames.clear();
  for (const auto& frame : retiredFrames) {
    frame->releaseBuffer();
  }
  retiredFrames.clear();
  [MTLTextureUtils flushTextureCache];
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
