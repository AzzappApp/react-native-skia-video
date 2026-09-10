#pragma once

#import "RNSVEventEmitter.h"
#import "RNSVHostObject.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

@interface RNSVDisplayLinkWrapper : NSObject

@property(nonatomic, strong) CADisplayLink* displayLink;
@property(nonatomic, copy) void (^updateBlock)(CADisplayLink* displayLink);

- (instancetype)initWithUpdateBlock:
    (void (^)(CADisplayLink* displayLink))updateBlock;
- (void)start;
- (void)invalidate;

@end

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoCompositionFramesExtractorHostObject
    : public RNSVHostObject,
      EventEmitter {
public:
  VideoCompositionFramesExtractorHostObject(
      jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
      std::shared_ptr<VideoComposition> videoComposition);
  ~VideoCompositionFramesExtractorHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  NSObject* lock;
  std::shared_ptr<VideoComposition> composition;
  std::map<std::string, std::shared_ptr<VideoCompositionItemDecoder>>
      itemDecoders;
  std::map<std::string, std::shared_ptr<VideoFrame>> currentFrames;
  // Incremented every time decodeCompositionFrames acquires a new frame for
  // at least one item. Exposed to JS as `framesVersion`, so the player can
  // tell an unchanged frame set from a fresh one and skip redrawing it.
  uint64_t framesVersion = 0;
  dispatch_queue_t decoderQueue;
  RNSVDisplayLinkWrapper* displayLink;
  NSDate* startDate;
  CMTime pausePosition = kCMTimeZero;
  bool playWhenReady = false;
  bool isPlaying = false;
  bool isLooping = false;
  bool initialized = false;
  bool completeEmitted = false;
  // Plays the audio of the composition; when present it is also the master
  // clock of the playback.
  AVPlayer* audioPlayer;
  std::atomic_flag released = ATOMIC_FLAG_INIT;

  void prepare();
  void init();
  void play();
  void pause();
  void seekTo(CMTime time);
  CMTime getCurrentTime();
  void release();
};

} // namespace RNSkiaVideo
