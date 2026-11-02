#pragma once

#import "VideoComposition.h"
#import <AVFoundation/AVFoundation.h>
#import <IOSurface/IOSurfaceRef.h>
#import <VideoToolbox/VideoToolbox.h>
#import <jsi/jsi.h>
#import <vector>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoEncoderHostObject : public jsi::HostObject {
public:
  VideoEncoderHostObject(std::string outPath, int width, int height,
                         int frameRate, int bitRate, int audioBitRate,
                         int audioSampleRate, int audioChannelCount,
                         std::shared_ptr<VideoComposition> composition);
  ~VideoEncoderHostObject();
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
  AVAssetWriter* assetWriter;
  AVAssetWriterInput* assetWriterInput;
  // The BGRA buffer beginFrame() hands out.
  CVPixelBufferPoolRef pixelBufferPool = NULL;
  // The buffer beginFrame() hands out, the same every frame; endFrame()
  // appends an NV12 conversion of it (see endFrame()).
  CVPixelBufferRef frameBuffer = NULL;
  // The NV12 buffers endFrame() appends, and the conversion into them.
  CVPixelBufferPoolRef encoderBufferPool = NULL;
  VTPixelTransferSessionRef pixelTransferSession = NULL;
  // Between beginFrame() and endFrame().
  bool framePending = false;

  AVAssetWriterInput* audioWriterInput;
  AVAssetReader* audioReader;
  AVAssetReaderAudioMixOutput* audioMixOutput;
  dispatch_queue_t audioQueue;
  dispatch_semaphore_t audioCompletionSemaphore;
  NSMutableArray<NSError*>* audioErrorHolder;

  void prepare();
  CVPixelBufferRef createPoolBuffer(CVPixelBufferPoolRef pool);
  CVPixelBufferRef createEncoderBuffer();
  void convertFrameBuffer(CVPixelBufferRef source,
                          CVPixelBufferRef destination);
  void appendFrameBuffer(CVPixelBufferRef pixelBuffer, CMTime time);
  IOSurfaceRef beginFrame();
  void endFrame(CMTime time);
  void releaseFrameBuffer();
  void setupAudio();
  void startWritingAudio();
  void finish();
  void release();
};

} // namespace RNSkiaVideo
