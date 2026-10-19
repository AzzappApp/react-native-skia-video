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
  CGSize resolution;
  // Cap on the decoded long side, resolved against the track's natural size
  // by the decoder (see types.ts): unlike `resolution`, it says nothing about
  // orientation, so a caller holding display dimensions cannot get it wrong.
  double maxLongSide = 0;
  bool isVideo = true;
  bool audioEnabled = false;
  double audioVolume = 1.0;
  // Fades of an audio item, in seconds (see types.ts).
  double audioFadeIn = 0;
  double audioFadeOut = 0;

  // How long before it starts and after it ends an item is live, in seconds
  // (see isLiveAt).
  static constexpr double liveMargin = 1;

  // Whether the item is live at a time of the composition (seconds): from
  // liveMargin before it starts to liveMargin after it ends. Its frames are
  // only handed out then, the resources of the frames of an item that is not
  // live can be released.
  bool isLiveAt(double compositionTime) const {
    return compositionTime >= compositionStartTime - liveMargin &&
           compositionTime <= compositionStartTime + duration + liveMargin;
  }
};

class VideoComposition {
public:
  double duration;
  std::vector<std::shared_ptr<VideoCompositionItem>> items;

  bool hasAudio() const {
    for (const auto& item : items) {
      if (item->audioEnabled) {
        return true;
      }
    }
    return false;
  }

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
      item->resolution = CGSize();
      if (jsItem.hasProperty(runtime, "resolution")) {
        auto resProp = jsItem.getProperty(runtime, "resolution");
        if (resProp.isObject()) {
          auto res = resProp.asObject(runtime);
          item->resolution.width = res.getProperty(runtime, "width").asNumber();
          item->resolution.height =
              res.getProperty(runtime, "height").asNumber();
        }
      }

      if (jsItem.hasProperty(runtime, "maxLongSide")) {
        auto prop = jsItem.getProperty(runtime, "maxLongSide");
        if (prop.isNumber()) {
          item->maxLongSide = prop.asNumber();
        }
      }

      if (jsItem.hasProperty(runtime, "kind")) {
        auto kindProp = jsItem.getProperty(runtime, "kind");
        if (kindProp.isString()) {
          item->isVideo = kindProp.asString(runtime).utf8(runtime) != "audio";
        }
      }
      if (!item->isVideo) {
        item->audioEnabled = true;
        if (jsItem.hasProperty(runtime, "volume")) {
          auto volumeProp = jsItem.getProperty(runtime, "volume");
          if (volumeProp.isNumber()) {
            item->audioVolume = volumeProp.asNumber();
          }
        }
        if (jsItem.hasProperty(runtime, "fadeIn")) {
          auto fadeInProp = jsItem.getProperty(runtime, "fadeIn");
          if (fadeInProp.isNumber()) {
            item->audioFadeIn = fadeInProp.asNumber();
          }
        }
        if (jsItem.hasProperty(runtime, "fadeOut")) {
          auto fadeOutProp = jsItem.getProperty(runtime, "fadeOut");
          if (fadeOutProp.isNumber()) {
            item->audioFadeOut = fadeOutProp.asNumber();
          }
        }
      } else if (jsItem.hasProperty(runtime, "audio")) {
        auto audioProp = jsItem.getProperty(runtime, "audio");
        if (audioProp.isBool()) {
          item->audioEnabled = audioProp.getBool();
        } else if (audioProp.isObject()) {
          item->audioEnabled = true;
          auto audio = audioProp.asObject(runtime);
          if (audio.hasProperty(runtime, "volume")) {
            auto volumeProp = audio.getProperty(runtime, "volume");
            if (volumeProp.isNumber()) {
              item->audioVolume = volumeProp.asNumber();
            }
          }
        }
      }

      composition->items.push_back(item);
    }
    return composition;
  }
};

} // namespace RNSkiaVideo
