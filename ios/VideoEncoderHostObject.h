#pragma once

#import "VideoComposition.h"
#import <AVFoundation/AVFoundation.h>
#import <IOSurface/IOSurfaceRef.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoEncoderHostObject : public jsi::HostObject {
public:
  VideoEncoderHostObject(std::string outPath, int width, int height,
                         int frameRate, int bitRate, int audioBitRate,
                         int audioSampleRate, int audioChannelCount,
                         std::shared_ptr<VideoComposition> composition);
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
  CVPixelBufferPoolRef pixelBufferPool = NULL;
  // The buffer handed out by beginFrame(), appended by endFrame().
  CVPixelBufferRef pendingFrameBuffer = NULL;

  AVAssetWriterInput* audioWriterInput;
  AVAssetReader* audioReader;
  AVAssetReaderAudioMixOutput* audioMixOutput;
  dispatch_queue_t audioQueue;
  dispatch_semaphore_t audioCompletionSemaphore;
  NSMutableArray<NSError*>* audioErrorHolder;

  void prepare();
  CVPixelBufferRef createFrameBuffer();
  void appendFrameBuffer(CVPixelBufferRef pixelBuffer, CMTime time);
  void encodeFrame(const uint8_t* pixels, size_t size, CMTime time);
  IOSurfaceRef beginFrame();
  void endFrame(CMTime time);
  void releasePendingFrameBuffer();
  void setupAudio();
  void startWritingAudio();
  void finish();
  void release();
};

} // namespace RNSkiaVideo
