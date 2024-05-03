#pragma once

#include <RNSkPlatformContext.h>
#include <fbjni/ByteBuffer.h>
#include <fbjni/fbjni.h>
#include <jni.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

struct VideoCompositionItem : public JavaClass<VideoCompositionItem> {
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/VideoComposition$Item;";
  static local_ref<VideoCompositionItem> create(std::string& id,
                                                std::string& path,
                                                jlong compositionStartTime,
                                                jlong compositionEndTime);

  std::string getId();
  std::string getPath();
  jlong getCompositionStartTime();
  jlong getCompositionEndTime();
};

struct VideoComposition : public JavaClass<VideoComposition> {
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoComposition;";
  static local_ref<VideoComposition>
  create(jlong duration, alias_ref<JList<VideoCompositionItem>> items);
  static local_ref<VideoComposition> fromJSIObject(jsi::Runtime& runtime,
                                                   jsi::Object& jsComposition);
};
} // namespace RNSkiaVideo
