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
#import <mutex>

namespace RNSkiaVideo {
using namespace facebook;

/**
 * How many recently issued zero-copy frames a producer keeps fully alive.
 *
 * Older frames are retired in two stages: their texture view is dropped
 * immediately (no NEW sampling work can reference them), but their pixel
 * buffer only returns to the decoder pool once IOSurfaceIsInUse() reports
 * the surface free — the kernel's use count covers in-flight GPU reads, so
 * the decoder can never overwrite pixels a late command buffer still
 * samples. The depth itself (maxDrawableCount + 1) already bounds how far
 * the GPU can lag issuance, since CAMetalLayer blocks the render loop past
 * 3 drawables in flight; the use-count check turns that bound into a
 * guarantee. On the export path this is belt-and-suspenders: the export
 * loop flushes synchronously (surface.flush(true)), so sampling work is
 * provably complete before any frame becomes old enough to retire.
 */
static constexpr size_t kIssuedFrameRingDepth = 4;

/**
 * Upper bound on retired frames awaiting their surface to go idle, so a
 * pathological consumer cannot pile buffers up. Force-releasing past this
 * cap trades a bounded memory peak against a (preview-only, transient)
 * risk of sampling refreshed pixels.
 */
static constexpr size_t kRetiredFramesHardCap = 4;

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
   * Returns the pixel buffer to its pool ONLY if its IOSurface is no longer
   * in use (the kernel's use count covers pending GPU reads), so the
   * decoder can never overwrite pixels a late command buffer still samples.
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

} // namespace RNSkiaVideo
