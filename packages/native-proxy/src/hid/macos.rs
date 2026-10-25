use super::{emit_input, HidBackend, HidInner};
use block2::{Block, RcBlock};
use core_foundation::base::TCFType;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use napi::bindgen_prelude::*;
use std::ffi::{c_char, c_void, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

type IOHIDUserDeviceRef = *mut c_void;
type DispatchQueue = *mut c_void;
type IOReturn = i32;
type IOOptionBits = u32;

const K_IO_RETURN_SUCCESS: IOReturn = 0;
const CREATE_ON_ACTIVATE: IOOptionBits = 1;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
  fn IOHIDUserDeviceCreateWithProperties(
    allocator: *const c_void,
    properties: core_foundation::dictionary::CFDictionaryRef,
    options: IOOptionBits,
  ) -> IOHIDUserDeviceRef;
  fn IOHIDUserDeviceSetDispatchQueue(device: IOHIDUserDeviceRef, queue: DispatchQueue);
  fn IOHIDUserDeviceSetCancelHandler(device: IOHIDUserDeviceRef, handler: *mut c_void);
  fn IOHIDUserDeviceRegisterSetReportBlock(device: IOHIDUserDeviceRef, block: *mut c_void);
  fn IOHIDUserDeviceActivate(device: IOHIDUserDeviceRef);
  fn IOHIDUserDeviceCancel(device: IOHIDUserDeviceRef);
  fn IOHIDUserDeviceHandleReportWithTimeStamp(
    device: IOHIDUserDeviceRef,
    timestamp: u64,
    report: *const u8,
    report_length: isize,
  ) -> IOReturn;
}

#[link(name = "System", kind = "dylib")]
extern "C" {
  fn dispatch_queue_create(label: *const c_char, attr: *const c_void) -> DispatchQueue;
  fn mach_absolute_time() -> u64;
}

type SetReportFn = dyn Fn(u32, u32, *const u8, isize) -> IOReturn;
type CancelFn = dyn Fn();

pub struct MacHid {
  device: IOHIDUserDeviceRef,
  cancelled: Arc<(Mutex<bool>, Condvar)>,
  _set_report: RcBlock<SetReportFn>,
  _on_cancel: RcBlock<CancelFn>,
  closed: AtomicBool,
}

unsafe impl Send for MacHid {}

impl MacHid {
  pub fn open(
    vendor_id: u32,
    product_id: u32,
    name: &str,
    descriptor: &[u8],
    sink: Arc<Mutex<HidInner>>,
  ) -> Result<Self> {
    let desc = CFData::from_buffer(descriptor);
    let vendor = CFNumber::from(vendor_id as i32);
    let product = CFNumber::from(product_id as i32);
    let product_name = CFString::new(name);
    let manufacturer = CFString::from_static_string("CWS");
    let serial = CFString::from_static_string("cws-proxy");
    let keys = [
      CFString::from_static_string("ReportDescriptor"),
      CFString::from_static_string("VendorID"),
      CFString::from_static_string("ProductID"),
      CFString::from_static_string("Product"),
      CFString::from_static_string("Manufacturer"),
      CFString::from_static_string("SerialNumber"),
    ];
    let values: Vec<core_foundation::base::CFType> = vec![
      desc.as_CFType(),
      vendor.as_CFType(),
      product.as_CFType(),
      product_name.as_CFType(),
      manufacturer.as_CFType(),
      serial.as_CFType(),
    ];
    let props = CFDictionary::from_CFType_pairs(&[
      (keys[0].as_CFType(), values[0].clone()),
      (keys[1].as_CFType(), values[1].clone()),
      (keys[2].as_CFType(), values[2].clone()),
      (keys[3].as_CFType(), values[3].clone()),
      (keys[4].as_CFType(), values[4].clone()),
      (keys[5].as_CFType(), values[5].clone()),
    ]);

    let device = unsafe {
      IOHIDUserDeviceCreateWithProperties(std::ptr::null(), props.as_concrete_TypeRef(), CREATE_ON_ACTIVATE)
    };
    if device.is_null() {
      return Err(Error::from_reason(
        "IOHIDUserDeviceCreateWithProperties failed. macOS needs the com.apple.developer.hid.virtual.device entitlement on the node binary (see apps/proxy/macos).",
      ));
    }

    let set_report = RcBlock::new(move |_kind: u32, _id: u32, report: *const u8, length: isize| -> IOReturn {
      if report.is_null() || length <= 0 {
        return K_IO_RETURN_SUCCESS;
      }
      let bytes = unsafe { std::slice::from_raw_parts(report, length as usize) }.to_vec();
      emit_input(&sink, bytes);
      K_IO_RETURN_SUCCESS
    });

    let cancelled = Arc::new((Mutex::new(false), Condvar::new()));
    let flag = Arc::clone(&cancelled);
    let on_cancel = RcBlock::new(move || {
      let (lock, signal) = &*flag;
      *lock.lock().unwrap() = true;
      signal.notify_all();
    });

    let label = CString::new("cws.hid").unwrap();
    let queue = unsafe { dispatch_queue_create(label.as_ptr(), std::ptr::null()) };
    if queue.is_null() {
      return Err(Error::from_reason("dispatch_queue_create failed"));
    }

    unsafe {
      IOHIDUserDeviceSetDispatchQueue(device, queue);
      IOHIDUserDeviceSetCancelHandler(device, block_ptr(&on_cancel));
      IOHIDUserDeviceRegisterSetReportBlock(device, block_ptr(&set_report));
      IOHIDUserDeviceActivate(device);
    }

    Ok(Self {
      device,
      cancelled,
      _set_report: set_report,
      _on_cancel: on_cancel,
      closed: AtomicBool::new(false),
    })
  }
}

fn block_ptr<F: ?Sized>(block: &RcBlock<F>) -> *mut c_void {
  let raw: *const Block<F> = &**block;
  raw as *mut c_void
}

impl HidBackend for MacHid {
  fn write_input(&mut self, report: &[u8]) -> std::io::Result<()> {
    let status = unsafe {
      IOHIDUserDeviceHandleReportWithTimeStamp(
        self.device,
        mach_absolute_time(),
        report.as_ptr(),
        report.len() as isize,
      )
    };
    if status != K_IO_RETURN_SUCCESS {
      return Err(std::io::Error::other(format!(
        "IOHIDUserDeviceHandleReportWithTimeStamp {status}"
      )));
    }
    Ok(())
  }

  fn close(&mut self) {
    if self.closed.swap(true, Ordering::SeqCst) {
      return;
    }
    if self.device.is_null() {
      return;
    }
    unsafe { IOHIDUserDeviceCancel(self.device) };
    let (lock, signal) = &*self.cancelled;
    let mut done = lock.lock().unwrap();
    while !*done {
      done = signal.wait(done).unwrap();
    }
    unsafe { core_foundation::base::CFRelease(self.device as *const c_void) };
    self.device = std::ptr::null_mut();
  }
}

impl Drop for MacHid {
  fn drop(&mut self) {
    self.close();
  }
}
