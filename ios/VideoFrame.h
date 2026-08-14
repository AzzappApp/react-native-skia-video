//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <CoreVideo/CoreVideo.h>
#import <Metal/Metal.h>
#import <jsi/jsi.h>
#import <list>
#import <memory>
#import <mutex>

namespace RNSkiaVideo {
using namespace facebook;

/**
 * A decoded frame handed to JS. The frame OWNS its pixels: it retains the
 * decoder's CVPixelBuffer and exposes a zero-copy Metal texture view over
 * its IOSurface — no per-frame blit, no CPU/GPU sync.
 *
 * Lifetime is deterministic, NOT garbage-collector driven: the producer
 * (decoder or player) keeps a small ring of recently issued frames and
 * calls releaseBuffer() on the oldest one as new frames are issued, so the
 * decoder pools never starve and memory stays bounded no matter how lazily
 * the JS runtime collects the wrapper objects. A released frame's `texture`
 * getter returns undefined.
 */
class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  VideoFrame(CVPixelBufferRef pixelBuffer, double width, double height,
             int rotation);
  ~VideoFrame() override;

  /**
   * Drops the frame's texture view: the JS `texture` getter returns
   * undefined from now on, so no NEW sampling work can reference the frame.
   * GPU work already in flight is unaffected (Metal retains the underlying
   * texture inside committed command buffers). Idempotent.
   */
  void releaseTexture();

  /**
   * Returns the pixel buffer to its pool unless the kernel still reports its
   * IOSurface as in use, so a buffer another subsystem is still reading is
   * held back instead of being recycled under it. Note that the use count is
   * a best-effort signal: it tracks explicit IOSurface users (CoreAnimation,
   * VideoToolbox, other processes), NOT command buffers Metal has in flight,
   * so it complements the ring depth below rather than replacing it.
   * Returns true once the buffer is gone. Idempotent.
   */
  bool tryReleaseBuffer();

  /**
   * Releases the texture view and the pixel buffer unconditionally, without
   * waiting for the JS wrapper to be collected. Idempotent.
   */
  void releaseBuffer();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  std::mutex mutex;
  CVPixelBufferRef pixelBuffer = NULL;
  CVMetalTextureRef cvMetalTexture = NULL;
  id<MTLTexture> mtlTexture;
  double width;
  double height;
  int rotation;

  void releaseTextureLocked();
  void releaseBufferLocked();
};

/**
 * Ring depth for real-time preview producers. The JS contract (see
 * VideoFrame.texture in types.ts) is that a frame is consumed in the tick it
 * is handed out, so the only reads that can outlive a frame's currency are
 * GPU command buffers the preview's asynchronous flush left in flight.
 * CAMetalLayer blocks the render loop past 3 drawables in flight, so
 * maxDrawableCount + 1 issuances is as far as sampling can lag issuance.
 */
static constexpr size_t kPreviewFrameRingDepth = 4;

/**
 * Bounds the lifetime of the zero-copy frames a producer (a composition item
 * decoder or the simple player) hands to JS, without depending on the JS
 * garbage collector to release them.
 *
 * Frames are retired in two stages. A frame older than `depth` issuances
 * loses its texture view immediately, so no NEW sampling work can reference
 * it; its pixel buffer only goes back to the pool once the kernel reports
 * its IOSurface idle, so a buffer another subsystem still reads is never
 * recycled under it. The in-use check cannot see command buffers Metal has
 * merely queued, so the depth — not the check — is what actually covers
 * in-flight GPU sampling.
 */
class VideoFrameRing {
public:
  /**
   * `depth` is how many recently issued frames stay fully alive: the
   * consumer's sampling of a frame must provably be finished `depth`
   * issuances after it was handed out. Preview producers use
   * kPreviewFrameRingDepth; the sync (export) extractor uses 1, because its
   * consumer flushes the GPU synchronously before requesting the next frame,
   * making retirement-on-replacement safe and keeping a single decoded
   * buffer per item instead of kPreviewFrameRingDepth of them.
   */
  explicit VideoFrameRing(size_t depth = kPreviewFrameRingDepth)
      : depth(depth) {}

  /** Registers a freshly issued frame and runs a retirement pass. */
  void push(const std::shared_ptr<VideoFrame>& frame);

  /**
   * Drops every frame the ring holds, releasing their buffers unconditionally
   * — frames still referenced by JS turn into empty wrappers whose `texture`
   * getter returns undefined.
   */
  void releaseAll();

private:
  // Frames are issued from the render thread but a dispose can drop them from
  // the JS thread, so the lists below are guarded.
  std::mutex mutex;
  size_t depth;
  /** Recently issued frames, kept fully alive. */
  std::list<std::shared_ptr<VideoFrame>> issuedFrames;
  /** Retired frames whose surface has not gone idle yet. */
  std::list<std::shared_ptr<VideoFrame>> retiredFrames;

  /**
   * Upper bound on retired frames awaiting their surface to go idle, so a
   * pathological consumer cannot pile buffers up. Force-releasing past this
   * cap trades a bounded memory peak against a (preview-only, transient)
   * risk of sampling refreshed pixels.
   */
  static constexpr size_t kRetiredFramesHardCap = 4;
};

} // namespace RNSkiaVideo
