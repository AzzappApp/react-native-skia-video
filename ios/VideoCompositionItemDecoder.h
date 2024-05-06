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
  VideoCompositionItemDecoder(VideoCompositionItem* item);
  void advance(CMTime currentTime);
  void seekTo(CMTime currentTime);
  CVBufferRef getCurrentBuffer();
  VideoDimensions getFramesDimensions();
  void release();

private:
  VideoCompositionItem* item;
  VideoDimensions framesDimensions;
  AVURLAsset* asset;
  AVAssetTrack* videoTrack;
  AVAssetReader* assetReader;
  std::list<std::pair<double, CVBufferRef>> decodedFrames;
  CVBufferRef currentBuffer;

  void setupReader(CMTime initialTime);
};

} // namespace RNSkiaVideo
