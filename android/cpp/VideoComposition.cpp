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
    auto itemCls = VideoCompositionItem::javaClassStatic();
    if (jsItem.hasProperty(runtime, "resolution")) {
      auto resProp = jsItem.getProperty(runtime, "resolution");
      if (resProp.isObject()) {
        auto res = resProp.asObject(runtime);
        item->setFieldValue(itemCls->getField<jint>("width"),
                            (int)res.getProperty(runtime, "width").asNumber());
        item->setFieldValue(itemCls->getField<jint>("height"),
                            (int)res.getProperty(runtime, "height").asNumber());
      }
    }
    bool isVideo = true;
    if (jsItem.hasProperty(runtime, "kind")) {
      auto kindProp = jsItem.getProperty(runtime, "kind");
      if (kindProp.isString()) {
        isVideo = kindProp.asString(runtime).utf8(runtime) != "audio";
      }
    }
    bool audioEnabled = false;
    double audioVolume = 1.0;
    if (!isVideo) {
      audioEnabled = true;
      if (jsItem.hasProperty(runtime, "volume")) {
        auto volumeProp = jsItem.getProperty(runtime, "volume");
        if (volumeProp.isNumber()) {
          audioVolume = volumeProp.asNumber();
        }
      }
    } else if (jsItem.hasProperty(runtime, "audio")) {
      auto audioProp = jsItem.getProperty(runtime, "audio");
      if (audioProp.isBool()) {
        audioEnabled = audioProp.getBool();
      } else if (audioProp.isObject()) {
        audioEnabled = true;
        auto audio = audioProp.asObject(runtime);
        if (audio.hasProperty(runtime, "volume")) {
          auto volumeProp = audio.getProperty(runtime, "volume");
          if (volumeProp.isNumber()) {
            audioVolume = volumeProp.asNumber();
          }
        }
      }
    }
    item->setFieldValue(itemCls->getField<jboolean>("isVideo"),
                        (jboolean)isVideo);
    item->setFieldValue(itemCls->getField<jboolean>("audioEnabled"),
                        (jboolean)audioEnabled);
    item->setFieldValue(itemCls->getField<jdouble>("audioVolume"), audioVolume);

    items->add(item);
  }
  return VideoComposition::create(duration, items);
}
} // namespace RNSkiaVideo
