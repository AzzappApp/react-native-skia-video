#pragma once

#import "VideoComposition.h"
#import <AVFoundation/AVFoundation.h>

namespace RNSkiaVideo {

struct AudioComposition {
  AVMutableComposition* composition;
  AVMutableAudioMix* audioMix;
};

/**
 * Builds an audio only AVComposition (with an audio mix for per item
 * volumes) from the audio-enabled items of the given video composition.
 * Returns {nil, nil} if no item provides audio.
 * Throws NSError* if an audio item points to a file without audio track.
 */
AudioComposition
buildAudioComposition(const std::shared_ptr<VideoComposition>& composition,
                      NSMutableDictionary<NSString*, AVURLAsset*>* assetCache);

AVURLAsset*
getOrCreateAsset(const std::string& path,
                 NSMutableDictionary<NSString*, AVURLAsset*>* assetCache);

} // namespace RNSkiaVideo
