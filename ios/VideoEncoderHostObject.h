#pragma once

#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoEncoderHostObject : public jsi::HostObject {
public:
  VideoEncoderHostObject(std::string outPath, int width, int height,
                         int frameRate, int bitRate);
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  std::string outPath;
  int width;
  int height;
  int bitRate;
  int frameRate;
  id<MTLDevice> device;
  id<MTLCommandQueue> commandQueue;
  id<MTLTexture> cpuAccessibleTexture;
  AVAssetWriter* assetWriter;
  AVAssetWriterInput* assetWriterInput;
  CVPixelBufferRef pixelBuffer;

  void prepare();
  void encodeFrame(id<MTLTexture> mlTexture, CMTime time);
  void finish();
  void release();
};

} // namespace RNSkiaVideo
