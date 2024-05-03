#include "VideoPlayer.h"
#include "JSIJNIConversion.h"

namespace RNSkiaVideo {

jni::local_ref<VideoPlayer>
VideoPlayer::create(const std::string& uri,
                    alias_ref<NativeEventDispatcher> dispatcher) {
  return newInstance(uri, dispatcher);
}

void VideoPlayer::play() {
  static const auto playMethod = getClass()->getMethod<void()>("play");
  playMethod(self());
}

void VideoPlayer::pause() {
  static const auto pauseMethod = getClass()->getMethod<void()>("pause");
  pauseMethod(self());
}

void VideoPlayer::seekTo(jlong location) {
  static const auto seekToMethod = getClass()->getMethod<void(jlong)>("seekTo");
  seekToMethod(self(), location);
}

jboolean VideoPlayer::getIsPlaying() {
  static const auto getIsPlayingMethod =
      getClass()->getMethod<jboolean()>("getIsPlaying");
  return getIsPlayingMethod(self());
}

jlong VideoPlayer::getCurrentPosition() {
  static const auto getCurrentPositionMethod =
      getClass()->getMethod<jlong()>("getCurrentPosition");
  return getCurrentPositionMethod(self());
}

jlong VideoPlayer::getDuration() {
  static const auto getDurationMethod =
      getClass()->getMethod<jlong()>("getDuration");
  return getDurationMethod(self());
}

jfloat VideoPlayer::getVolume() {
  static const auto getVolumeMethod =
      getClass()->getMethod<jfloat()>("getVolume");
  return getVolumeMethod(self());
}

void VideoPlayer::setVolume(jfloat volume) {
  static const auto setVolumeMethod =
      getClass()->getMethod<void(jfloat)>("setVolume");
  setVolumeMethod(self(), volume);
}

jboolean VideoPlayer::getIsLooping() {
  static const auto getIsLoopingMethod =
      getClass()->getMethod<jboolean()>("getIsLooping");
  return getIsLoopingMethod(self());
}

void VideoPlayer::setIsLooping(jboolean isLooping) {
  static const auto setIsLoopingMethod =
      getClass()->getMethod<void(bool)>("setIsLooping");
  setIsLoopingMethod(self(), isLooping);
}

local_ref<VideoFrame> VideoPlayer::decodeNextFrame() {
  static const auto decodeNextFrameMethod =
      getClass()->getMethod<VideoFrame()>("decodeNextFrame");
  return decodeNextFrameMethod(self());
}

void VideoPlayer::release() {
  static const auto releaseMethod = getClass()->getMethod<void()>("release");
  releaseMethod(self());
}

} // namespace RNSkiaVideo
