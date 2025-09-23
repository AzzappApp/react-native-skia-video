#pragma once

#include <android/hardware_buffer_jni.h>
#include <fbjni/fbjni.h>

#include "NativeEventDispatcher.h"
#include "VideoFrame.h"

namespace RNSkiaVideo {

using namespace facebook;

struct VideoPlayer : public jni::JavaClass<VideoPlayer> {

public:
  static constexpr auto kJavaDescriptor = "Lcom/sheunglaili/rnskv/VideoPlayer;";

  static jni::local_ref<VideoPlayer>
  create(const std::string& uri, int width, int height,
         alias_ref<RNSkiaVideo::NativeEventDispatcher> dispatcher);

  void play();

  void pause();

  void setupGL();

  void seekTo(jlong location);

  jboolean getIsPlaying();

  jlong getCurrentPosition();

  jlong getDuration();

  jfloat getVolume();

  void setVolume(jfloat volume);

  jboolean getIsLooping();

  void setIsLooping(jboolean isLooping);

  jfloat getPlaybackSpeed();

  void setPlaybackSpeed(jfloat playbackSpeed);

  local_ref<VideoFrame> decodeNextFrame();

  void release();
};
} // namespace RNSkiaVideo
