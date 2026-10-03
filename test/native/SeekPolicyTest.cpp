// Whether a seek reuses the running reader or builds a new one: plain C++,
// so it needs neither Xcode nor a simulator.
#include "SeekPolicy.h"

#include <cstdio>

using RNSkiaVideo::kSeekReadOnSeconds;
using RNSkiaVideo::seekReadsOn;

static int failures = 0;

static void expect(const char* name, bool got, bool want) {
  if (got != want) {
    failures++;
  }
  std::printf("%s %s\n", got == want ? "ok  " : "FAIL", name);
}

int main() {
  // A drag: a run of small forward steps, all served by the running reader.
  expect("reads on a tenth ahead", seekReadsOn(true, true, 4.0, 4.1), true);
  expect("reads on at the threshold",
         seekReadsOn(true, true, 4.0, 4.0 + kSeekReadOnSeconds), true);
  expect("reads on a seek that moved nothing",
         seekReadsOn(true, true, 4.0, 4.0), true);

  // A jump: cheaper to open a reader at the target than to decode up to it.
  expect("rebuilds past the threshold",
         seekReadsOn(true, true, 4.0, 4.0 + kSeekReadOnSeconds + 0.01), false);
  // An AVAssetReader only moves forward.
  expect("rebuilds going backwards", seekReadsOn(true, true, 4.0, 3.9), false);

  // Nothing to read on from.
  expect("rebuilds with no reader", seekReadsOn(false, true, 4.0, 4.1), false);
  expect("rebuilds before the first frame",
         seekReadsOn(true, false, 0.0, 4.1), false);

  std::printf("%s\n", failures == 0 ? "all passed" : "FAILURES");
  return failures == 0 ? 0 : 1;
}
