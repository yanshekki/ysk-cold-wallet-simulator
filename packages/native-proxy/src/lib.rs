#![deny(clippy::all)]

mod ble;
mod hid;

use napi::bindgen_prelude::*;
use napi::JsFunction;
use napi_derive::napi;

#[napi]
pub fn native_ok() -> bool {
  true
}

#[napi]
pub struct VirtualHid {
  inner: hid::VirtualHid,
}

#[napi]
impl VirtualHid {
  #[napi(constructor)]
  pub fn new(vendor_id: u32, product_id: u32, name: String, report_descriptor: Buffer) -> Result<Self> {
    Ok(Self {
      inner: hid::VirtualHid::open(vendor_id, product_id, name, report_descriptor.as_ref())?,
    })
  }

  #[napi]
  pub fn write(&self, report: Buffer) -> Result<()> {
    self.inner.write(report.as_ref())
  }

  #[napi]
  pub fn on_input(&self, callback: JsFunction) -> Result<()> {
    self.inner.on_input(callback)
  }

  #[napi]
  pub fn close(&self) {
    self.inner.close();
  }
}

#[napi(object)]
pub struct ScanResult {
  pub id: String,
  pub name: String,
  pub services: Vec<String>,
  pub rssi: Option<i16>,
}

#[napi]
pub async fn scan_ble(service_uuids: Vec<String>, timeout_ms: u32) -> Result<Vec<ScanResult>> {
  let rows = ble::runtime()
    .spawn(ble::scan_ble(service_uuids, timeout_ms))
    .await
    .map_err(|error| Error::from_reason(error.to_string()))??;
  Ok(
    rows
      .into_iter()
      .map(|row| ScanResult {
        id: row.id,
        name: row.name,
        services: row.services,
        rssi: row.rssi,
      })
      .collect(),
  )
}

#[napi]
pub struct BleDevice {
  inner: ble::BleDevice,
}

#[napi]
impl BleDevice {
  #[napi]
  pub fn debug_info(&self) -> String {
    self.inner.debug_info()
  }

  #[napi]
  pub async fn write(&self, data: Buffer) -> Result<()> {
    self.inner.write(data.as_ref()).await
  }

  #[napi]
  pub fn on_notify(&self, callback: JsFunction) -> Result<()> {
    self.inner.on_notify(callback)
  }

  #[napi]
  pub async fn disconnect(&self) -> Result<()> {
    self.inner.disconnect().await
  }

  #[napi]
  pub async fn is_connected(&self) -> Result<bool> {
    self.inner.is_connected().await
  }
}

#[napi]
pub async fn connect_ble(id: String, write_uuid: String, notify_uuid: String) -> Result<BleDevice> {
  let inner = ble::runtime()
    .spawn(ble::BleDevice::connect(id, write_uuid, notify_uuid))
    .await
    .map_err(|error| Error::from_reason(error.to_string()))??;
  Ok(BleDevice { inner })
}
