#include "VideoComposition.h"

namespace RNSkiaVideo {

using namespace facebook::jni;

local_ref<VideoCompositionItem>
VideoCompositionItem::create(std::string& id, std::string& path,
                             double compositionStartTime, double startTime,
                             double duration) {
  auto inst = newInstance();
  auto cls = javaClassStatic();
  inst->setFieldValue(cls->getField<JString>("id"), make_jstring(id).get());
  inst->setFieldValue(cls->getField<JString>("path"), make_jstring(path).get());
  inst->setFieldValue(cls->getField<jdouble>("compositionStartTime"),
                      compositionStartTime);
  inst->setFieldValue(cls->getField<jdouble>("startTime"), startTime);
  inst->setFieldValue(cls->getField<jdouble>("duration"), duration);
  return inst;
}

std::string VideoCompositionItem::getId() const {
  static const auto getIdMethod = getClass()->getMethod<jstring()>("getId");
  return getIdMethod(self())->toStdString();
}

std::string VideoCompositionItem::getPath() const {
  static const auto getPathMethod = getClass()->getMethod<jstring()>("getPath");
  return getPathMethod(self())->toStdString();
}

jdouble VideoCompositionItem::getCompositionStartTime() const {
  static const auto getCompositionStartTimeMethod =
      getClass()->getMethod<jdouble()>("getCompositionStartTime");
  return getCompositionStartTimeMethod(self());
}

jdouble VideoCompositionItem::getStartTime() const {
  static const auto getStartTimeMethod =
      getClass()->getMethod<jdouble()>("getStartTime");
  return getStartTimeMethod(self());
}

jdouble VideoCompositionItem::getDuration() const {
  static const auto getDurationMethod =
      getClass()->getMethod<jdouble()>("getDuration");
  return getDurationMethod(self());
}

local_ref<VideoComposition>
VideoComposition::create(jdouble duration,
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
    auto startTime = jsItem.getProperty(runtime, "startTime").asNumber();
    auto duration = jsItem.getProperty(runtime, "duration").asNumber();
    auto item = VideoCompositionItem::create(id, path, compositionStartTime,
                                             startTime, duration);
    items->add(item);
  }
  return VideoComposition::create(duration, items);
}
} // namespace RNSkiaVideo
