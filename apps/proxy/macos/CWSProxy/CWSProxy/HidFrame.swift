import Foundation

enum HidOp: String, Codable {
  case open
  case write
  case close
  case ok
  case input
  case error
}

struct HidFrame: Codable {
  var op: HidOp
  var vid: Int?
  var pid: Int?
  var name: String?
  var descriptor: String?
  var report: String?
  var message: String?
}

enum HidCodec {
  static let maxFrame = 1_000_000

  static func encode(_ frame: HidFrame) throws -> Data {
    let encoder = JSONEncoder()
    let body = try encoder.encode(frame)
    var header = Data(count: 4)
    var size = UInt32(body.count).bigEndian
    header.replaceSubrange(0..<4, with: Data(bytes: &size, count: 4))
    return header + body
  }

  static func take(from buffer: inout Data) throws -> [HidFrame] {
    let decoder = JSONDecoder()
    var frames: [HidFrame] = []
    while buffer.count >= 4 {
      let size = Int(
        UInt32(buffer[buffer.startIndex]) << 24
          | UInt32(buffer[buffer.startIndex + 1]) << 16
          | UInt32(buffer[buffer.startIndex + 2]) << 8
          | UInt32(buffer[buffer.startIndex + 3])
      )
      if size > maxFrame {
        throw HidError.frameTooLarge(size)
      }
      if buffer.count < 4 + size {
        break
      }
      let json = buffer.subdata(in: 4..<(4 + size))
      buffer.removeSubrange(0..<(4 + size))
      frames.append(try decoder.decode(HidFrame.self, from: json))
    }
    return frames
  }
}

enum HidError: LocalizedError {
  case createFailed
  case frameTooLarge(Int)
  case reportFailed(Int32)
  case missingDescriptor
  case listenFailed(String)

  var errorDescription: String? {
    switch self {
    case .createFailed:
      return "IOHIDUserDeviceCreateWithProperties failed"
    case .frameTooLarge(let size):
      return "hid frame too large (\(size))"
    case .reportFailed(let status):
      return "IOHIDUserDeviceHandleReportWithTimeStamp \(status)"
    case .missingDescriptor:
      return "open frame missing descriptor"
    case .listenFailed(let message):
      return message
    }
  }
}
