#pragma once

#include "VideoComposition.h"
#include "VideoFrame.h"
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

struct VideoCompositionFramesExtractorSync
    : public jni::JavaClass<VideoCompositionFramesExtractorSync> {

public:
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/VideoCompositionFramesExtractorSync;";

  local_ref<VideoCompositionFramesExtractorSync> static create(
      alias_ref<VideoComposition> composition);

  void start() const;

  local_ref<JMap<JString, VideoFrame>> decodeCompositionFrames(jdouble time);

  void release() const;
};

class JSI_EXPORT VideoCompositionFramesSyncExtractorHostObject
    : public jsi::HostObject {
public:
  VideoCompositionFramesSyncExtractorHostObject(jsi::Runtime& runtime,
                                                jsi::Object composition);
  ~VideoCompositionFramesSyncExtractorHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  global_ref<VideoCompositionFramesExtractorSync> framesExtractor;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};

} // namespace RNSkiaVideo
