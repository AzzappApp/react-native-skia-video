#pragma once

#import "VideoComposition.h"
#import <AVFoundation/AVFoundation.h>
#import <list>

using namespace facebook;

namespace RNSkiaVideo {

struct VideoDimensions {
  double width;
  double height;
  int rotation;
};

class VideoCompositionItemDecoder {
public:
  VideoCompositionItemDecoder(std::shared_ptr<VideoCompositionItem> item);
  void advance(CMTime currentTime);
  void seekTo(CMTime currentTime);
  CVPixelBufferRef getCurrentBuffer();
  VideoDimensions getFramesDimensions();
  void release();

private:
  std::shared_ptr<VideoCompositionItem> item;
  VideoDimensions framesDimensions;
  AVURLAsset* asset;
  AVAssetTrack* videoTrack;
  AVAssetReader* assetReader;
  std::list<std::pair<double, CVPixelBufferRef>> decodedFrames;
  CVPixelBufferRef currentBuffer;

  void setupReader(CMTime initialTime);
};

} // namespace RNSkiaVideo
