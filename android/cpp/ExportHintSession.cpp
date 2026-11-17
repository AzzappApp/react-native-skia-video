#include "ExportHintSession.h"

#include <algorithm>
#include <dlfcn.h>
#include <time.h>
#include <type_traits>
#include <unistd.h>

struct APerformanceHintManager;
struct AWorkDuration;

namespace RNSkiaVideo {

namespace {

  int64_t nowNs(clockid_t clock) {
    timespec time{};
    clock_gettime(clock, &time);
    return static_cast<int64_t>(time.tv_sec) * 1'000'000'000 + time.tv_nsec;
  }

  // The NDK's performance hint functions, looked up at runtime: the library
  // supports Android 9, hint sessions came with Android 13 and work durations
  // with a GPU part with Android 15. Null where missing.
  struct HintFunctions {
    APerformanceHintManager* (*getManager)() = nullptr;
    APerformanceHintSession* (*createSession)(APerformanceHintManager*,
                                              const int32_t*, size_t,
                                              int64_t) = nullptr;
    int (*reportActualWorkDuration)(APerformanceHintSession*,
                                    int64_t) = nullptr;
    void (*closeSession)(APerformanceHintSession*) = nullptr;
    AWorkDuration* (*createWorkDuration)() = nullptr;
    void (*releaseWorkDuration)(AWorkDuration*) = nullptr;
    void (*setWorkPeriodStart)(AWorkDuration*, int64_t) = nullptr;
    void (*setTotalDuration)(AWorkDuration*, int64_t) = nullptr;
    void (*setCpuDuration)(AWorkDuration*, int64_t) = nullptr;
    void (*setGpuDuration)(AWorkDuration*, int64_t) = nullptr;
    int (*reportWorkDuration)(APerformanceHintSession*,
                              AWorkDuration*) = nullptr;

    bool hasSessions() const {
      return getManager != nullptr && createSession != nullptr &&
             reportActualWorkDuration != nullptr && closeSession != nullptr;
    }

    bool hasWorkDurations() const {
      return createWorkDuration != nullptr && releaseWorkDuration != nullptr &&
             setWorkPeriodStart != nullptr && setTotalDuration != nullptr &&
             setCpuDuration != nullptr && setGpuDuration != nullptr &&
             reportWorkDuration != nullptr;
    }
  };

  const HintFunctions& getHintFunctions() {
    static const HintFunctions functions = [] {
      HintFunctions found;
      void* library = dlopen("libandroid.so", RTLD_NOW);
      if (library == nullptr) {
        return found;
      }
      auto lookUp = [library](auto& function, const char* name) {
        function =
            reinterpret_cast<std::remove_reference_t<decltype(function)>>(
                dlsym(library, name));
      };
      lookUp(found.getManager, "APerformanceHint_getManager");
      lookUp(found.createSession, "APerformanceHint_createSession");
      lookUp(found.reportActualWorkDuration,
             "APerformanceHint_reportActualWorkDuration");
      lookUp(found.closeSession, "APerformanceHint_closeSession");
      lookUp(found.createWorkDuration, "AWorkDuration_create");
      lookUp(found.releaseWorkDuration, "AWorkDuration_release");
      lookUp(found.setWorkPeriodStart,
             "AWorkDuration_setWorkPeriodStartTimestampNanos");
      lookUp(found.setTotalDuration,
             "AWorkDuration_setActualTotalDurationNanos");
      lookUp(found.setCpuDuration, "AWorkDuration_setActualCpuDurationNanos");
      lookUp(found.setGpuDuration, "AWorkDuration_setActualGpuDurationNanos");
      lookUp(found.reportWorkDuration,
             "APerformanceHint_reportActualWorkDuration2");
      return found;
    }();
    return functions;
  }

} // namespace

// A quarter of the frame's real-time budget: the export should take the
// capacity it needs rather than the least that keeps up with real time.
ExportHintSession::ExportHintSession(int frameRate)
    : targetNs(1'000'000'000LL / (std::max(frameRate, 1) * 4LL)) {}

ExportHintSession::~ExportHintSession() {
  if (session != nullptr) {
    getHintFunctions().closeSession(session);
  }
}

void ExportHintSession::frameDone() {
  const auto& functions = getHintFunctions();
  const int64_t frameNs = nowNs(CLOCK_MONOTONIC);
  const int64_t threadCpuNs = nowNs(CLOCK_THREAD_CPUTIME_ID);
  if (session == nullptr) {
    if (unavailable) {
      return;
    }
    // The export thread: it waits for the decoders, draws and hands the
    // frames to the encoder.
    auto manager = functions.hasSessions() ? functions.getManager() : nullptr;
    const int32_t threadId = gettid();
    session = manager != nullptr
                  ? functions.createSession(manager, &threadId, 1, targetNs)
                  : nullptr;
    unavailable = session == nullptr;
  } else {
    const int64_t totalNs = std::max<int64_t>(frameNs - lastFrameNs, 1);
    if (functions.hasWorkDurations()) {
      // What the thread did not spend on the CPU it mostly spent waiting for
      // the GPU: reported as GPU time, which lets the system raise the GPU's
      // clock too.
      const int64_t cpuNs =
          std::clamp<int64_t>(threadCpuNs - lastThreadCpuNs, 1, totalNs);
      auto work = functions.createWorkDuration();
      if (work != nullptr) {
        functions.setWorkPeriodStart(work, lastFrameNs);
        functions.setTotalDuration(work, totalNs);
        functions.setCpuDuration(work, cpuNs);
        functions.setGpuDuration(work, totalNs - cpuNs);
        functions.reportWorkDuration(session, work);
        functions.releaseWorkDuration(work);
      }
    } else {
      functions.reportActualWorkDuration(session, totalNs);
    }
  }
  lastFrameNs = frameNs;
  lastThreadCpuNs = threadCpuNs;
}

} // namespace RNSkiaVideo
