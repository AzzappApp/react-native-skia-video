//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <CoreVideo/CoreVideo.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

/**
 * A decoded video frame, backed by an IOSurface-backed BGRA CVPixelBuffer.
 * The frame retains the pixel buffer for its whole lifetime. The JS side
 * imports the IOSurface (`handle`) into the GPU device shared by Skia and
 * React Native WebGPU (`GPUDevice.importSharedTextureMemory`).
 */
class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  VideoFrame(CVPixelBufferRef pixelBuffer, int rotation);
  ~VideoFrame();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  CVPixelBufferRef pixelBuffer;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
