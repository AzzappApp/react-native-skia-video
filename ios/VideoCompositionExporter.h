#pragma once
#include <RNSkPlatformContext.h>
#include <WorkletRuntime.h>
#import "VideoComposition.h"

namespace RNSkiaVideo {
using namespace facebook;

void exportVideoComposition(
      VideoComposition* composition, std::string outPath, int width, int height,
      int frameRate, int bitRate,
      std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
      std::shared_ptr<reanimated::ShareableWorklet> drawFrame,
      std::shared_ptr<RNSkia::RNSkPlatformContext> rnskPlatformContext,
      std::function<void()> onComplete, std::function<void()> onError);
} // namespace RNSkiaVideo
