use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

pub(crate) type InputFn = ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled>;

pub(crate) struct HidInner {
  pub callback: Option<InputFn>,
  backend: Box<dyn HidBackend>,
}

pub(crate) trait HidBackend: Send {
  fn write_input(&mut self, report: &[u8]) -> std::io::Result<()>;
  fn close(&mut self);
}

pub struct VirtualHid {
  inner: Arc<Mutex<HidInner>>,
}

struct Placeholder;

impl HidBackend for Placeholder {
  fn write_input(&mut self, _report: &[u8]) -> std::io::Result<()> {
    Err(std::io::Error::other("hid not open"))
  }
  fn close(&mut self) {}
}

impl VirtualHid {
  pub fn open(vendor_id: u32, product_id: u32, name: String, descriptor: &[u8]) -> Result<Self> {
    let inner = Arc::new(Mutex::new(HidInner {
      callback: None,
      backend: Box::new(Placeholder),
    }));
    let backend = open_backend(vendor_id, product_id, &name, descriptor, Arc::clone(&inner))?;
    inner.lock().unwrap().backend = backend;
    Ok(Self { inner })
  }

  pub fn write(&self, report: &[u8]) -> Result<()> {
    self
      .inner
      .lock()
      .map_err(|_| Error::from_reason("hid lock"))?
      .backend
      .write_input(report)
      .map_err(|error| Error::from_reason(error.to_string()))
  }

  pub fn on_input(&self, callback: JsFunction) -> Result<()> {
    let tsfn: InputFn = callback.create_threadsafe_function(0, |ctx| {
      let buffer = ctx.env.create_buffer_with_data(ctx.value)?;
      Ok(vec![buffer.into_unknown()])
    })?;
    self
      .inner
      .lock()
      .map_err(|_| Error::from_reason("hid lock"))?
      .callback = Some(tsfn);
    Ok(())
  }

  pub fn close(&self) {
    if let Ok(mut inner) = self.inner.lock() {
      inner.backend.close();
      inner.callback = None;
    }
  }
}

pub(crate) fn emit_input(inner: &Arc<Mutex<HidInner>>, report: Vec<u8>) {
  if let Ok(guard) = inner.lock() {
    if let Some(callback) = &guard.callback {
      callback.call(Ok(report), ThreadsafeFunctionCallMode::NonBlocking);
    }
  }
}

fn open_backend(
  vendor_id: u32,
  product_id: u32,
  name: &str,
  descriptor: &[u8],
  sink: Arc<Mutex<HidInner>>,
) -> Result<Box<dyn HidBackend>> {
  #[cfg(target_os = "linux")]
  {
    return Ok(Box::new(linux::LinuxHid::open(
      vendor_id, product_id, name, descriptor, sink,
    )?));
  }
  #[cfg(target_os = "macos")]
  {
    return Ok(Box::new(macos::MacHid::open(
      vendor_id, product_id, name, descriptor, sink,
    )?));
  }
  #[cfg(not(any(target_os = "linux", target_os = "macos")))]
  {
    let _ = (vendor_id, product_id, name, descriptor, sink);
    Err(Error::from_reason(
      "virtual HID is only implemented on macOS and Linux",
    ))
  }
}
