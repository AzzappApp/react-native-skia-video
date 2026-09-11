#pragma once

#import "RNSVHostObject.h"
#import "VideoComposition.h"
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoEncoderHostObject : public RNSVHostObject {
public:
  VideoEncoderHostObject(std::string outPath, int width, int height,
                         int frameRate, int bitRate, int audioBitRate,
                         int audioSampleRate, int audioChannelCount,
                         std::shared_ptr<VideoComposition> composition,
                         bool directEncoder);
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  std::string outPath;
  int width;
  int height;
  int bitRate;
  int frameRate;
  int audioBitRate;
  int audioSampleRate;
  int audioChannelCount;
  std::shared_ptr<VideoComposition> composition;
  // `encoderMode: 'direct'`: blit the Skia texture straight into a pool pixel
  // buffer on the GPU and append it asynchronously, instead of copying it
  // through the CPU. Default: copy.
  bool directEncoder;
  id<MTLDevice> device;
  id<MTLCommandQueue> commandQueue;
  id<MTLTexture> cpuAccessibleTexture;
  AVAssetWriter* assetWriter;
  AVAssetWriterInput* assetWriterInput;
  CVPixelBufferPoolRef pixelBufferPool = NULL;

  // Direct mode. Frames are appended through the adaptor, on appendQueue,
  // from the completion handler of their blit. inflightBlits keeps at most
  // one blit in flight once encodeFrame returns, so the caller can draw into
  // the surface it alternates with while the previous frame is still read.
  AVAssetWriterInputPixelBufferAdaptor* pixelBufferAdaptor;
  dispatch_queue_t appendQueue;
  dispatch_semaphore_t inflightBlits;
  NSMutableArray<NSError*>* appendErrorHolder;

  AVAssetWriterInput* audioWriterInput;
  AVAssetReader* audioReader;
  AVAssetReaderAudioMixOutput* audioMixOutput;
  dispatch_queue_t audioQueue;
  dispatch_semaphore_t audioCompletionSemaphore;
  NSMutableArray<NSError*>* audioErrorHolder;

  void prepare();
  void encodeFrame(id<MTLTexture> mlTexture, CMTime time);
  void encodeFrameCopy(id<MTLTexture> mlTexture, CMTime time);
  void encodeFrameDirect(id<MTLTexture> mlTexture, CMTime time);
  void copyTextureIntoPixelBuffer(id<MTLTexture> mlTexture,
                                  CVPixelBufferRef pixelBuffer);
  void appendPixelBufferNow(CVPixelBufferRef pixelBuffer, CMTime time);
  void drainDirectAppends();
  void setupAudio();
  void startWritingAudio();
  void finish();
  void release();
};

} // namespace RNSkiaVideo
