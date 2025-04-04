#pragma once

#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoCompositionFramesExtractorSyncHostObject
    : public jsi::HostObject {
public:
  VideoCompositionFramesExtractorSyncHostObject(
      std::shared_ptr<VideoComposition> composition);
  ~VideoCompositionFramesExtractorSyncHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  std::shared_ptr<VideoComposition> composition;
  std::map<std::string, std::shared_ptr<VideoCompositionItemDecoder>>
      itemDecoders;
  std::map<std::string, std::shared_ptr<VideoFrame>> currentFrames;
  void release();
};

} // namespace RNSkiaVideo
