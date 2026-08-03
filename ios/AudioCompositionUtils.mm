#import "AudioCompositionUtils.h"

namespace RNSkiaVideo {

NS_INLINE NSError* audioErrorWithMessage(NSString* message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv"
                             code:0
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

AVURLAsset*
getOrCreateAsset(const std::string& path,
                 NSMutableDictionary<NSString*, AVURLAsset*>* assetCache) {
  NSString* nsPath =
      [NSString stringWithCString:path.c_str()
                         encoding:[NSString defaultCStringEncoding]];
  AVURLAsset* asset = assetCache ? assetCache[nsPath] : nil;
  if (!asset) {
    asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:nsPath]
                                options:nil];
    if (assetCache) {
      assetCache[nsPath] = asset;
    }
  }
  return asset;
}

AudioComposition
buildAudioComposition(const std::shared_ptr<VideoComposition>& composition,
                      NSMutableDictionary<NSString*, AVURLAsset*>* assetCache) {
  AVMutableComposition* audioComposition = [AVMutableComposition composition];
  NSMutableArray<AVAudioMixInputParameters*>* inputParameters =
      [NSMutableArray array];
  bool hasTracks = false;
  for (const auto& item : composition->items) {
    if (!item->audioEnabled) {
      continue;
    }
    AVURLAsset* asset = getOrCreateAsset(item->path, assetCache);
    AVAssetTrack* audioTrack =
        [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
    if (!audioTrack) {
      if (!item->isVideo) {
        throw audioErrorWithMessage(
            [NSString stringWithFormat:@"No audio track for path: %s",
                                       item->path.c_str()]);
      }
      continue;
    }

    CMTime startTime = CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC);
    auto sourceRange = CMTimeRangeGetIntersection(
        CMTimeRangeMake(startTime,
                        CMTimeMakeWithSeconds(item->duration, NSEC_PER_SEC)),
        audioTrack.timeRange);
    if (CMTimeCompare(sourceRange.duration, kCMTimeZero) <= 0) {
      continue;
    }

    AVMutableCompositionTrack* compositionTrack = [audioComposition
        addMutableTrackWithMediaType:AVMediaTypeAudio
                    preferredTrackID:kCMPersistentTrackID_Invalid];
    // If the audio track starts after the requested start time, keep the
    // offset so the audio stays aligned on the composition timeline.
    CMTime insertTime = CMTimeAdd(
        CMTimeMakeWithSeconds(item->compositionStartTime, NSEC_PER_SEC),
        CMTimeSubtract(sourceRange.start, startTime));
    NSError* insertError = nil;
    if (![compositionTrack insertTimeRange:sourceRange
                                   ofTrack:audioTrack
                                    atTime:insertTime
                                     error:&insertError]) {
      throw insertError
          ?: audioErrorWithMessage([NSString
                 stringWithFormat:@"Could not insert audio track for item: %s",
                                  item->id.c_str()]);
    }
    hasTracks = true;

    if (item->audioVolume != 1.0) {
      AVMutableAudioMixInputParameters* parameters =
          [AVMutableAudioMixInputParameters
              audioMixInputParametersWithTrack:compositionTrack];
      [parameters setVolume:MAX(0.0, MIN(1.0, item->audioVolume))
                     atTime:kCMTimeZero];
      [inputParameters addObject:parameters];
    }
  }

  if (!hasTracks) {
    return {nil, nil};
  }

  // The playback clock is driven by the audio player: the composition is
  // padded with silence so the playhead can run the whole timeline and go
  // past its duration (completion detection).
  CMTime paddedDuration =
      CMTimeMakeWithSeconds(composition->duration + 0.5, NSEC_PER_SEC);
  if (CMTimeCompare(audioComposition.duration, paddedDuration) < 0) {
    [audioComposition
        insertEmptyTimeRange:CMTimeRangeFromTimeToTime(
                                 audioComposition.duration, paddedDuration)];
  }

  AVMutableAudioMix* audioMix = nil;
  if (inputParameters.count > 0) {
    audioMix = [AVMutableAudioMix audioMix];
    audioMix.inputParameters = inputParameters;
  }
  return {audioComposition, audioMix};
}

} // namespace RNSkiaVideo
