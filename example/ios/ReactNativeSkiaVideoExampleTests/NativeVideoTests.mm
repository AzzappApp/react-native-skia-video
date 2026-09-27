// Native tests of the iOS decoding and encoding pipeline, on the simulator.
//
// The test videos are written here with AVAssetWriter, so the tests carry no
// media: every frame draws its own index as a grid of black and white cells
// (10 bits of index, then their 10 complements), which survives compression
// and colour conversion, so a decoded frame is identified by reading a few
// pixels back from its Metal texture. Frame i sits at i / fps seconds.
//
// The host objects are driven the way JS drives them, through JSI, on a
// Hermes runtime made for the test. Mirrors the Android instrumented tests
// (android/src/androidTest/java/com/azzapp/rnskv/) and
// test/native/DecoderWindowTest.cpp.

#import <AVFoundation/AVFoundation.h>
#import <Metal/Metal.h>
#import <XCTest/XCTest.h>

#include <algorithm>
#include <atomic>
#include <functional>
#include <future>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include <ReactCommon/CallInvoker.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#import "DecoderWindow.h"
#import "MTLTextureUtils.h"
#import "RNSVEventEmitter.h"
#import "RNSVHostObject.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import "VideoEncoderHostObject.h"
#import "VideoFrame.h"
// The extractors keep which decoders are open to themselves; the lazy tests
// count them, as the Android tests do through isOpen().
#define private public
#import "VideoCompositionFramesExtractorHostObject.h"
#import "VideoCompositionFramesExtractorSyncHostObject.h"
#undef private

using namespace facebook;
using namespace RNSkiaVideo;

#pragma mark - Test videos

namespace {

constexpr int kCols = 5;
constexpr int kRows = 4;
constexpr int kBits = 10;

struct VideoSpec {
  int width = 320;
  int height = 240;
  int fps = 30;
  double seconds = 6;
  NSString* codec = AVVideoCodecTypeH264;
  // Degrees, as AVAssetTrackUtils reads them back.
  int rotation = 0;

  NSString* key() const {
    return [NSString stringWithFormat:@"%dx%d-%dfps-%.2fs-%@-r%d", width,
                                      height, fps, seconds, codec, rotation];
  }
  int frames() const { return (int)llround(seconds * fps); }
};

bool cellBit(int index, int cell) {
  bool bit = (index >> (cell % kBits)) & 1;
  return cell < kBits ? bit : !bit;
}

void fillPattern(uint8_t* base, size_t bytesPerRow, int width, int height,
                 int index) {
  std::vector<uint8_t> row(bytesPerRow);
  for (int r = 0; r < kRows; r++) {
    for (int x = 0; x < width; x++) {
      int c = x * kCols / width;
      uint8_t v = cellBit(index, r * kCols + c) ? 255 : 0;
      row[x * 4 + 0] = v;
      row[x * 4 + 1] = v;
      row[x * 4 + 2] = v;
      row[x * 4 + 3] = 255;
    }
    int from = r * height / kRows;
    int to = (r + 1) * height / kRows;
    for (int y = from; y < to; y++) {
      memcpy(base + y * bytesPerRow, row.data(), width * 4);
    }
  }
}

/** The index a BGRA image draws, or -1 when it draws none. */
int readPattern(const uint8_t* base, size_t bytesPerRow, int width,
                int height) {
  int index = 0;
  for (int cell = 0; cell < kCols * kRows; cell++) {
    int cx = (int)((cell % kCols + 0.5) * width / kCols);
    int cy = (int)((cell / kCols + 0.5) * height / kRows);
    int sum = 0, n = 0;
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        int x = std::clamp(cx + dx, 0, width - 1);
        int y = std::clamp(cy + dy, 0, height - 1);
        const uint8_t* p = base + y * bytesPerRow + x * 4;
        sum += (p[0] + p[1] + p[2]) / 3;
        n++;
      }
    }
    int luma = sum / n;
    if (luma > 80 && luma < 176) {
      return -1;
    }
    bool bit = luma >= 128;
    if (cell < kBits) {
      index |= (bit ? 1 : 0) << cell;
    } else if (bit != !((index >> (cell - kBits)) & 1)) {
      return -1;
    }
  }
  return index;
}

NSString* testDirectory() {
  NSString* dir =
      [NSTemporaryDirectory() stringByAppendingPathComponent:@"rnskv-tests"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return dir;
}

/**
 * Writes the video once per spec and test run. Returns nil, with the reason,
 * when the simulator cannot encode it (HEVC, odd sizes).
 */
NSString* testVideo(const VideoSpec& spec, NSString** failure = nullptr) {
  static NSMutableDictionary<NSString*, NSString*>* written =
      [NSMutableDictionary dictionary];
  NSString* key = spec.key();
  if (written[key]) {
    return written[key];
  }
  NSString* path = [testDirectory()
      stringByAppendingPathComponent:[key stringByAppendingString:@".mp4"]];
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
  auto fail = [&](NSString* reason) -> NSString* {
    if (failure) {
      *failure = reason;
    }
    return nil;
  };

  NSError* error = nil;
  AVAssetWriter* writer =
      [AVAssetWriter assetWriterWithURL:[NSURL fileURLWithPath:path]
                               fileType:AVFileTypeMPEG4
                                  error:&error];
  if (!writer) {
    return fail(error.description);
  }
  NSDictionary* settings = @{
    AVVideoCodecKey : spec.codec,
    AVVideoWidthKey : @(spec.width),
    AVVideoHeightKey : @(spec.height),
    AVVideoCompressionPropertiesKey : @{
      AVVideoAverageBitRateKey : @(MAX(400000, spec.width * spec.height * 2)),
      // A key frame every second, as the Android test video.
      AVVideoMaxKeyFrameIntervalKey : @(spec.fps),
      AVVideoExpectedSourceFrameRateKey : @(spec.fps),
    },
  };
  if (![writer canApplyOutputSettings:settings
                         forMediaType:AVMediaTypeVideo]) {
    return fail([NSString stringWithFormat:@"cannot write %@", key]);
  }
  AVAssetWriterInput* input =
      [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                         outputSettings:settings];
  input.expectsMediaDataInRealTime = NO;
  input.transform = CGAffineTransformMakeRotation(spec.rotation * M_PI / 180);
  AVAssetWriterInputPixelBufferAdaptor* adaptor =
      [AVAssetWriterInputPixelBufferAdaptor
          assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                     sourcePixelBufferAttributes:@{
                                       (id)kCVPixelBufferPixelFormatTypeKey :
                                           @(kCVPixelFormatType_32BGRA),
                                       (id)kCVPixelBufferWidthKey :
                                           @(spec.width),
                                       (id)kCVPixelBufferHeightKey :
                                           @(spec.height),
                                     }];
  if (![writer canAddInput:input]) {
    return fail(@"cannot add the video input");
  }
  [writer addInput:input];
  if (![writer startWriting]) {
    return fail(writer.error.description);
  }
  [writer startSessionAtSourceTime:kCMTimeZero];
  for (int i = 0; i < spec.frames(); i++) {
    @autoreleasepool {
      int waits = 0;
      while (!input.readyForMoreMediaData) {
        if (writer.status != AVAssetWriterStatusWriting || waits++ > 2000) {
          return fail(writer.error.description ?: @"writer stalled");
        }
        usleep(5000);
      }
      CVPixelBufferRef buffer = NULL;
      if (CVPixelBufferPoolCreatePixelBuffer(NULL, adaptor.pixelBufferPool,
                                             &buffer) != kCVReturnSuccess) {
        return fail(@"no pixel buffer");
      }
      CVPixelBufferLockBaseAddress(buffer, 0);
      fillPattern((uint8_t*)CVPixelBufferGetBaseAddress(buffer),
                  CVPixelBufferGetBytesPerRow(buffer), spec.width, spec.height,
                  i);
      CVPixelBufferUnlockBaseAddress(buffer, 0);
      BOOL appended = [adaptor appendPixelBuffer:buffer
                            withPresentationTime:CMTimeMake(i, spec.fps)];
      CVPixelBufferRelease(buffer);
      if (!appended) {
        return fail(writer.error.description ?: @"append failed");
      }
    }
  }
  [input markAsFinished];
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [writer finishWritingWithCompletionHandler:^{
    dispatch_semaphore_signal(done);
  }];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  if (writer.status != AVAssetWriterStatusCompleted) {
    return fail(writer.error.description ?: @"writer did not complete");
  }
  written[key] = path;
  return path;
}

#pragma mark - Metal readback

id<MTLCommandQueue> readbackQueue() {
  static id<MTLCommandQueue> queue = [[MTLTextureUtils device] newCommandQueue];
  return queue;
}

/** -1 when the texture draws no index. */
int textureIndex(id<MTLTexture> texture) {
  NSUInteger width = texture.width, height = texture.height;
  NSUInteger bytesPerRow = width * 4;
  id<MTLBuffer> buffer = [[MTLTextureUtils device]
      newBufferWithLength:bytesPerRow * height
                  options:MTLResourceStorageModeShared];
  id<MTLCommandBuffer> commands = [readbackQueue() commandBuffer];
  id<MTLBlitCommandEncoder> blit = [commands blitCommandEncoder];
  [blit copyFromTexture:texture
                   sourceSlice:0
                   sourceLevel:0
                  sourceOrigin:MTLOriginMake(0, 0, 0)
                    sourceSize:MTLSizeMake(width, height, 1)
                      toBuffer:buffer
             destinationOffset:0
        destinationBytesPerRow:bytesPerRow
      destinationBytesPerImage:bytesPerRow * height];
  [blit endEncoding];
  [commands commit];
  [commands waitUntilCompleted];
  return readPattern((const uint8_t*)buffer.contents, bytesPerRow, (int)width,
                     (int)height);
}

/** A texture drawing the index, as Skia would hand one to the encoder. */
id<MTLTexture> patternTexture(int width, int height, int index) {
  id<MTLDevice> device = [MTLTextureUtils device];
  NSUInteger bytesPerRow = width * 4;
  id<MTLBuffer> buffer =
      [device newBufferWithLength:bytesPerRow * height
                          options:MTLResourceStorageModeShared];
  fillPattern((uint8_t*)buffer.contents, bytesPerRow, width, height, index);
  MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                   width:width
                                  height:height
                               mipmapped:NO];
  descriptor.storageMode = MTLStorageModePrivate;
  descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
  id<MTLTexture> texture = [device newTextureWithDescriptor:descriptor];
  id<MTLCommandBuffer> commands = [readbackQueue() commandBuffer];
  id<MTLBlitCommandEncoder> blit = [commands blitCommandEncoder];
  [blit copyFromBuffer:buffer
             sourceOffset:0
        sourceBytesPerRow:bytesPerRow
      sourceBytesPerImage:bytesPerRow * height
               sourceSize:MTLSizeMake(width, height, 1)
                toTexture:texture
         destinationSlice:0
         destinationLevel:0
        destinationOrigin:MTLOriginMake(0, 0, 0)];
  [blit endEncoding];
  [commands commit];
  [commands waitUntilCompleted];
  return texture;
}

#pragma mark - Compositions

struct Clip {
  std::string id;
  double compositionStart;
  double start;
  double duration;

  double end() const { return compositionStart + duration; }
  bool covers(double t) const { return t >= compositionStart && t < end(); }
  /** The index of the file frame shown at composition time t. */
  int frameAt(double t, int fps) const {
    double source = start + std::max(t - compositionStart, 0.0);
    return (int)floor(source * fps + 1e-6);
  }
};

/** Three 2 s clips back to back, each from a different part of the file. */
const std::vector<Clip> kMontage = {
    {"a", 0, 0, 2},
    {"b", 2, 1, 2},
    {"c", 4, 2, 2},
};

const Clip* clipAt(const std::vector<Clip>& clips, double t) {
  for (const auto& clip : clips) {
    if (clip.covers(t)) {
      return &clip;
    }
  }
  return nullptr;
}

std::shared_ptr<VideoCompositionItem> makeItem(NSString* path,
                                               const Clip& clip) {
  auto item = std::make_shared<VideoCompositionItem>();
  item->id = clip.id;
  item->path = path.UTF8String;
  item->compositionStartTime = clip.compositionStart;
  item->startTime = clip.start;
  item->duration = clip.duration;
  item->resolution = CGSizeZero;
  return item;
}

std::shared_ptr<VideoComposition>
makeComposition(NSString* path, const std::vector<Clip>& clips, bool lazy) {
  auto composition = std::make_shared<VideoComposition>();
  composition->duration = 0;
  composition->lazyDecoders = lazy;
  for (const auto& clip : clips) {
    composition->items.push_back(makeItem(path, clip));
    composition->duration = std::max(composition->duration, clip.end());
  }
  return composition;
}

CMTime seconds(double t) { return CMTimeMakeWithSeconds(t, NSEC_PER_SEC); }

/** Runs the block on another thread; false when it has not returned in time. */
bool finishesWithin(double timeout, void (^block)(void)) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    block();
    dispatch_semaphore_signal(done);
  });
  return dispatch_semaphore_wait(
             done, dispatch_time(DISPATCH_TIME_NOW,
                                 (int64_t)(timeout * NSEC_PER_SEC))) == 0;
}

/** Queues the events the host objects emit; the test thread runs them. */
class TestCallInvoker : public react::CallInvoker {
public:
  using react::CallInvoker::invokeAsync;
  using react::CallInvoker::invokeSync;
  void invokeAsync(react::CallFunc&& func) noexcept override {
    std::lock_guard<std::mutex> guard(mutex);
    queue.push_back(std::move(func));
  }
  void invokeSync(react::CallFunc&& func) override {
    std::lock_guard<std::mutex> guard(mutex);
    queue.push_back(std::move(func));
  }
  void drain(jsi::Runtime& runtime) {
    std::vector<react::CallFunc> pending;
    {
      std::lock_guard<std::mutex> guard(mutex);
      pending.swap(queue);
    }
    for (auto& func : pending) {
      func(runtime);
    }
  }
  void clear() {
    std::lock_guard<std::mutex> guard(mutex);
    queue.clear();
  }

private:
  std::mutex mutex;
  std::vector<react::CallFunc> queue;
};

} // namespace

#pragma mark - Base

/** What JS sees of a frame. */
struct FrameView {
  double width = 0;
  double height = 0;
  int rotation = 0;
  id<MTLTexture> texture = nil;
  int index = -1;
};

@interface NativeVideoTestCase : XCTestCase {
@protected
  std::unique_ptr<jsi::Runtime> runtime;
}
@end

@implementation NativeVideoTestCase

- (void)setUp {
  [super setUp];
  self.continueAfterFailure = NO;
  runtime = facebook::hermes::makeHermesRuntime();
}

- (void)tearDown {
  runtime.reset();
  [super tearDown];
}

- (NSString*)video:(const VideoSpec&)spec {
  NSString* failure = nil;
  NSString* path = testVideo(spec, &failure);
  XCTAssertNotNil(path, @"could not write %@: %@", spec.key(), failure);
  return path;
}

- (FrameView)viewOfObject:(const jsi::Object&)object {
  jsi::Runtime& rt = *runtime;
  FrameView view;
  view.width = object.getProperty(rt, "width").asNumber();
  view.height = object.getProperty(rt, "height").asNumber();
  view.rotation = (int)object.getProperty(rt, "rotation").asNumber();
  auto texture = object.getProperty(rt, "texture");
  if (texture.isObject()) {
    uint64_t pointer = texture.asObject(rt)
                           .getProperty(rt, "mtlTexture")
                           .asBigInt(rt)
                           .asUint64(rt);
    view.texture = (__bridge id<MTLTexture>)(void*)pointer;
    view.index = textureIndex(view.texture);
  }
  return view;
}

- (FrameView)view:(const std::shared_ptr<VideoFrame>&)frame {
  return
      [self viewOfObject:jsi::Object::createFromHostObject(*runtime, frame)];
}

/** Every frame of the frames object, by item id. */
- (std::map<std::string, FrameView>)framesOf:(const jsi::Value&)value {
  jsi::Runtime& rt = *runtime;
  std::map<std::string, FrameView> frames;
  auto object = value.asObject(rt);
  auto names = object.getPropertyNames(rt);
  for (size_t i = 0; i < names.size(rt); i++) {
    auto name = names.getValueAtIndex(rt, i).asString(rt).utf8(rt);
    frames[name] = [self viewOfObject:object.getProperty(rt, name.c_str())
                                          .asObject(rt)];
  }
  return frames;
}

@end

#pragma mark - DecoderWindow

@interface DecoderWindowTests : XCTestCase
@end

@implementation DecoderWindowTests

- (void)testSameCasesAsTheHostTest {
  DecoderWindow eager(false, true);
  DecoderWindow preview(true, true);
  DecoderWindow exportWindow(true, false);
  const double duration = 60;

  XCTAssertTrue(eager.opens(10, 20, 50, duration, false), "eager opens");
  XCTAssertTrue(eager.keeps(10, 20, 50, duration, false), "eager keeps");
  XCTAssertTrue(preview.opens(10, 20, 8.5, duration, false), "1.5s ahead");
  XCTAssertFalse(preview.opens(10, 20, 8.4, duration, false), "1.6s ahead");
  XCTAssertFalse(preview.opens(10, 20, 20, duration, false), "at its end");
  XCTAssertTrue(preview.keeps(10, 20, 20.4, duration, false), "0.4s past");
  XCTAssertFalse(preview.keeps(10, 20, 20.5, duration, false), "0.5s past");
  XCTAssertFalse(preview.keeps(10, 20, 7.99, duration, false),
                 "before lead and margin");
  XCTAssertTrue(exportWindow.opens(10, 20, 9.5, duration, false),
                "export 0.5s ahead");
  XCTAssertFalse(exportWindow.opens(10, 20, 9.4, duration, false),
                 "export 0.6s ahead");
  XCTAssertTrue(preview.opens(0, 5, 59, duration, true),
                "looping opens the first item near the end");
  XCTAssertFalse(preview.opens(0, 5, 59, duration, false),
                 "not without looping");
  XCTAssertTrue(eager.opens(0, 5, 59, duration, false) && !eager.isLazy() &&
                preview.isLazy());
}

- (void)testOpensImpliesKeeps {
  DecoderWindow preview(true, true);
  DecoderWindow exportWindow(true, false);
  std::mt19937 random(1);
  std::uniform_real_distribution<double> unit(0, 1);
  for (int i = 0; i < 200000; i++) {
    double start = unit(random) * 55;
    double end = start + 0.5 + unit(random) * 10;
    double position = unit(random) * 62 - 1;
    bool looping = unit(random) < 0.5;
    for (auto* window : {&preview, &exportWindow}) {
      if (window->opens(start, end, position, 60, looping) &&
          !window->keeps(start, end, position, 60, looping)) {
        XCTFail(@"opens but not keeps: [%f, %f) at %f", start, end, position);
        return;
      }
    }
  }
}

@end

#pragma mark - VideoCompositionItemDecoder, export

@interface ItemDecoderExportTests : NativeVideoTestCase
@end

@implementation ItemDecoderExportTests

/** Every frame of the clip, asked for as the export extractor asks. */
- (void)walkClip:(const Clip&)clip spec:(const VideoSpec&)spec {
  NSString* path = [self video:spec];
  auto decoder =
      std::make_shared<VideoCompositionItemDecoder>(makeItem(path, clip), false);
  bool hasFrame = false;
  int shown = -1;
  int frames = (int)llround(clip.duration * spec.fps);
  for (int i = 0; i < frames; i++) {
    double t = clip.compositionStart + i / (double)spec.fps;
    decoder->advanceDecoder(seconds(t));
    auto frame = decoder->acquireFrameForTime(seconds(t), !hasFrame);
    if (frame) {
      hasFrame = true;
      shown = [self view:frame].index;
    }
    XCTAssertEqual(shown, clip.frameAt(t, spec.fps), @"%s at %.4fs",
                   clip.id.c_str(), t);
  }
  decoder->release();
}

- (void)testEveryFrameOfASingleItem {
  [self walkClip:{"a", 0, 0, 6} spec:VideoSpec()];
}

- (void)testEveryFrameOfAMontage {
  for (const auto& clip : kMontage) {
    [self walkClip:clip spec:VideoSpec()];
  }
}

- (void)testAnItemWithoutFramesInItsRangeDoesNotHang {
  NSString* path = [self video:VideoSpec()];
  auto decoder = std::make_shared<VideoCompositionItemDecoder>(
      makeItem(path, {"gone", 0, 20, 2}), false);
  __block std::shared_ptr<VideoFrame> frame;
  XCTAssertTrue(finishesWithin(10, ^{
    decoder->advanceDecoder(seconds(0.5));
    frame = decoder->acquireFrameForTime(seconds(0.5), true);
  }));
  XCTAssertTrue(frame == nullptr);
  decoder->release();
}

// Regression: a reader positioned past the item's end asked AVAssetReader for
// a negative duration.
- (void)testOpeningAndSeekingPastTheEndOfAnItem {
  NSString* path = [self video:VideoSpec()];
  Clip clip{"b", 2, 1, 2};
  auto item = makeItem(path, clip);
  __block std::shared_ptr<VideoCompositionItemDecoder> decoder;
  XCTAssertNoThrow(decoder = std::make_shared<VideoCompositionItemDecoder>(
                       item, false, nil, seconds(5)));
  XCTAssertTrue(finishesWithin(10, ^{
    decoder->advanceDecoder(seconds(5));
    decoder->acquireFrameForTime(seconds(5), true);
  }));
  XCTAssertNoThrow(decoder->seekTo(seconds(9)));
  XCTAssertTrue(finishesWithin(10, ^{
    decoder->advanceDecoder(seconds(9));
    decoder->acquireFrameForTime(seconds(9), true);
  }));
  // And back into the item: the right frame again.
  decoder->seekTo(seconds(2.5));
  decoder->advanceDecoder(seconds(2.5));
  auto frame = decoder->acquireFrameForTime(seconds(2.5), true);
  XCTAssertTrue(frame != nullptr);
  XCTAssertEqual([self view:frame].index, clip.frameAt(2.5, 30));
  decoder->release();
}

- (void)testReleaseFreesTheDecoder {
  NSString* path = [self video:VideoSpec()];
  auto item = makeItem(path, {"a", 0, 0, 6});
  item->directTexture = true;
  auto decoder = std::make_shared<VideoCompositionItemDecoder>(item, false);
  decoder->advanceDecoder(seconds(1));
  auto frame = decoder->acquireFrameForTime(seconds(1), true);
  XCTAssertTrue(frame != nullptr);
  XCTAssertEqual([self view:frame].index, 30);
  decoder->release();
  // The frame JS may still hold lost its pixels.
  XCTAssertNil([self view:frame].texture);
  // Nothing more comes out of a released decoder, and it does not throw.
  decoder->advanceDecoder(seconds(2));
  XCTAssertTrue(decoder->acquireFrameForTime(seconds(2), true) == nullptr);
  decoder->release();

  // Many decoders opened and released: no reader, buffer or texture left
  // behind to run the process out of memory.
  for (int round = 0; round < 40; round++) {
    @autoreleasepool {
      auto d = std::make_shared<VideoCompositionItemDecoder>(
          makeItem(path, kMontage[round % 3]), round % 2 == 0);
      double t = kMontage[round % 3].compositionStart + 0.5;
      d->advanceDecoder(seconds(t));
      auto f = d->acquireFrameForTime(seconds(t), true);
      XCTAssertEqual([self view:f].index, kMontage[round % 3].frameAt(t, 30));
      d->release();
    }
  }
}

// The export's ring is one deep: the previous frame loses its texture when
// the next one is handed out, since the export flushed it already.
- (void)testDirectFramesAreRetiredOneByOneInExport {
  NSString* path = [self video:VideoSpec()];
  auto item = makeItem(path, {"a", 0, 0, 6});
  item->directTexture = true;
  auto decoder = std::make_shared<VideoCompositionItemDecoder>(item, false);
  std::vector<std::shared_ptr<VideoFrame>> frames;
  for (int i = 0; i < 4; i++) {
    decoder->advanceDecoder(seconds(i / 30.0));
    frames.push_back(decoder->acquireFrameForTime(seconds(i / 30.0), true));
  }
  for (int i = 0; i < 3; i++) {
    XCTAssertNil([self view:frames[i]].texture, @"frame %d", i);
  }
  XCTAssertEqual([self view:frames[3]].index, 3);
  decoder->release();
}

@end

#pragma mark - VideoCompositionItemDecoder, preview

@interface ItemDecoderPreviewTests : NativeVideoTestCase
@end

@implementation ItemDecoderPreviewTests {
  std::shared_ptr<VideoCompositionItemDecoder> decoder;
  bool hasFrame;
  int shown;
}

- (void)tearDown {
  if (decoder) {
    decoder->release();
    decoder = nullptr;
  }
  [super tearDown];
}

- (void)open:(const Clip&)clip spec:(const VideoSpec&)spec {
  NSString* path = [self video:spec];
  decoder =
      std::make_shared<VideoCompositionItemDecoder>(makeItem(path, clip), true);
  hasFrame = false;
  shown = -1;
}

/** One vsync: the decoder thread advances, then the UI thread draws. */
- (int)tick:(double)t {
  decoder->advanceDecoder(seconds(t));
  auto frame = decoder->acquireFrameForTime(seconds(t), !hasFrame);
  if (frame) {
    hasFrame = true;
    shown = [self view:frame].index;
  }
  return shown;
}

/** As the extractor seeks: the decoder is told, then the next vsync. */
- (int)seek:(double)t {
  decoder->seekTo(seconds(t));
  return [self tick:t];
}

- (void)playClip:(const Clip&)clip spec:(const VideoSpec&)spec {
  [self open:clip spec:spec];
  for (double t = clip.compositionStart; t < clip.end() - 1e-9;
       t += 1 / 60.0) {
    XCTAssertEqual([self tick:t], clip.frameAt(t, spec.fps), @"%s at %.4fs",
                   clip.id.c_str(), t);
  }
}

- (void)testPlayThroughAtSixtyHertz {
  [self playClip:{"a", 0, 0, 6} spec:VideoSpec()];
}

- (void)testPlayThroughEveryItemOfAMontage {
  for (const auto& clip : kMontage) {
    [self playClip:clip spec:VideoSpec()];
  }
}

- (void)testSeeks {
  Clip clip{"a", 0, 0, 6};
  [self open:clip spec:VideoSpec()];
  [self tick:0];
  XCTAssertEqual([self seek:4.5], 135, "forward");
  XCTAssertEqual([self seek:1.0], 30, "backward");
  XCTAssertEqual([self seek:1.37], clip.frameAt(1.37, 30), "between frames");
  XCTAssertEqual([self seek:3.99], clip.frameAt(3.99, 30),
                 "just before a key frame");
  XCTAssertEqual([self seek:5.98], 179, "near the end");
  // Past the end: no hang, no throw, and back into the clip afterwards.
  ItemDecoderPreviewTests* this_ = self;
  XCTAssertTrue(finishesWithin(10, ^{
    [this_ seek:7.0];
    [this_ tick:7.1];
  }));
  XCTAssertEqual([self seek:2.0], 60, "back from past the end");
  // And it plays on from the seek.
  for (double t = 2.0; t < 2.5; t += 1 / 60.0) {
    XCTAssertEqual([self tick:t], clip.frameAt(t, 30), @"at %.4fs", t);
  }
}

- (void)testSeekIntoTheMiddleOfAMontageItem {
  Clip clip = kMontage[1];
  [self open:clip spec:VideoSpec()];
  [self tick:0];
  XCTAssertEqual([self seek:2.5], clip.frameAt(2.5, 30));
  XCTAssertEqual([self seek:3.9], clip.frameAt(3.9, 30));
  // Before its start, an item holds its first frame.
  XCTAssertEqual([self seek:0.5], clip.frameAt(2.0, 30));
}

- (void)testAScrubSettlesOnTheRightFrame {
  Clip clip{"a", 0, 0, 6};
  [self open:clip spec:VideoSpec()];
  std::mt19937 random(7);
  std::uniform_real_distribution<double> unit(0, 6);
  for (int i = 0; i < 60; i++) {
    double t = unit(random);
    decoder->seekTo(seconds(t));
    if (i % 3 == 0) {
      // Some seeks see a vsync, most are replaced before one.
      [self tick:t];
    }
  }
  XCTAssertEqual([self seek:4.2], 126);
  for (double t = 4.2; t < 4.6; t += 1 / 60.0) {
    XCTAssertEqual([self tick:t], clip.frameAt(t, 30), @"at %.4fs", t);
  }
}

// Near the end the decoder reads the start again, so the frame after the
// wrap is ready.
- (void)testALoopWrapsToTheFirstFrame {
  for (const auto& clip : std::vector<Clip>{{"a", 0, 0, 2}, {"b", 0, 1, 2}}) {
    [self open:clip spec:VideoSpec()];
    for (int loop = 0; loop < 3; loop++) {
      for (double t = 0; t < 2 - 1e-9; t += 1 / 60.0) {
        XCTAssertEqual([self tick:t], clip.frameAt(t, 30),
                       @"%s loop %d at %.4fs", clip.id.c_str(), loop, t);
      }
    }
    decoder->release();
  }
}

// The preview keeps four frames alive for the GPU work still in flight.
- (void)testDirectFramesAreRetiredAfterFourInPreview {
  NSString* path = [self video:VideoSpec()];
  auto item = makeItem(path, {"a", 0, 0, 6});
  item->directTexture = true;
  decoder = std::make_shared<VideoCompositionItemDecoder>(item, true);
  std::vector<std::shared_ptr<VideoFrame>> frames;
  for (int i = 0; i < 7; i++) {
    decoder->advanceDecoder(seconds(i / 30.0));
    frames.push_back(decoder->acquireFrameForTime(seconds(i / 30.0), true));
    XCTAssertTrue(frames.back() != nullptr);
  }
  for (int i = 0; i < 7; i++) {
    FrameView view = [self view:frames[i]];
    if (i < 3) {
      XCTAssertNil(view.texture, @"frame %d", i);
    } else {
      XCTAssertEqual(view.index, i);
    }
  }
}

@end

#pragma mark - Different media

@interface MediaTests : NativeVideoTestCase
@end

@implementation MediaTests

- (FrameView)frameOf:(NSString*)path
                  at:(double)t
           customize:(void (^)(VideoCompositionItem*))customize {
  auto item = makeItem(path, {"a", 0, 0, 1});
  if (customize) {
    customize(item.get());
  }
  auto decoder = std::make_shared<VideoCompositionItemDecoder>(item, false);
  decoder->advanceDecoder(seconds(t));
  auto frame = decoder->acquireFrameForTime(seconds(t), true);
  XCTAssertTrue(frame != nullptr);
  FrameView view = [self view:frame];
  decoder->release();
  return view;
}

- (void)checkSpec:(const VideoSpec&)spec {
  NSString* path = [self video:spec];
  auto decoder = std::make_shared<VideoCompositionItemDecoder>(
      makeItem(path, {"a", 0, 0, spec.seconds}), false);
  bool hasFrame = false;
  for (int i = 0; i < spec.frames(); i++) {
    double t = i / (double)spec.fps;
    decoder->advanceDecoder(seconds(t));
    auto frame = decoder->acquireFrameForTime(seconds(t), !hasFrame);
    XCTAssertTrue(frame != nullptr, @"no frame %d", i);
    hasFrame = true;
    FrameView view = [self view:frame];
    XCTAssertEqual(view.index, i);
    XCTAssertEqual(view.width, spec.width);
    XCTAssertEqual(view.height, spec.height);
    XCTAssertEqual(view.rotation, spec.rotation);
    XCTAssertEqual(view.texture.width, (NSUInteger)spec.width);
    XCTAssertEqual(view.texture.height, (NSUInteger)spec.height);
  }
  decoder->release();
}

- (void)test1080p {
  VideoSpec spec;
  spec.width = 1920;
  spec.height = 1080;
  spec.seconds = 1;
  [self checkSpec:spec];
}

- (void)test4K {
  VideoSpec spec;
  spec.width = 3840;
  spec.height = 2160;
  spec.seconds = 1;
  [self checkSpec:spec];
}

- (void)test60fps {
  VideoSpec spec;
  spec.fps = 60;
  spec.seconds = 2;
  [self checkSpec:spec];
}

- (void)testOddDimensions {
  VideoSpec spec;
  spec.width = 1279;
  spec.height = 719;
  spec.seconds = 1;
  NSString* failure = nil;
  if (!testVideo(spec, &failure)) {
    XCTSkip(@"the simulator cannot write 1279x719: %@", failure);
  }
  [self checkSpec:spec];
}

- (void)testHEVC {
  VideoSpec spec;
  spec.width = 1920;
  spec.height = 1080;
  spec.seconds = 1;
  spec.codec = AVVideoCodecTypeHEVC;
  NSString* failure = nil;
  if (!testVideo(spec, &failure)) {
    XCTSkip(@"the simulator cannot write HEVC: %@", failure);
  }
  [self checkSpec:spec];
}

// A portrait clip is a landscape frame plus a rotation: the frame keeps the
// encoded size and says how to turn it.
- (void)testRotated {
  VideoSpec spec;
  spec.width = 640;
  spec.height = 360;
  spec.seconds = 1;
  spec.rotation = 90;
  [self checkSpec:spec];
}

- (void)testMaxLongSideCapsTheDecodedSize {
  VideoSpec spec;
  spec.width = 3840;
  spec.height = 2160;
  spec.seconds = 1;
  NSString* path = [self video:spec];
  FrameView view = [self frameOf:path
                              at:0.5
                       customize:^(VideoCompositionItem* item) {
                         item->maxLongSide = 1280;
                       }];
  XCTAssertEqual(view.width, 1280);
  XCTAssertEqual(view.height, 720);
  XCTAssertEqual(view.texture.width, 1280u);
  XCTAssertEqual(view.texture.height, 720u);
  XCTAssertEqual(view.index, 15);

  // A cap above the file's own size leaves it alone.
  view = [self frameOf:[self video:VideoSpec()]
                    at:0.5
             customize:^(VideoCompositionItem* item) {
               item->maxLongSide = 1280;
             }];
  XCTAssertEqual(view.width, 320);
  XCTAssertEqual(view.height, 240);
}

// Resolved on the encoded size: a rotated clip keeps its aspect.
- (void)testMaxLongSideOnARotatedClip {
  VideoSpec spec;
  spec.width = 640;
  spec.height = 360;
  spec.seconds = 1;
  spec.rotation = 90;
  FrameView view = [self frameOf:[self video:spec]
                              at:0.5
                       customize:^(VideoCompositionItem* item) {
                         item->maxLongSide = 320;
                       }];
  XCTAssertEqual(view.width, 320);
  XCTAssertEqual(view.height, 180);
  XCTAssertEqual(view.rotation, 90);
  XCTAssertEqual(view.index, 15);
}

- (void)testAnExplicitResolutionWins {
  VideoSpec spec;
  spec.width = 1920;
  spec.height = 1080;
  spec.seconds = 1;
  FrameView view = [self frameOf:[self video:spec]
                              at:0.5
                       customize:^(VideoCompositionItem* item) {
                         item->resolution = CGSizeMake(480, 270);
                         item->maxLongSide = 1280;
                       }];
  XCTAssertEqual(view.width, 480);
  XCTAssertEqual(view.height, 270);
  XCTAssertEqual(view.index, 15);
}

/**
 * The 6 s test video with its second second slowed down 4x through the
 * track's edits, as an iPhone slow-motion clip: 9 s of presentation.
 */
- (NSString*)slowMotionVideo {
  NSString* source = [self video:VideoSpec()];
  NSString* path =
      [testDirectory() stringByAppendingPathComponent:@"slow-motion.mov"];
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
  NSURL* url = [NSURL fileURLWithPath:path];
  AVMutableMovie* movie =
      [AVMutableMovie movieWithURL:[NSURL fileURLWithPath:source]
                           options:nil
                             error:nil];
  AVMutableMovieTrack* track =
      [movie tracksWithMediaType:AVMediaTypeVideo].firstObject;
  [track scaleTimeRange:CMTimeRangeMake(CMTimeMake(1, 1), CMTimeMake(1, 1))
             toDuration:CMTimeMake(4, 1)];
  movie.defaultMediaDataStorage = [[AVMediaDataStorage alloc] initWithURL:url
                                                                  options:nil];
  NSError* error = nil;
  XCTAssertTrue([movie writeMovieHeaderToURL:url
                                    fileType:AVFileTypeQuickTimeMovie
                                     options:AVMovieWritingAddMovieHeaderToDestination
                                       error:&error],
                @"%@", error);
  return path;
}

/** The file frame shown at presentation time t of the slow-motion video. */
static int slowMotionFrameAt(double t) {
  if (t < 1) {
    return (int)floor(t * 30 + 1e-6);
  }
  if (t < 5) {
    return 30 + (int)floor((t - 1) * 30 / 4 + 1e-6);
  }
  return 60 + (int)floor((t - 5) * 30 + 1e-6);
}

- (void)testSlowMotionIsDecodedInThePresentationTimeline {
  NSString* path = [self slowMotionVideo];
  AVURLAsset* asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path]
                                          options:nil];
  XCTAssertEqualWithAccuracy(CMTimeGetSeconds(asset.duration), 9, 0.05);
  Clip clip{"slow", 0, 0, 9};
  auto decoder =
      std::make_shared<VideoCompositionItemDecoder>(makeItem(path, clip), false);
  bool hasFrame = false;
  int shown = -1;
  for (int i = 0; i < 9 * 30; i++) {
    double t = i / 30.0;
    decoder->advanceDecoder(seconds(t));
    auto frame = decoder->acquireFrameForTime(seconds(t), !hasFrame);
    if (frame) {
      hasFrame = true;
      shown = [self view:frame].index;
    }
    XCTAssertEqual(shown, slowMotionFrameAt(t), @"at %.4fs", t);
  }
  decoder->release();
}

- (void)testDirectTextureMode {
  FrameView view = [self frameOf:[self video:VideoSpec()]
                              at:0.5
                       customize:^(VideoCompositionItem* item) {
                         item->directTexture = true;
                       }];
  XCTAssertEqual(view.index, 15);
}

@end

#pragma mark - Export extractor (JSI)

@interface ExportExtractorTests : NativeVideoTestCase
@end

@implementation ExportExtractorTests {
  std::vector<std::shared_ptr<VideoCompositionFramesExtractorSyncHostObject>>
      extractors;
}

- (void)tearDown {
  for (auto& extractor : extractors) {
    extractor->release();
  }
  extractors.clear();
  [super tearDown];
}

- (std::shared_ptr<VideoCompositionFramesExtractorSyncHostObject>)start:
    (std::shared_ptr<VideoComposition>)composition {
  auto extractor =
      std::make_shared<VideoCompositionFramesExtractorSyncHostObject>(
          composition);
  extractors.push_back(extractor);
  jsi::Runtime& rt = *runtime;
  jsi::Object object = jsi::Object::createFromHostObject(rt, extractor);
  object.getPropertyAsFunction(rt, "start").call(rt);
  return extractor;
}

- (std::map<std::string, FrameView>)
    decode:(const std::shared_ptr<VideoCompositionFramesExtractorSyncHostObject>&)
               extractor
        at:(double)t {
  __block std::map<std::string, FrameView> frames;
  ExportExtractorTests* this_ = self;
  __block auto host = extractor;
  bool finished = finishesWithin(10, ^{
    jsi::Runtime& r = *this_->runtime;
    jsi::Object object = jsi::Object::createFromHostObject(r, host);
    auto value =
        object.getPropertyAsFunction(r, "decodeCompositionFrames").call(r, t);
    frames = [this_ framesOf:value];
  });
  XCTAssertTrue(finished, @"no frames for %.3fs after 10 s: the export hangs",
                t);
  return frames;
}

- (void)walk:(const std::vector<Clip>&)clips lazy:(bool)lazy {
  auto composition = makeComposition([self video:VideoSpec()], clips, lazy);
  auto extractor = [self start:composition];
  int frames = (int)llround(composition->duration * 30);
  size_t maxOpen = 0;
  for (int i = 0; i < frames; i++) {
    double t = i / 30.0;
    auto decoded = [self decode:extractor at:t];
    const Clip* clip = clipAt(clips, t);
    XCTAssertTrue(clip != nullptr);
    XCTAssertTrue(decoded.count(clip->id), @"%s has no frame at %.3fs",
                  clip->id.c_str(), t);
    XCTAssertEqual(decoded[clip->id].index, clip->frameAt(t, 30),
                   @"%s at %.4fs", clip->id.c_str(), t);
    maxOpen = std::max(maxOpen, extractor->itemDecoders.size());
    if (lazy) {
      for (const auto& other : clips) {
        if (!extractor->itemDecoders.count(other.id)) {
          XCTAssertFalse(decoded.count(other.id),
                         @"%s is closed but has a frame at %.3fs",
                         other.id.c_str(), t);
        }
      }
    }
  }
  if (lazy) {
    // A cut: the item before, kept 0.5 s past its end, and the one after,
    // opened 0.5 s ahead.
    XCTAssertLessThanOrEqual(maxOpen, 2u);
  } else {
    XCTAssertEqual(maxOpen, clips.size());
  }
}

- (void)testASingleItemGivesItsFrameAtEveryTime {
  [self walk:{{"a", 0, 0, 6}} lazy:false];
}

- (void)testAMontageGivesEachItemItsFrame {
  [self walk:kMontage lazy:false];
}

- (void)testALazyMontageGivesTheSameFramesWithFewerDecoders {
  [self walk:kMontage lazy:true];
}

- (void)testAnItemWithoutFramesDoesNotHoldTheExport {
  Clip present{"present", 0, 0, 2};
  Clip gone{"gone", 0, 20, 2};
  auto extractor = [self
      start:makeComposition([self video:VideoSpec()], {present, gone}, false)];
  auto frames = [self decode:extractor at:0.5];
  XCTAssertEqual(frames["present"].index, present.frameAt(0.5, 30));
  XCTAssertFalse(frames.count("gone"));
}

- (void)testMaxLongSideSizesTheFrame {
  auto composition =
      makeComposition([self video:VideoSpec()], {{"a", 0, 0, 2}}, false);
  composition->items[0]->maxLongSide = 160;
  auto frames = [self decode:[self start:composition] at:0.5];
  XCTAssertEqual(frames["a"].width, 160);
  XCTAssertEqual(frames["a"].height, 120);
  XCTAssertEqual(frames["a"].index, 15);
}

- (void)testDisposeLeavesNoDecoderBehind {
  jsi::Runtime& rt = *runtime;
  for (int round = 0; round < 30; round++) {
    bool lazy = round % 2 == 1;
    auto extractor =
        [self start:makeComposition([self video:VideoSpec()], kMontage, lazy)];
    XCTAssertEqual([self decode:extractor at:0.5]["a"].index, 15);
    XCTAssertEqual([self decode:extractor at:4.5]["c"].index, 75);
    jsi::Object::createFromHostObject(rt, extractor)
        .getPropertyAsFunction(rt, "dispose")
        .call(rt);
    XCTAssertTrue(extractor->itemDecoders.empty());
    XCTAssertTrue(extractor->currentFrames.empty());
  }
}

@end

#pragma mark - Preview extractor (JSI)

@interface PreviewExtractorTests : NativeVideoTestCase
@end

@implementation PreviewExtractorTests {
  std::shared_ptr<TestCallInvoker> invoker;
  std::shared_ptr<VideoComposition> composition;
  std::shared_ptr<VideoCompositionFramesExtractorHostObject> extractor;
  std::vector<std::string> errors;
  bool ready;
}

- (void)setUp {
  [super setUp];
  invoker = std::make_shared<TestCallInvoker>();
  errors.clear();
  ready = false;
}

- (void)tearDown {
  if (extractor) {
    extractor->release();
    // Waits for the decoder queue.
    extractor = nullptr;
  }
  invoker->clear();
  XCTAssertTrue(errors.empty(), @"decoder errors: %s",
                errors.empty() ? "" : errors[0].c_str());
  [super tearDown];
}

- (jsi::Object)object {
  return jsi::Object::createFromHostObject(*runtime, extractor);
}

- (void)call:(const char*)name {
  [self object].getPropertyAsFunction(*runtime, name).call(*runtime);
}

- (void)open:(bool)lazy {
  [self open:lazy clips:kMontage beforeReady:nil];
}

- (void)open:(bool)lazy
          clips:(const std::vector<Clip>&)clips
    beforeReady:(void (^)(void))beforeReady {
  jsi::Runtime& rt = *runtime;
  composition = makeComposition([self video:VideoSpec()], clips, lazy);
  extractor = std::make_shared<VideoCompositionFramesExtractorHostObject>(
      rt, invoker, composition);
  PreviewExtractorTests* this_ = self;
  auto on = [self object].getPropertyAsFunction(rt, "on");
  on.call(rt, jsi::String::createFromAscii(rt, "ready"),
          jsi::Function::createFromHostFunction(
              rt, jsi::PropNameID::forAscii(rt, "ready"), 0,
              [this_](jsi::Runtime&, const jsi::Value&, const jsi::Value*,
                      size_t) {
                this_->ready = true;
                return jsi::Value::undefined();
              }));
  on.call(rt, jsi::String::createFromAscii(rt, "error"),
          jsi::Function::createFromHostFunction(
              rt, jsi::PropNameID::forAscii(rt, "error"), 1,
              [this_](jsi::Runtime& r, const jsi::Value&,
                      const jsi::Value* args, size_t) {
                this_->errors.push_back(
                    args[0].asObject(r).getProperty(r, "message").toString(r).utf8(
                        r));
                return jsi::Value::undefined();
              }));
  if (beforeReady) {
    beforeReady();
  }
  [self call:"prepare"];
  [self waitFor:^BOOL {
    return this_->ready;
  } what:@"ready"];
}

/** Lets the display link and the decoder queue run, and delivers events. */
- (void)spin:(double)duration {
  NSDate* until = [NSDate dateWithTimeIntervalSinceNow:duration];
  do {
    [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode
                          beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    invoker->drain(*runtime);
  } while ([until timeIntervalSinceNow] > 0);
}

- (void)waitFor:(BOOL (^)(void))condition what:(NSString*)what {
  NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!condition()) {
    if ([deadline timeIntervalSinceNow] < 0) {
      XCTFail(@"timed out waiting for %@", what);
      return;
    }
    [self spin:0.005];
  }
}

- (std::map<std::string, FrameView>)pump {
  jsi::Runtime& rt = *runtime;
  auto value =
      [self object].getPropertyAsFunction(rt, "decodeCompositionFrames").call(rt);
  return [self framesOf:value];
}

- (double)currentTime {
  return [self object].getProperty(*runtime, "currentTime").asNumber();
}

- (size_t)openCount {
  @synchronized(extractor->lock) {
    return extractor->itemDecoders.size();
  }
}

- (void)seek:(double)t {
  [self object].getPropertyAsFunction(*runtime, "seekTo").call(*runtime, t);
}

/** Paused after a seek: the exact frame, within 3 s. */
- (void)awaitFrame:(const Clip&)clip at:(double)t {
  NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:3];
  int last = -2;
  while ([deadline timeIntervalSinceNow] > 0) {
    auto frames = [self pump];
    if (frames.count(clip.id)) {
      last = frames[clip.id].index;
      if (last == clip.frameAt(t, 30)) {
        return;
      }
    }
    [self spin:0.01];
  }
  XCTFail(@"%s at %.3fs shows frame %d, expected %d", clip.id.c_str(), t, last,
          clip.frameAt(t, 30));
}

- (void)playThrough:(size_t)maxOpenAllowed allOpen:(bool)allOpen {
  [self call:"play"];
  int checks = 0;
  size_t maxOpen = 0;
  // Playing: the frame lags the clock by a vsync, a queue hop and a slow
  // simulator.
  const int slackFrames = 8;
  while ([self currentTime] < composition->duration - 0.1) {
    auto frames = [self pump];
    double t = [self currentTime];
    const Clip* clip = clipAt(kMontage, t);
    // Clear of the cut, where "on screen" depends on which thread looked.
    if (clip && t - clip->compositionStart > 0.3 && clip->end() - t > 0.1) {
      XCTAssertTrue(frames.count(clip->id), @"%s has no frame at %.3fs",
                    clip->id.c_str(), t);
      int expected = clip->frameAt(t, 30);
      int index = frames[clip->id].index;
      XCTAssertTrue(index <= expected && index >= expected - slackFrames,
                    @"%s at %.3fs shows %d, expected about %d", clip->id.c_str(),
                    t, index, expected);
      checks++;
    }
    maxOpen = std::max(maxOpen, [self openCount]);
    [self spin:0.016];
  }
  XCTAssertGreaterThan(checks, 50);
  XCTAssertLessThanOrEqual(maxOpen, maxOpenAllowed);
  if (allOpen) {
    XCTAssertEqual(maxOpen, kMontage.size());
  }
}

- (void)testAnEagerMontagePlaysThrough {
  [self open:false];
  [self playThrough:3 allOpen:true];
}

- (void)testALazyMontagePlaysThroughWithFewDecoders {
  [self open:true];
  // The item before, kept past its end, the one on screen, the one after.
  [self playThrough:3 allOpen:false];
}

- (void)testSeeksWhilePaused {
  [self open:false];
  [self awaitFrame:kMontage[0] at:0];
  [self seek:4.5];
  [self awaitFrame:kMontage[2] at:4.5];
  [self seek:0.5];
  [self awaitFrame:kMontage[0] at:0.5];
  [self seek:2.5];
  [self awaitFrame:kMontage[1] at:2.5];
  [self seek:5.98];
  [self awaitFrame:kMontage[2] at:5.98];
  [self seek:9];
  [self spin:0.2];
  [self pump];
  [self seek:1.2];
  [self awaitFrame:kMontage[0] at:1.2];
}

- (void)testASeekIntoAClosedItemShowsItsFrame {
  [self open:true];
  [self awaitFrame:kMontage[0] at:0];
  XCTAssertFalse(extractor->itemDecoders.count("c"));
  [self seek:5.0];
  [self awaitFrame:kMontage[2] at:5.0];
  [self seek:0.5];
  [self awaitFrame:kMontage[0] at:0.5];
  [self seek:2.5];
  [self awaitFrame:kMontage[1] at:2.5];
}

// Regression: the frames object was filled in place, so an item whose decoder
// closed kept its last frame in it. A seek back into the item was handed that
// frame before the new decoder had one; on Android its texture was deleted
// and drawing it killed the app.
- (void)testAClosedItemLeavesTheFramesObject {
  [self open:true];
  [self awaitFrame:kMontage[0] at:0];
  XCTAssertTrue([self pump].count("a"));
  [self seek:5.0];
  [self awaitFrame:kMontage[2] at:5.0];
  XCTAssertFalse(extractor->itemDecoders.count("a"));
  auto frames = [self pump];
  XCTAssertFalse(frames.count("a"), @"a is closed but still has a frame");
  XCTAssertTrue(frames.count("c"));
}

- (void)testAScrubSettlesOnTheRightFrame {
  [self open:true];
  std::mt19937 random(7);
  std::uniform_real_distribution<double> unit(0, 6);
  for (int i = 0; i < 60; i++) {
    [self seek:unit(random)];
    [self pump];
    XCTAssertLessThanOrEqual([self openCount], 3u);
    [self spin:0.015];
  }
  [self seek:4.2];
  [self awaitFrame:kMontage[2] at:4.2];
}

// A player positioned right away by JS: the decoders start where the clock
// does instead of fast-forwarding from zero.
- (void)testASeekBeforeReadyLands {
  PreviewExtractorTests* this_ = self;
  [self open:false
            clips:kMontage
      beforeReady:^{
        [this_ seek:4.5];
      }];
  [self awaitFrame:kMontage[2] at:4.5];
}

- (void)testALoopWrapsToTheStart {
  [self open:true clips:{{"a", 0, 0, 2}, {"b", 2, 3, 1}} beforeReady:nil];
  [self object].setProperty(*runtime, "isLooping", true);
  [self call:"play"];
  double previous = 0;
  bool wrapped = false;
  int checksAfterWrap = 0;
  std::vector<Clip> clips{{"a", 0, 0, 2}, {"b", 2, 3, 1}};
  NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:8];
  while (checksAfterWrap < 20 && [deadline timeIntervalSinceNow] > 0) {
    auto frames = [self pump];
    double t = [self currentTime];
    if (t < previous - 1) {
      wrapped = true;
    }
    previous = t;
    const Clip* clip = clipAt(clips, t);
    if (wrapped && clip && t - clip->compositionStart > 0.3 &&
        clip->end() - t > 0.1) {
      int expected = clip->frameAt(t, 30);
      int index = frames.count(clip->id) ? frames[clip->id].index : -1;
      XCTAssertTrue(index <= expected && index >= expected - 8,
                    @"after the wrap %s at %.3fs shows %d, expected about %d",
                    clip->id.c_str(), t, index, expected);
      checksAfterWrap++;
    }
    XCTAssertLessThanOrEqual([self openCount], 2u);
    [self spin:0.016];
  }
  XCTAssertTrue(wrapped, "the clock never wrapped");
  XCTAssertGreaterThanOrEqual(checksAfterWrap, 20);
}

- (void)testDisposeReleasesEverything {
  [self open:false];
  [self awaitFrame:kMontage[0] at:0];
  [self call:"dispose"];
  XCTAssertTrue(extractor->itemDecoders.empty());
  XCTAssertTrue([self pump].empty());
  XCTAssertEqual([self currentTime], 0);
  // Calls after dispose are no-ops.
  [self seek:2];
  [self call:"play"];
  [self spin:0.1];
  XCTAssertTrue(extractor->itemDecoders.empty());
}

@end

#pragma mark - Encoder (JSI)

@interface EncoderTests : NativeVideoTestCase
@end

@implementation EncoderTests

- (NSString*)outPath:(NSString*)name {
  NSString* path = [testDirectory() stringByAppendingPathComponent:name];
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
  return path;
}

- (jsi::Object)encoder:(NSString*)path
                 width:(int)width
                height:(int)height
                 codec:(const char*)codec
                direct:(bool)direct
                  host:(std::shared_ptr<VideoEncoderHostObject>*)host {
  auto encoder = std::make_shared<VideoEncoderHostObject>(
      path.UTF8String, width, height, 30, 2000000, codec, 128000, 44100, 2,
      nullptr, direct);
  if (host) {
    *host = encoder;
  }
  return jsi::Object::createFromHostObject(*runtime, encoder);
}

- (void)encode:(jsi::Object&)encoder texture:(id<MTLTexture>)texture at:(double)t {
  jsi::Runtime& rt = *runtime;
  jsi::Object serialized(rt);
  serialized.setProperty(
      rt, "mtlTexture",
      jsi::BigInt::fromUint64(rt, (uint64_t)(__bridge void*)texture));
  encoder.getPropertyAsFunction(rt, "encodeFrame").call(rt, serialized, t);
}

struct ReadBack {
  std::vector<int> indices;
  std::vector<double> times;
  double duration = 0;
  FourCharCode codec = 0;
  CGSize size = CGSizeZero;
};

- (ReadBack)readBack:(NSString*)path {
  ReadBack result;
  AVURLAsset* asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path]
                                          options:nil];
  AVAssetTrack* track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
  XCTAssertNotNil(track);
  result.duration = CMTimeGetSeconds(asset.duration);
  result.size = track.naturalSize;
  auto format = (__bridge CMFormatDescriptionRef)track.formatDescriptions.firstObject;
  result.codec = CMFormatDescriptionGetMediaSubType(format);
  NSError* error = nil;
  AVAssetReader* reader = [AVAssetReader assetReaderWithAsset:asset error:&error];
  AVAssetReaderTrackOutput* output = [AVAssetReaderTrackOutput
      assetReaderTrackOutputWithTrack:track
                       outputSettings:@{
                         (id)kCVPixelBufferPixelFormatTypeKey :
                             @(kCVPixelFormatType_32BGRA)
                       }];
  [reader addOutput:output];
  [reader startReading];
  while (CMSampleBufferRef sample = [output copyNextSampleBuffer]) {
    CVPixelBufferRef buffer = CMSampleBufferGetImageBuffer(sample);
    if (buffer) {
      CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
      result.indices.push_back(readPattern(
          (const uint8_t*)CVPixelBufferGetBaseAddress(buffer),
          CVPixelBufferGetBytesPerRow(buffer),
          (int)CVPixelBufferGetWidth(buffer),
          (int)CVPixelBufferGetHeight(buffer)));
      result.times.push_back(
          CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)));
      CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
    }
    CFRelease(sample);
  }
  XCTAssertEqual(reader.status, AVAssetReaderStatusCompleted);
  return result;
}

- (void)encodeFrames:(int)count
               codec:(const char*)codec
              direct:(bool)direct
            expected:(FourCharCode)expectedCodec {
  jsi::Runtime& rt = *runtime;
  NSString* path = [self outPath:[NSString stringWithFormat:@"encoded-%s-%d.mp4",
                                                            codec, direct]];
  std::shared_ptr<VideoEncoderHostObject> host;
  {
    auto encoder = [self encoder:path
                           width:320
                          height:240
                           codec:codec
                          direct:direct
                            host:&host];
    encoder.getPropertyAsFunction(rt, "prepare").call(rt);
    for (int i = 0; i < count; i++) {
      @autoreleasepool {
        [self encode:encoder texture:patternTexture(320, 240, i) at:i / 30.0];
      }
    }
    encoder.getPropertyAsFunction(rt, "finishWriting").call(rt);
    encoder.getPropertyAsFunction(rt, "dispose").call(rt);
  }
  ReadBack back = [self readBack:path];
  XCTAssertEqual(back.codec, expectedCodec);
  XCTAssertEqual(back.size.width, 320);
  XCTAssertEqual(back.size.height, 240);
  XCTAssertEqual(back.indices.size(), (size_t)count);
  for (size_t i = 0; i < back.indices.size(); i++) {
    XCTAssertEqual(back.indices[i], (int)i, @"frame %zu", i);
    XCTAssertEqualWithAccuracy(back.times[i], i / 30.0, 1e-3, @"frame %zu", i);
  }
  XCTAssertEqualWithAccuracy(back.duration, count / 30.0, 1 / 30.0 + 1e-3);
}

// The test video itself, read without the library: frame i at i / fps.
- (void)testTheTestVideoIsWhatItSays {
  ReadBack back = [self readBack:[self video:VideoSpec()]];
  XCTAssertEqual(back.indices.size(), 180u);
  for (size_t i = 0; i < back.indices.size(); i++) {
    XCTAssertEqual(back.indices[i], (int)i, @"frame %zu at %.4fs", i,
                   back.times[i]);
    XCTAssertEqualWithAccuracy(back.times[i], i / 30.0, 1e-3, @"frame %zu", i);
  }
}

- (void)testCopyModeEncodesEveryFrame {
  [self encodeFrames:45 codec:"h264" direct:false expected:kCMVideoCodecType_H264];
}

- (void)testDirectModeEncodesEveryFrame {
  [self encodeFrames:45 codec:"h264" direct:true expected:kCMVideoCodecType_H264];
}

- (void)testHEVC {
  if (!VideoEncoderHostObject::isCodecSupported("hevc")) {
    XCTSkip(@"no HEVC encoder on this simulator");
  }
  [self encodeFrames:45 codec:"hevc" direct:false expected:kCMVideoCodecType_HEVC];
}

- (void)testAnUnknownCodecFallsBackToH264 {
  XCTAssertFalse(VideoEncoderHostObject::isCodecSupported("vp9"));
  XCTAssertTrue(VideoEncoderHostObject::isCodecSupported("h264"));
  [self encodeFrames:10 codec:"vp9" direct:false expected:kCMVideoCodecType_H264];
}

// The whole export: the frames the export extractor decodes, straight into
// the encoder, and the file carries the composition's frames in order.
- (void)testAMontageExportsItsFrames {
  jsi::Runtime& rt = *runtime;
  for (bool lazy : {false, true}) {
    auto composition = makeComposition([self video:VideoSpec()], kMontage, lazy);
    auto extractor =
        std::make_shared<VideoCompositionFramesExtractorSyncHostObject>(
            composition);
    NSString* path =
        [self outPath:[NSString stringWithFormat:@"montage-%d.mp4", lazy]];
    {
      jsi::Object frames = jsi::Object::createFromHostObject(rt, extractor);
      frames.getPropertyAsFunction(rt, "start").call(rt);
      auto encoder = [self encoder:path
                             width:320
                            height:240
                             codec:"h264"
                            direct:false
                              host:nullptr];
      encoder.getPropertyAsFunction(rt, "prepare").call(rt);
      auto decode = frames.getPropertyAsFunction(rt, "decodeCompositionFrames");
      for (int i = 0; i < 180; i++) {
        double t = i / 30.0;
        auto decoded = decode.call(rt, t).asObject(rt);
        const Clip* clip = clipAt(kMontage, t);
        auto frame = decoded.getProperty(rt, clip->id.c_str()).asObject(rt);
        auto texture = frame.getProperty(rt, "texture").asObject(rt);
        encoder.getPropertyAsFunction(rt, "encodeFrame").call(rt, texture, t);
      }
      encoder.getPropertyAsFunction(rt, "finishWriting").call(rt);
      encoder.getPropertyAsFunction(rt, "dispose").call(rt);
      frames.getPropertyAsFunction(rt, "dispose").call(rt);
    }
    ReadBack back = [self readBack:path];
    XCTAssertEqual(back.indices.size(), 180u);
    for (size_t i = 0; i < back.indices.size(); i++) {
      double t = i / 30.0;
      XCTAssertEqual(back.indices[i], clipAt(kMontage, t)->frameAt(t, 30),
                     @"lazy %d, exported frame %zu", lazy, i);
    }
  }
}

@end
