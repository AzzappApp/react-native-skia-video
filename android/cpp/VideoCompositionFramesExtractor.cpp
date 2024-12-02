#include "VideoCompositionFramesExtractor.h"

namespace RNSkiaVideo {
using namespace facebook::jni;

local_ref<VideoCompositionFramesExtractor>
VideoCompositionFramesExtractor::create(
    alias_ref<VideoComposition> composition,
    alias_ref<NativeEventDispatcher> dispatcher) {
  return newInstance(composition, dispatcher);
}

void VideoCompositionFramesExtractor::play() const {
  static const auto playMethod = getClass()->getMethod<void()>("play");
  playMethod(self());
}

void VideoCompositionFramesExtractor::pause() const {
  static const auto pauseMethod = getClass()->getMethod<void()>("pause");
  pauseMethod(self());
}

void VideoCompositionFramesExtractor::seekTo(jlong position) const {
  static const auto seekToMethod = getClass()->getMethod<void(jlong)>("seekTo");
  seekToMethod(self(), position);
}

jboolean VideoCompositionFramesExtractor::getIsPlaying() const {
  static const auto getIsPlayingMethod =
      getClass()->getMethod<jboolean()>("getIsPlaying");
  return getIsPlayingMethod(self());
}

jboolean VideoCompositionFramesExtractor::getIsLooping() const {
  static const auto getIsLoopingMethod =
      getClass()->getMethod<jboolean()>("getIsLooping");
  return getIsLoopingMethod(self());
}

void VideoCompositionFramesExtractor::setIsLooping(jboolean isLooping) const {
  static const auto setIsLoopingMethod =
      getClass()->getMethod<void(jboolean)>("setIsLooping");
  setIsLoopingMethod(self(), isLooping);
}

jlong VideoCompositionFramesExtractor::getCurrentPosition() const {
  static const auto getCurrentPositionMethod =
      getClass()->getMethod<jlong()>("getCurrentPosition");
  return getCurrentPositionMethod(self());
}

local_ref<JMap<JString, VideoFrame>>
VideoCompositionFramesExtractor::decodeCompositionFrames() {
  static const auto decodeCompositionFramesMethod =
      getClass()->getMethod<JMap<JString, VideoFrame>()>(
          "decodeCompositionFrames");
  return decodeCompositionFramesMethod(self());
}

void VideoCompositionFramesExtractor::release() const {
  static const auto releaseMethod = getClass()->getMethod<void()>("release");
  releaseMethod(self());
}

} // namespace RNSkiaVideo
