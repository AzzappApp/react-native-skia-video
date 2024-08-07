#pragma once
#import "VideoComposition.h"
#include <RNSkPlatformContext.h>
#include <WorkletRuntime.h>

namespace RNSkiaVideo {
using namespace facebook;

void exportVideoComposition(
    std::shared_ptr<VideoComposition> composition, std::string outPath,
    int width, int height, int frameRate, int bitRate,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkia::RNSkPlatformContext> rnskPlatformContext,
    std::function<void()> onComplete, std::function<void(NSError*)> onError,
    std::function<void(int)> onProgress);
} // namespace RNSkiaVideo
