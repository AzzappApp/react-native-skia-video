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
  /**
   * Cap for the longest side of the decoded frames, or 0 for the file's own
   * size. Applied here rather than by the caller because only the decoder knows
   * the track's encoded orientation: a portrait clip is a landscape frame plus a
   * rotation, so a caller passing a portrait size for one gets a squashed
   * picture. See VideoCompositionItemDecoder#setupReader.
   */
  double maxLongSide = 0;
  /**
   * `textureMode: 'direct'` hands Skia the decoder's own pixel buffers,
   * without the per-frame copy into a persistent texture that `'copy'` (the
   * default) does. iOS only.
   */
  bool directTexture = false;
  bool isVideo = true;
  bool audioEnabled = false;
  double audioVolume = 1.0;
};

class VideoComposition {
public:
  double duration;
  std::vector<std::shared_ptr<VideoCompositionItem>> items;
  /** Decoders opened around their item's time, see DecoderWindow. */
  bool lazyDecoders = false;

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
    if (jsComposition.hasProperty(runtime, "lazyDecoders")) {
      auto lazyProp = jsComposition.getProperty(runtime, "lazyDecoders");
      composition->lazyDecoders = lazyProp.isBool() && lazyProp.getBool();
    }
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
        auto capProp = jsItem.getProperty(runtime, "maxLongSide");
        if (capProp.isNumber()) {
          item->maxLongSide = capProp.asNumber();
        }
      }

      if (jsItem.hasProperty(runtime, "textureMode")) {
        auto modeProp = jsItem.getProperty(runtime, "textureMode");
        if (modeProp.isString()) {
          item->directTexture =
              modeProp.asString(runtime).utf8(runtime) == "direct";
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
