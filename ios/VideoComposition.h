#pragma once

#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

class VideoCompositionItem {
public:
  std::string id;
  std::string path;
  double compositionStartTime;
  double startTime;
  double duration;
};

class VideoComposition {
public:
  double duration;
  std::vector<std::shared_ptr<VideoCompositionItem>> items;

  static std::shared_ptr<VideoComposition> fromJS(jsi::Runtime& runtime,
                                                  jsi::Object& jsComposition) {
    auto composition = std::make_shared<VideoComposition>();
    composition->duration =
        jsComposition.getProperty(runtime, "duration").asNumber();
    auto jsItems = jsComposition.getProperty(runtime, "items")
                       .asObject(runtime)
                       .asArray(runtime);
    auto size = jsItems.size(runtime);
    for (int i = 0; i < size; i++) {
      auto jsItem = jsItems.getValueAtIndex(runtime, i).asObject(runtime);
      auto item = std::make_shared<VideoCompositionItem>();
      item->id =
          jsItem.getProperty(runtime, "id").asString(runtime).utf8(runtime);
      item->path =
          jsItem.getProperty(runtime, "path").asString(runtime).utf8(runtime);
      item->compositionStartTime =
          jsItem.getProperty(runtime, "compositionStartTime").asNumber();
      item->startTime = jsItem.getProperty(runtime, "startTime").asNumber();
      item->duration = jsItem.getProperty(runtime, "duration").asNumber();

      composition->items.push_back(item);
    }
    return composition;
  }
};

} // namespace RNSkiaVideo
