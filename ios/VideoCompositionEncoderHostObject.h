#pragma once

#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoCompositionEncoderHostObject : public jsi::HostObject {
public:
  VideoCompositionEncoderHostObject(std::string outPath, int width, int height,
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
  AVAssetWriter* assetWriter;
  AVAssetWriterInput* assetWriterInput;

  void prepare();
  void encodeFrame(id<MTLTexture> mlTexture, CMTime time);
  void finish();
  void release();
};

} // namespace RNSkiaVideo
