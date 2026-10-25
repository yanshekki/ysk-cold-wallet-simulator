use super::{emit_input, HidBackend, HidInner};
use napi::bindgen_prelude::*;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

const UHID_DESTROY: u32 = 1;
const UHID_OUTPUT: u32 = 6;
const UHID_GET_REPORT: u32 = 9;
const UHID_GET_REPORT_REPLY: u32 = 10;
const UHID_CREATE2: u32 = 11;
const UHID_INPUT2: u32 = 12;
const UHID_SET_REPORT: u32 = 13;
const UHID_SET_REPORT_REPLY: u32 = 14;
const BUS_USB: u16 = 0x03;
const HID_MAX_DESCRIPTOR: usize = 4096;
const UHID_DATA_MAX: usize = 4096;
const EVENT_SIZE: usize = 4 + 128 + 64 + 64 + 2 + 2 + 4 * 4 + HID_MAX_DESCRIPTOR;

pub struct LinuxHid {
  file: File,
  stop: Arc<AtomicBool>,
  thread: Option<JoinHandle<()>>,
}

impl LinuxHid {
  pub fn open(
    vendor_id: u32,
    product_id: u32,
    name: &str,
    descriptor: &[u8],
    sink: Arc<Mutex<HidInner>>,
  ) -> Result<Self> {
    if descriptor.len() > HID_MAX_DESCRIPTOR {
      return Err(Error::from_reason("HID report descriptor too large"));
    }
    let mut file = OpenOptions::new()
      .read(true)
      .write(true)
      .custom_flags(libc_nonblock())
      .open("/dev/uhid")
      .map_err(|error| {
        Error::from_reason(format!(
          "cannot open /dev/uhid ({error}). Add the udev rule in apps/proxy/udev and replug."
        ))
      })?;
    let mut event = vec![0u8; EVENT_SIZE];
    write_u32(&mut event, 0, UHID_CREATE2);
    write_cstr(&mut event[4..132], name);
    write_cstr(&mut event[132..196], "cws-proxy");
    write_cstr(&mut event[196..260], "cws");
    write_u16(&mut event, 260, descriptor.len() as u16);
    write_u16(&mut event, 262, BUS_USB);
    write_u32(&mut event, 264, vendor_id);
    write_u32(&mut event, 268, product_id);
    write_u32(&mut event, 272, 0x0100);
    write_u32(&mut event, 276, 0);
    event[280..280 + descriptor.len()].copy_from_slice(descriptor);
    file
      .write_all(&event)
      .map_err(|error| Error::from_reason(format!("UHID_CREATE2 failed: {error}")))?;

    let stop = Arc::new(AtomicBool::new(false));
    let mut reader = file
      .try_clone()
      .map_err(|error| Error::from_reason(error.to_string()))?;
    let stop_thread = Arc::clone(&stop);
    let thread = thread::spawn(move || {
      let mut buf = vec![0u8; EVENT_SIZE];
      while !stop_thread.load(Ordering::SeqCst) {
        match reader.read(&mut buf) {
          Ok(0) => break,
          Ok(_) => handle_uhid_event(&mut reader, &buf, &sink),
          Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
            thread::sleep(std::time::Duration::from_millis(10));
          }
          Err(_) => break,
        }
      }
    });

    Ok(Self {
      file,
      stop,
      thread: Some(thread),
    })
  }
}

impl Drop for LinuxHid {
  fn drop(&mut self) {
    self.close();
  }
}

fn handle_uhid_event(file: &mut File, buf: &[u8], sink: &Arc<Mutex<HidInner>>) {
  let kind = read_u32(buf, 0);
  if kind == UHID_OUTPUT {
    let size = read_u16(buf, 4 + UHID_DATA_MAX) as usize;
    let end = 4 + size.min(UHID_DATA_MAX);
    if end > 4 {
      emit_input(sink, buf[4..end].to_vec());
    }
    return;
  }
  if kind == UHID_SET_REPORT {
    let id = read_u32(buf, 4);
    let size = read_u16(buf, 10) as usize;
    let start = 12;
    let end = start + size.min(UHID_DATA_MAX);
    if end <= buf.len() && end > start {
      emit_input(sink, buf[start..end].to_vec());
    }
    let _ = write_set_report_reply(file, id);
    return;
  }
  if kind == UHID_GET_REPORT {
    let id = read_u32(buf, 4);
    let _ = write_get_report_reply(file, id);
  }
}

fn write_set_report_reply(file: &mut File, id: u32) -> std::io::Result<()> {
  let mut event = vec![0u8; 12];
  write_u32(&mut event, 0, UHID_SET_REPORT_REPLY);
  write_u32(&mut event, 4, id);
  write_u16(&mut event, 8, 0);
  file.write_all(&event)
}

fn write_get_report_reply(file: &mut File, id: u32) -> std::io::Result<()> {
  let mut event = vec![0u8; 12];
  write_u32(&mut event, 0, UHID_GET_REPORT_REPLY);
  write_u32(&mut event, 4, id);
  write_u16(&mut event, 8, 0);
  write_u16(&mut event, 10, 0);
  file.write_all(&event)
}

impl HidBackend for LinuxHid {
  fn write_input(&mut self, report: &[u8]) -> std::io::Result<()> {
    let mut event = vec![0u8; 4 + 2 + UHID_DATA_MAX];
    write_u32(&mut event, 0, UHID_INPUT2);
    write_u16(&mut event, 4, report.len() as u16);
    let copy = report.len().min(UHID_DATA_MAX);
    event[6..6 + copy].copy_from_slice(&report[..copy]);
    self.file.write_all(&event)?;
    Ok(())
  }

  fn close(&mut self) {
    self.stop.store(true, Ordering::SeqCst);
    let mut event = vec![0u8; EVENT_SIZE];
    write_u32(&mut event, 0, UHID_DESTROY);
    let _ = self.file.write_all(&event);
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
  }
}

fn libc_nonblock() -> i32 {
  0o4000
}

fn write_u16(buf: &mut [u8], offset: usize, value: u16) {
  buf[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(buf: &mut [u8], offset: usize, value: u32) {
  buf[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn read_u16(buf: &[u8], offset: usize) -> u16 {
  u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

fn read_u32(buf: &[u8], offset: usize) -> u32 {
  u32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

fn write_cstr(buf: &mut [u8], text: &str) {
  let bytes = text.as_bytes();
  let n = bytes.len().min(buf.len().saturating_sub(1));
  buf[..n].copy_from_slice(&bytes[..n]);
}
