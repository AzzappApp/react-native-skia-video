#pragma once

#import "RNSVEventEmitter.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>
#import <optional>

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
    : public jsi::HostObject,
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
  dispatch_queue_t decoderQueue;
  RNSVDisplayLinkWrapper* displayLink;
  NSDate* startDate;
  CMTime pausePosition = kCMTimeZero;
  bool playWhenReady = false;
  bool isPlaying = false;
  bool isLooping = false;
  // Master volume (0..1) of the audio player, settable from JS: applied by
  // init to the player it creates, and to the live one when it changes.
  float volume = 1;
  bool initialized = false;
  bool completeEmitted = false;
  // Plays the audio of the composition; when present it is also the master
  // clock of the playback.
  AVPlayer* audioPlayer;
  std::atomic_flag prepared = ATOMIC_FLAG_INIT;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  // A decoding pass is queued on the decoder queue (see prepare).
  std::atomic_flag passQueued = ATOMIC_FLAG_INIT;
  // The composition is paused and a decoding pass ran at its time: the next
  // ticks have nothing to decode until it plays, seeks or loops differently.
  std::atomic<bool> pausedFramesDecoded{false};

  void prepare();
  void init();
  // Decodes the frames of the items at the current time (see prepare).
  void decodeFrames();
  void play();
  void pause();
  void seekTo(CMTime time);
  CMTime getCurrentTime();
  // The time an item is decoded at for the composition time `time`, or none
  // if its reader is released: while the item is decoded (see isDecodedAt),
  // and, when the composition loops, while it is decoded at the same time of
  // the next loop.
  // Only the readers of the items around the current time are kept.
  std::optional<CMTime> getDecodingTime(const VideoCompositionItem& item,
                                        CMTime time);
  // Whether the reader of an item decodes the first frames of the next loop
  // before the composition loops (see advanceDecoder): the composition loops
  // and the item is decoded both at its end and at its start. The reader of
  // any other item is released at the item's end.
  bool decodesNextLoop(const VideoCompositionItem& item);
  void release();
};

} // namespace RNSkiaVideo
