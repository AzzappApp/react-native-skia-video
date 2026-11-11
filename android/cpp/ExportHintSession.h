#pragma once

#include <cstdint>

struct APerformanceHintSession;

namespace RNSkiaVideo {

/**
 * Android performance hints (ADPF) for an export: tells the system how long
 * the export thread takes for each frame, against a target well under the
 * frame's real-time budget (an export runs as fast as it can), so that it
 * raises the CPU's clocks for it and, from Android 15, the GPU's. Between two
 * frames the export thread mostly waits for the GPU and the codecs: a GPU the
 * governor keeps at a low clock makes it wait longer.
 *
 * Does nothing before Android 13, or on a device without hint sessions.
 */
class ExportHintSession {
public:
  explicit ExportHintSession(int frameRate);
  ~ExportHintSession();
  ExportHintSession(const ExportHintSession&) = delete;
  ExportHintSession& operator=(const ExportHintSession&) = delete;

  // On the export thread, once a frame went to the encoder. The first call
  // opens the session for the calling thread.
  void frameDone();

private:
  int64_t targetNs;
  APerformanceHintSession* session = nullptr;
  bool unavailable = false;
  int64_t lastFrameNs = 0;
  int64_t lastThreadCpuNs = 0;
};

} // namespace RNSkiaVideo
