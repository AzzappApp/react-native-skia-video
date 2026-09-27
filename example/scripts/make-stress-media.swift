// Writes the media the example's stress screen plays, with AVFoundation only:
//   swift example/scripts/make-stress-media.swift <out dir>
// Each frame shows its file's colour, a bar that moves with time and the frame
// number, so a stall, a wrong item or a wrong frame is visible on screen.

import AVFoundation
import CoreGraphics
import CoreText
import Foundation

struct Media {
  let name: String
  let codec: AVVideoCodecType
  let width: Int
  let height: Int
  let fps: Int
  let seconds: Double
  var rotation: Int = 0
  var audio: Bool = false
  var hdr: Bool = false
}

let media: [Media] = [
  Media(name: "h264-1080p30-audio.mp4", codec: .h264, width: 1920, height: 1080, fps: 30, seconds: 8, audio: true),
  Media(name: "h264-4k30.mp4", codec: .h264, width: 3840, height: 2160, fps: 30, seconds: 8),
  Media(name: "hevc-4k30.mp4", codec: .hevc, width: 3840, height: 2160, fps: 30, seconds: 8),
  Media(name: "hevc-1080p-hlg10.mov", codec: .hevc, width: 1920, height: 1080, fps: 30, seconds: 6, hdr: true),
  Media(name: "h264-720p60.mp4", codec: .h264, width: 1280, height: 720, fps: 60, seconds: 6),
  Media(name: "h264-1080p-rot90.mp4", codec: .h264, width: 1920, height: 1080, fps: 30, seconds: 6, rotation: 90),
  Media(name: "h264-1080x1920.mp4", codec: .h264, width: 1080, height: 1920, fps: 30, seconds: 6),
  Media(name: "h264-638x358.mp4", codec: .h264, width: 638, height: 358, fps: 30, seconds: 6),
  Media(name: "h264-720p-short.mp4", codec: .h264, width: 1280, height: 720, fps: 30, seconds: 0.5),
  Media(name: "hevc-4k30-audio.mp4", codec: .hevc, width: 3840, height: 2160, fps: 30, seconds: 8, audio: true),
]

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "stress-media")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func hue(_ index: Int) -> (CGFloat, CGFloat, CGFloat) {
  let palette: [(CGFloat, CGFloat, CGFloat)] = [
    (0.8, 0.2, 0.2), (0.2, 0.6, 0.2), (0.2, 0.3, 0.8), (0.7, 0.5, 0.1), (0.5, 0.2, 0.7),
    (0.1, 0.6, 0.6), (0.8, 0.4, 0.6), (0.4, 0.4, 0.4), (0.6, 0.7, 0.2), (0.2, 0.2, 0.2),
  ]
  return palette[index % palette.count]
}

func drawBGRA(_ buffer: CVPixelBuffer, _ m: Media, _ index: Int, _ frame: Int) {
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  let ctx = CGContext(
    data: CVPixelBufferGetBaseAddress(buffer), width: m.width, height: m.height, bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  let (r, g, b) = hue(index)
  ctx.setFillColor(red: r, green: g, blue: b, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: m.width, height: m.height))
  // A bar across the width once per second.
  let t = Double(frame) / Double(m.fps)
  let x = CGFloat(t.truncatingRemainder(dividingBy: 1)) * CGFloat(m.width)
  ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
  ctx.fill(CGRect(x: x, y: 0, width: CGFloat(m.width) / 40, height: CGFloat(m.height)))
  // Top-left marker, to see the orientation.
  ctx.setFillColor(red: 1, green: 1, blue: 0, alpha: 1)
  let s = CGFloat(min(m.width, m.height)) / 6
  ctx.fill(CGRect(x: 0, y: CGFloat(m.height) - s, width: s, height: s))
  let text = "\(m.name)\nframe \(frame)  \(String(format: "%.2f", t))s" as CFString
  let font = CTFontCreateWithName("Menlo-Bold" as CFString, CGFloat(min(m.width, m.height)) / 14, nil)
  let attributes = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(gray: 1, alpha: 1)] as CFDictionary
  let framesetter = CTFramesetterCreateWithAttributedString(CFAttributedStringCreate(nil, text, attributes))
  let path = CGPath(rect: CGRect(x: s * 1.2, y: 0, width: CGFloat(m.width) - s * 1.4, height: CGFloat(m.height) * 0.9), transform: nil)
  CTFrameDraw(CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil), ctx)
}

// 10-bit 4:2:0 for HLG: the file colour, and the bar in luma.
func drawHDR(_ buffer: CVPixelBuffer, _ m: Media, _ index: Int, _ frame: Int) {
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  let t = Double(frame) / Double(m.fps)
  let barX = Int(t.truncatingRemainder(dividingBy: 1) * Double(m.width))
  let barW = m.width / 40
  let yPlane = CVPixelBufferGetBaseAddressOfPlane(buffer, 0)!.assumingMemoryBound(to: UInt16.self)
  let yStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0) / 2
  for y in 0..<m.height {
    for x in 0..<m.width {
      // Bright bar well into the HDR range, the rest mid grey.
      let v: UInt16 = (x >= barX && x < barX + barW) ? 900 : 400
      yPlane[y * yStride + x] = v << 6
    }
  }
  let cPlane = CVPixelBufferGetBaseAddressOfPlane(buffer, 1)!.assumingMemoryBound(to: UInt16.self)
  let cStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1) / 2
  let (cb, cr): (UInt16, UInt16) = [(420, 640), (380, 400), (640, 450)][index % 3]
  for y in 0..<(m.height / 2) {
    for x in 0..<(m.width / 2) {
      cPlane[y * cStride + x * 2] = cb << 6
      cPlane[y * cStride + x * 2 + 1] = cr << 6
    }
  }
}

func audioSample(_ start: Int, _ count: Int, _ format: CMAudioFormatDescription) -> CMSampleBuffer {
  var pcm = [Int16](repeating: 0, count: count * 2)
  for i in 0..<count {
    let v = Int16(sin(Double(start + i) * 2 * .pi * 440 / 44100) * 8000)
    pcm[i * 2] = v
    pcm[i * 2 + 1] = v
  }
  var block: CMBlockBuffer?
  let bytes = count * 4
  CMBlockBufferCreateWithMemoryBlock(
    allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil,
    offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
  pcm.withUnsafeBytes { raw in
    _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes)
  }
  var sample: CMSampleBuffer?
  CMAudioSampleBufferCreateReadyWithPacketDescriptions(
    allocator: nil, dataBuffer: block!, formatDescription: format, sampleCount: count,
    presentationTimeStamp: CMTime(value: CMTimeValue(start), timescale: 44100),
    packetDescriptions: nil, sampleBufferOut: &sample)
  return sample!
}

for (index, m) in media.enumerated() {
  let url = out.appendingPathComponent(m.name)
  try? FileManager.default.removeItem(at: url)
  let writer = try AVAssetWriter(outputURL: url, fileType: m.name.hasSuffix(".mov") ? .mov : .mp4)
  var settings: [String: Any] = [
    AVVideoCodecKey: m.codec, AVVideoWidthKey: m.width, AVVideoHeightKey: m.height,
  ]
  if m.hdr {
    settings[AVVideoColorPropertiesKey] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_2020,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_2100_HLG,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_2020,
    ]
    settings[AVVideoCompressionPropertiesKey] = [
      AVVideoProfileLevelKey: kVTProfileLevel_HEVC_Main10_AutoLevel as String,
    ]
  }
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
  input.expectsMediaDataInRealTime = false
  if m.rotation != 0 {
    input.transform = CGAffineTransform(rotationAngle: CGFloat(m.rotation) * .pi / 180)
  }
  let pixelFormat = m.hdr ? kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange : kCVPixelFormatType_32BGRA
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: pixelFormat,
    kCVPixelBufferWidthKey as String: m.width, kCVPixelBufferHeightKey as String: m.height,
  ])
  writer.add(input)
  var audioInput: AVAssetWriterInput?
  var audioFormat: CMAudioFormatDescription?
  if m.audio {
    let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000,
    ])
    a.expectsMediaDataInRealTime = false
    writer.add(a)
    audioInput = a
    var asbd = AudioStreamBasicDescription(
      mSampleRate: 44100, mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
      mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 2, mBitsPerChannel: 16, mReserved: 0)
    CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                   magicCookie: nil, extensions: nil, formatDescriptionOut: &audioFormat)
  }
  writer.startWriting()
  writer.startSession(atSourceTime: .zero)
  // Audio and video interleaved: the writer stops taking one track while it
  // waits for the other to catch up.
  let frames = max(1, Int((m.seconds * Double(m.fps)).rounded()))
  let totalSamples = Int(m.seconds * 44100)
  var frame = 0
  var sample = 0
  while frame < frames || (audioInput != nil && sample < totalSamples) {
    var progressed = false
    if frame < frames && input.isReadyForMoreMediaData {
      var buffer: CVPixelBuffer?
      CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
      if m.hdr { drawHDR(buffer!, m, index, frame) } else { drawBGRA(buffer!, m, index, frame) }
      adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(m.fps)))
      frame += 1
      if frame == frames { input.markAsFinished() }
      progressed = true
    }
    if let a = audioInput, let format = audioFormat, sample < totalSamples, a.isReadyForMoreMediaData {
      let count = min(4096, totalSamples - sample)
      a.append(audioSample(sample, count, format))
      sample += count
      if sample >= totalSamples { a.markAsFinished() }
      progressed = true
    }
    if !progressed { usleep(1000) }
    if writer.status == .failed {
      print("FAILED \(m.name): \(String(describing: writer.error))")
      exit(1)
    }
  }
  let done = DispatchSemaphore(value: 0)
  writer.finishWriting { done.signal() }
  done.wait()
  if writer.status != .completed {
    print("FAILED \(m.name): \(String(describing: writer.error))")
    exit(1)
  }
  print("wrote \(m.name)")
}

// An audio-only file for an audio item.
let audioURL = out.appendingPathComponent("tone.m4a")
try? FileManager.default.removeItem(at: audioURL)
do {
  let writer = try AVAssetWriter(outputURL: audioURL, fileType: .m4a)
  let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000,
  ])
  writer.add(a)
  var asbd = AudioStreamBasicDescription(
    mSampleRate: 44100, mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
    mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 2, mBitsPerChannel: 16, mReserved: 0)
  var format: CMAudioFormatDescription?
  CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                 magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
  writer.startWriting()
  writer.startSession(atSourceTime: .zero)
  var start = 0
  while start < 44100 * 30 {
    while !a.isReadyForMoreMediaData { usleep(1000) }
    a.append(audioSample(start, 4096, format!))
    start += 4096
  }
  a.markAsFinished()
  let done = DispatchSemaphore(value: 0)
  writer.finishWriting { done.signal() }
  done.wait()
  print("wrote tone.m4a")
}
