#pragma once

#include <fbjni/fbjni.h>

#include "NativeEventDispatcher.h"
#include "VideoComposition.h"
#include "VideoFrame.h"

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

struct VideoCompositionFramesExtractor
    : public jni::JavaClass<VideoCompositionFramesExtractor> {

public:
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/VideoCompositionFramesExtractor;";

  local_ref<VideoCompositionFramesExtractor> static create(
      alias_ref<VideoComposition> composition,
      alias_ref<RNSkiaVideo::NativeEventDispatcher> dispatcher);

  void prepare() const;

  void play() const;

  void pause() const;

  void seekTo(jlong position) const;

  jboolean getIsPlaying() const;

  jlong getCurrentPosition() const;

  jboolean getIsLooping() const;

  void setIsLooping(jboolean isLooping) const;

  local_ref<JMap<JString, VideoFrame>> decodeCompositionFrames();

  void release() const;
};
} // namespace RNSkiaVideo
