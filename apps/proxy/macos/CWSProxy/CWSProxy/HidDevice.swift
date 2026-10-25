import Foundation
import IOKit
import os.log

final class HidDevice {
  private static let queueKey = DispatchSpecificKey<UInt8>()
  private var device: IOHIDUserDevice?
  private let queue: DispatchQueue
  private let cancelled = DispatchSemaphore(value: 0)
  private var closed = false
  var onHostReport: ((Data) -> Void)?

  private static func makeQueue() -> DispatchQueue {
    let queue = DispatchQueue(label: "hk.ysk.cws.hid")
    queue.setSpecific(key: queueKey, value: 1)
    return queue
  }

  init(vid: Int, pid: Int, name: String, descriptor: Data) throws {
    self.queue = HidDevice.makeQueue()
    if Thread.isMainThread {
      try open(vid: vid, pid: pid, name: name, descriptor: descriptor)
    } else {
      var caught: Error?
      DispatchQueue.main.sync {
        do {
          try self.open(vid: vid, pid: pid, name: name, descriptor: descriptor)
        } catch {
          caught = error
        }
      }
      if let caught {
        throw caught
      }
    }
  }

  private func open(vid: Int, pid: Int, name: String, descriptor: Data) throws {
    let props: NSDictionary = [
      "ReportDescriptor": descriptor as NSData,
      "VendorID": NSNumber(value: Int32(vid)),
      "ProductID": NSNumber(value: Int32(pid)),
      "Product": name as NSString,
      "Manufacturer": "CWS" as NSString,
      "SerialNumber": "cws-proxy" as NSString,
      "Transport": "USB" as NSString,
      "CountryCode": NSNumber(value: Int32(0)),
      "PrimaryUsagePage": NSNumber(value: Int32(0xffa0)),
      "PrimaryUsage": NSNumber(value: Int32(1)),
      "MaxInputReportSize": NSNumber(value: Int32(64)),
      "MaxOutputReportSize": NSNumber(value: Int32(64)),
    ]
    guard let created = IOHIDUserDeviceCreateWithProperties(
      kCFAllocatorDefault,
      props,
      IOOptionBits(1)
    ) else {
      os_log(
        "IOHIDUserDeviceCreateWithProperties returned nil vid=%{public}d pid=%{public}d desc=%{public}d",
        log: .default,
        type: .error,
        vid,
        pid,
        descriptor.count
      )
      throw HidError.createFailed
    }
    device = created
    IOHIDUserDeviceSetDispatchQueue(created, queue)
    IOHIDUserDeviceSetCancelHandler(created) { [weak self] in
      self?.cancelled.signal()
    }
    IOHIDUserDeviceRegisterSetReportBlock(created) { [weak self] _, _, report, length in
      guard length > 0 else {
        return kIOReturnSuccess
      }
      let data = Data(bytes: report, count: Int(length))
      os_log("hid set-report len=%{public}d", log: .default, type: .info, Int(length))
      self?.onHostReport?(data)
      return kIOReturnSuccess
    }
    IOHIDUserDeviceRegisterGetReportBlock(created) { _, _, report, length in
      let size = length.pointee
      if size > 0 {
        memset(report, 0, size)
      }
      return kIOReturnSuccess
    }
    IOHIDUserDeviceActivate(created)
    os_log(
      "hid up vid=0x%{public}x pid=0x%{public}x name=%{public}@ desc=%{public}d",
      log: .default,
      type: .info,
      vid,
      pid,
      name,
      descriptor.count
    )
  }

  func writeToHost(_ report: Data) throws {
    guard let device, !closed else {
      return
    }
    var status: IOReturn = kIOReturnSuccess
    let work = {
      status = report.withUnsafeBytes { raw in
        guard let base = raw.bindMemory(to: UInt8.self).baseAddress else {
          return kIOReturnSuccess
        }
        return IOHIDUserDeviceHandleReportWithTimeStamp(
          device,
          mach_absolute_time(),
          base,
          report.count
        )
      }
    }
    if DispatchQueue.getSpecific(key: HidDevice.queueKey) != nil {
      work()
    } else {
      queue.sync(execute: work)
    }
    if status != kIOReturnSuccess {
      os_log(
        "hid handle-report failed status=%{public}d len=%{public}d",
        log: .default,
        type: .error,
        Int(status),
        report.count
      )
      throw HidError.reportFailed(Int32(status))
    }
    os_log("hid handle-report len=%{public}d", log: .default, type: .info, report.count)
  }

  func close() {
    if closed {
      return
    }
    closed = true
    guard let device else {
      return
    }
    IOHIDUserDeviceCancel(device)
    _ = cancelled.wait(timeout: .now() + 2)
    self.device = nil
  }

  deinit {
    close()
  }
}
