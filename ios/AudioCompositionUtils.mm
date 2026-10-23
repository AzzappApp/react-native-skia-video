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

    // The fades are volume ramps of the item's track, in composition time
    // (the same audio mix drives playback and export). They are clamped to
    // the item, the fade out to what the fade in leaves of it.
    double volume = MAX(0.0, MIN(1.0, item->audioVolume));
    double fadeIn = MAX(0.0, MIN(item->audioFadeIn, item->duration));
    double fadeOut =
        MAX(0.0, MIN(item->audioFadeOut, item->duration - fadeIn));
    if (volume != 1.0 || fadeIn > 0 || fadeOut > 0) {
      AVMutableAudioMixInputParameters* parameters =
          [AVMutableAudioMixInputParameters
              audioMixInputParametersWithTrack:compositionTrack];
      // A fade in starts from 0 on its own: a volume set at the time a ramp
      // starts would overlap it. Before the item, the track is empty.
      if (fadeIn <= 0) {
        [parameters setVolume:volume atTime:kCMTimeZero];
      } else {
        [parameters
            setVolumeRampFromStartVolume:0.0
                             toEndVolume:volume
                               timeRange:CMTimeRangeMake(
                                             CMTimeMakeWithSeconds(
                                                 item->compositionStartTime,
                                                 NSEC_PER_SEC),
                                             CMTimeMakeWithSeconds(
                                                 fadeIn, NSEC_PER_SEC))];
      }
      if (fadeOut > 0) {
        [parameters
            setVolumeRampFromStartVolume:volume
                             toEndVolume:0.0
                               timeRange:CMTimeRangeMake(
                                             CMTimeMakeWithSeconds(
                                                 item->compositionStartTime +
                                                     item->duration - fadeOut,
                                                 NSEC_PER_SEC),
                                             CMTimeMakeWithSeconds(
                                                 fadeOut, NSEC_PER_SEC))];
      }
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
