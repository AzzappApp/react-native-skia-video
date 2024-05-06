//
//  RNSVVideoPlayer.m
//  react-native-skia-video
//
//  Created by François de Campredon on 25/02/2024.
//  port from flutter video player
// see:
// https://github.com/flutter/packages/blob/41f5a16e13f4c9327e75d431d338c33f2fb35870/packages/video_player/video_player_avfoundation/darwin/Classes/FVPVideoPlayerPlugin.m
//

#import "RNSVVideoPlayer.h"
#import "AVAssetTrackUtils.h"

static void* timeRangeContext = &timeRangeContext;
static void* statusContext = &statusContext;
static void* presentationSizeContext = &presentationSizeContext;
static void* durationContext = &durationContext;
static void* playbackLikelyToKeepUpContext = &playbackLikelyToKeepUpContext;
static void* rateContext = &rateContext;

@implementation RNSVVideoPlayer {
  AVPlayer* _player;
  CADisplayLink* _displayLink;
  AVPlayerItemVideoOutput* _videoOutput;
  id<RNSVVideoPlayerDelegate> _delegate;
  // AVPlayerLayer *_playerLayer;
  Boolean _complete;
  Boolean _waitingForFrame;
}

- (instancetype)initWithURL:(NSURL*)url
                   delegate:(id<RNSVVideoPlayerDelegate>)delegate {
  self = [super init];
  _delegate = delegate;
  _complete = NO;
  _waitingForFrame = YES;

  AVAsset* asset = [AVAsset assetWithURL:url];

  _player.actionAtItemEnd = AVPlayerActionAtItemEndNone;

  // This is to fix 2 bugs: 1. blank video for encrypted video streams on iOS 16
  // (https://github.com/flutter/flutter/issues/111457) and 2. swapped width and
  // height for some video streams (not just iOS 16).
  // (https://github.com/flutter/flutter/issues/109116). An invisible
  // AVPlayerLayer is used to overwrite the protection of pixel buffers in those
  // streams for issue #1, and restore the correct width and height for issue
  // #2.
  //_playerLayer = [AVPlayerLayer playerLayerWithPlayer:_player];
  // [self.flutterViewLayer addSublayer:_playerLayer];

  NSDictionary* pixBuffAttributes = @{
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferMetalCompatibilityKey : @YES
  };
  _videoOutput = [[AVPlayerItemVideoOutput alloc]
      initWithPixelBufferAttributes:pixBuffAttributes];

  _displayLink =
      [CADisplayLink displayLinkWithTarget:self
                                  selector:@selector(displayLinkFired:)];
  [_displayLink addToRunLoop:[NSRunLoop currentRunLoop]
                     forMode:NSRunLoopCommonModes];

  AVPlayerItem* item = [AVPlayerItem playerItemWithAsset:asset];
  _player = [AVPlayer playerWithPlayerItem:item];
  [self addObserversForItem:item player:_player];

  return self;
}

- (CMTime)currentTime {
  return _player.currentTime;
}

- (CMTime)duration {
  return _player.currentItem.duration;
}

- (void)pause {
  _isPlaying = NO;
  [self updatePlayingState];
}

- (void)play {
  _isPlaying = YES;
  [self updatePlayingState];
}

- (void)setIsLooping:(BOOL)isLooping {
  _isLooping = isLooping;
  _player.actionAtItemEnd =
      isLooping ? AVPlayerActionAtItemEndNone : AVPlayerActionAtItemEndPause;
  // restart only if video as ended
  if (_complete) {
    _complete = NO;
    [_player.currentItem seekToTime:kCMTimeZero completionHandler:nil];
  }
}

- (float)volume {
  return _player.volume;
}

- (void)setVolume:(float)volume {
  _player.volume =
      (float)((volume < 0.0) ? 0.0 : ((volume > 1.0) ? 1.0 : volume));
}

- (nullable CVPixelBufferRef)copyPixelBufferForTime:(CMTime)time {
  CVPixelBufferRef buffer = NULL;
  if ([_videoOutput hasNewPixelBufferForItemTime:time]) {
    buffer = [_videoOutput copyPixelBufferForItemTime:time
                                   itemTimeForDisplay:nil];
  }
  return buffer;
}

- (void)seekTo:(CMTime)time
    completionHandler:(void (^)(BOOL))completionHandler {
  CMTime previousCMTime = _player.currentTime;
  CMTime duration = _player.currentItem.asset.duration;
  // Without adding tolerance when seeking to duration,
  // seekToTime will never complete, and this call will hang.
  // see issue https://github.com/flutter/flutter/issues/124475.
  CMTime tolerance =
      duration.value == time.value ? CMTimeMake(1, 1000) : kCMTimeZero;
  [_player seekToTime:time
        toleranceBefore:tolerance
         toleranceAfter:tolerance
      completionHandler:^(BOOL completed) {
        if (CMTimeCompare(self->_player.currentTime, previousCMTime) != 0) {
          // Ensure that a frame is drawn once available, even if currently
          // paused. In theory a race is possible here where the new frame has
          // already drawn by the time this code runs, and the display link
          // stays on indefinitely, but that should be relatively harmless. This
          // must use the display link rather than just informing the engine
          // that a new frame is available because the seek completing doesn't
          // guarantee that the pixel buffer is already available.
          [self expectFrame];
        }

        if (completionHandler) {
          completionHandler(completed);
        }
      }];
}

- (void)addObserversForItem:(AVPlayerItem*)item player:(AVPlayer*)player {
  [item addObserver:self
         forKeyPath:@"loadedTimeRanges"
            options:NSKeyValueObservingOptionInitial |
                    NSKeyValueObservingOptionNew
            context:timeRangeContext];
  [item addObserver:self
         forKeyPath:@"status"
            options:NSKeyValueObservingOptionInitial |
                    NSKeyValueObservingOptionNew
            context:statusContext];
  [item addObserver:self
         forKeyPath:@"presentationSize"
            options:NSKeyValueObservingOptionInitial |
                    NSKeyValueObservingOptionNew
            context:presentationSizeContext];
  [item addObserver:self
         forKeyPath:@"duration"
            options:NSKeyValueObservingOptionInitial |
                    NSKeyValueObservingOptionNew
            context:durationContext];
  [item addObserver:self
         forKeyPath:@"playbackLikelyToKeepUp"
            options:NSKeyValueObservingOptionInitial |
                    NSKeyValueObservingOptionNew
            context:playbackLikelyToKeepUpContext];

  // Add observer to AVPlayer instead of AVPlayerItem since the AVPlayerItem
  // does not have a "rate" property
  [player addObserver:self
           forKeyPath:@"rate"
              options:NSKeyValueObservingOptionInitial |
                      NSKeyValueObservingOptionNew
              context:rateContext];

  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(itemDidPlayToEndTime:)
             name:AVPlayerItemDidPlayToEndTimeNotification
           object:item];
}

- (void)displayLinkFired:(CADisplayLink*)sender {
  CMTime outputItemTime =
      [_videoOutput itemTimeForHostTime:CACurrentMediaTime()];
  if ([_videoOutput hasNewPixelBufferForItemTime:outputItemTime]) {
    [_delegate frameAvailable:outputItemTime];
    if (_waitingForFrame) {
      _waitingForFrame = NO;
      // If the display link was only running temporarily to pick up a new frame
      // while the video was paused, stop it again.
      if (!self.isPlaying) {
        _displayLink.paused = YES;
      }
    }
  }
}

- (void)itemDidPlayToEndTime:(NSNotification*)notification {
  if (notification.object == _player.currentItem && _isLooping) {
    AVPlayerItem* item = [notification object];
    // [item seekToTime:kCMTimeZero completionHandler:nil];
    __weak RNSVVideoPlayer* weakSelf = self;
    [item seekToTime:kCMTimeZero
          toleranceBefore:kCMTimeZero
           toleranceAfter:kCMTimeZero
        completionHandler:^(BOOL finished) {
          __strong RNSVVideoPlayer* strongSelf = weakSelf;
          if (!strongSelf || strongSelf->_disposed)
            return;
          if (finished) {
            [strongSelf->_delegate frameAvailable:kCMTimeZero];
          }
        }];
  } else {
    [_delegate complete];
    _complete = YES;
  }
}

- (void)observeValueForKeyPath:(NSString*)path
                      ofObject:(id)object
                        change:(NSDictionary*)change
                       context:(void*)context {
  if (context == timeRangeContext) {
    NSArray<NSValue*>* timeRanges = [object loadedTimeRanges];
    if (timeRanges != nil) {
      [_delegate bufferingUpdate:[object loadedTimeRanges]];
    }
  } else if (context == statusContext) {
    AVPlayerItem* item = (AVPlayerItem*)object;
    switch (item.status) {
      case AVPlayerItemStatusFailed:
        [_delegate videoError:item.error];
        break;
      case AVPlayerItemStatusUnknown:
        break;
      case AVPlayerItemStatusReadyToPlay:
        [item addOutput:_videoOutput];
        [self dispatchReadyToPlay];
        [self updatePlayingState];
        break;
    }
  } else if (context == presentationSizeContext || context == durationContext) {
    AVPlayerItem* item = (AVPlayerItem*)object;
    if (item.status == AVPlayerItemStatusReadyToPlay) {
      // Due to an apparent bug, when the player item is ready, it still may not
      // have determined its presentation size or duration. When these
      // properties are finally set, re-check if all required properties and
      // instantiate the event sink if it is not already set up.
      [self dispatchReadyToPlay];
      [self updatePlayingState];
    }
  } else if (context == playbackLikelyToKeepUpContext) {
    [self updatePlayingState];
    if ([[_player currentItem] isPlaybackLikelyToKeepUp]) {
      [_delegate bufferingEnd];
    } else {
      [_delegate bufferingStart];
    }
  } else if (context == rateContext) {
    AVPlayer* player = (AVPlayer*)object;
    [_delegate isPlaying:player.rate > 0];
  }
}

- (void)dispatchReadyToPlay {
  if (!_isInitialized) {
    AVPlayerItem* currentItem = _player.currentItem;
    CGSize size = currentItem.presentationSize;
    CGFloat width = size.width;
    CGFloat height = size.height;

    // Wait until tracks are loaded to check duration or if there are any
    // videos.
    AVAsset* asset = currentItem.asset;
    if ([asset statusOfValueForKey:@"tracks"
                             error:nil] != AVKeyValueStatusLoaded) {
      void (^trackCompletionHandler)(void) = ^{
        if ([asset statusOfValueForKey:@"tracks"
                                 error:nil] != AVKeyValueStatusLoaded) {
          // Cancelled, or something failed.
          return;
        }
        dispatch_async(dispatch_get_main_queue(), ^{
          [self dispatchReadyToPlay];
        });
      };
      [asset loadValuesAsynchronouslyForKeys:@[ @"tracks" ]
                           completionHandler:trackCompletionHandler];
      return;
    }

    NSArray* videoTracks = [asset tracksWithMediaType:AVMediaTypeVideo];
    NSArray* allTracks = asset.tracks;
    BOOL hasVideoTracks = videoTracks.count != 0;
    BOOL hasNoTracks = allTracks.count == 0;

    // The player has not yet initialized when it has no size, unless it is an
    // audio-only track. HLS m3u8 video files never load any tracks, and are
    // also not yet initialized until they have a size.
    if ((hasVideoTracks || hasNoTracks) && height == CGSizeZero.height &&
        width == CGSizeZero.width) {
      return;
    }
    AVAssetTrack* track = [videoTracks firstObject];
    int rotation = RNSkiaVideo::GetTrackRotationInDegree(track);

    // The player may be initialized but still needs to determine the duration.
    CMTime duration = currentItem.duration;
    if (CMTIME_IS_INDEFINITE(duration) || duration.timescale == 0 ||
        duration.value == 0) {
      return;
    }

    _isInitialized = YES;
    [_delegate readyToPlay:@{
      @"width" : @(width),
      @"height" : @(height),
      @"rotation" : @(rotation)
    }];
  }
}

- (void)updatePlayingState {
  if (!_isInitialized) {
    return;
  }
  if (_isPlaying && _player.rate == 0) {
    [_player play];
  } else if (!_isPlaying && _player.rate != 0) {
    [_player pause];
  }
  // If the texture is still waiting for an expected frame, the display link
  // needs to keep running until it arrives regardless of the play/pause state.
  _displayLink.paused = !_isPlaying && !_waitingForFrame;
}

- (void)expectFrame {
  _waitingForFrame = YES;
  _displayLink.paused = NO;
}

- (void)removeKeyValueObservers {
  AVPlayerItem* currentItem = _player.currentItem;
  [currentItem removeObserver:self forKeyPath:@"status"];
  [currentItem removeObserver:self forKeyPath:@"loadedTimeRanges"];
  [currentItem removeObserver:self forKeyPath:@"presentationSize"];
  [currentItem removeObserver:self forKeyPath:@"duration"];
  [currentItem removeObserver:self forKeyPath:@"playbackLikelyToKeepUp"];
  [_player removeObserver:self forKeyPath:@"rate"];
}

- (void)dealloc {
  if (!_disposed) {
    [self dispose];
  }
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

// this method is call from JS side, do not remove it.
- (void)dispose {
  if (_disposed) {
    return;
  }
  [_displayLink invalidate];
  [_player replaceCurrentItemWithPlayerItem:nil];
  _player = nil;
  _displayLink = nil;
  _disposed = true;
  [self removeKeyValueObservers];
}

@end
