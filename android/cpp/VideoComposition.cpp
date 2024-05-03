#include "VideoComposition.h"

namespace RNSkiaVideo {

using namespace facebook::jni;

local_ref<VideoCompositionItem>
VideoCompositionItem::create(std::string& id, std::string& path,
                             jlong compositionStartTime,
                             jlong compositionEndTime) {
  auto inst = newInstance();
  auto cls = javaClassStatic();
  inst->setFieldValue(cls->getField<JString>("id"), make_jstring(id).get());
  inst->setFieldValue(cls->getField<JString>("path"), make_jstring(path).get());
  inst->setFieldValue(cls->getField<jlong>("compositionStartTime"),
                      compositionStartTime);
  inst->setFieldValue(cls->getField<jlong>("compositionEndTime"),
                      compositionEndTime);
  return inst;
}

std::string VideoCompositionItem::getId() {
  static const auto getIdMethod = getClass()->getMethod<jstring()>("getId");
  return getIdMethod(self())->toStdString();
}

std::string VideoCompositionItem::getPath() {
  static const auto getPathMethod = getClass()->getMethod<jstring()>("getPath");
  return getPathMethod(self())->toStdString();
}

jlong VideoCompositionItem::getCompositionStartTime() {
  static const auto getCompositionStartTimeMethod =
      getClass()->getMethod<jlong()>("getCompositionStartTime");
  return getCompositionStartTimeMethod(self());
}

jlong VideoCompositionItem::getCompositionEndTime() {
  static const auto getCompositionEndTimeMethod =
      getClass()->getMethod<jlong()>("getCompositionEndTime");
  return getCompositionEndTimeMethod(self());
}

local_ref<VideoComposition>
VideoComposition::create(jlong duration,
                         alias_ref<JList<VideoCompositionItem>> items) {
  return newInstance(duration, items);
}

local_ref<VideoComposition>
VideoComposition::fromJSIObject(jsi::Runtime& runtime,
                                jsi::Object& jsComposition) {
  auto duration = jsComposition.getProperty(runtime, "duration").asNumber();
  auto jsItems = jsComposition.getProperty(runtime, "items")
                     .asObject(runtime)
                     .asArray(runtime);
  auto size = jsItems.size(runtime);
  local_ref<JList<VideoCompositionItem>> items =
      JArrayList<VideoCompositionItem>::create(size);
  for (int i = 0; i < size; i++) {
    auto jsItem = jsItems.getValueAtIndex(runtime, i).asObject(runtime);
    auto id = jsItem.getProperty(runtime, "id").asString(runtime).utf8(runtime);
    auto path =
        jsItem.getProperty(runtime, "path").asString(runtime).utf8(runtime);
    auto compositionStartTime =
        jsItem.getProperty(runtime, "compositionStartTime").asNumber();
    auto compositionEndTime =
        jsItem.getProperty(runtime, "compositionEndTime").asNumber();
    auto item = VideoCompositionItem::create(id, path, compositionStartTime,
                                             compositionEndTime);
    items->add(item);
  }
  return VideoComposition::create(duration, items);
}
} // namespace RNSkiaVideo
