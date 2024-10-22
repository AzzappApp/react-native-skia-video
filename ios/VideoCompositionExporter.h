#pragma once
#import "VideoComposition.h"
#include <RNSkPlatformContext.h>
#include <worklets/WorkletRuntime/WorkletRuntime.h>

namespace RNSkiaVideo {
using namespace facebook;

void exportVideoComposition(
    std::shared_ptr<VideoComposition> composition, std::string outPath,
    int width, int height, int frameRate, int bitRate,
    std::shared_ptr<worklets::WorkletRuntime> workletRuntime,
    std::shared_ptr<worklets::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkia::RNSkPlatformContext> rnskPlatformContext,
    std::function<void()> onComplete, std::function<void(NSError*)> onError,
    std::function<void(int)> onProgress);
} // namespace RNSkiaVideo
