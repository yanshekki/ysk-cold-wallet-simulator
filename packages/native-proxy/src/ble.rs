use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use once_cell::sync::Lazy;
use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use std::time::Duration;
use tokio::runtime::Runtime;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

static RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().expect("tokio runtime"));

struct BleHub {
  _manager: Manager,
  adapter: Adapter,
  known: HashMap<String, Peripheral>,
}

static HUB: Lazy<AsyncMutex<Option<BleHub>>> = Lazy::new(|| AsyncMutex::new(None));

pub struct ScanResult {
  pub id: String,
  pub name: String,
  pub services: Vec<String>,
}

fn parse_uuid(value: &str) -> Result<Uuid> {
  Uuid::parse_str(value).map_err(|error| Error::from_reason(format!("bad UUID {value}: {error}")))
}

async fn ensure_central() -> Result<Adapter> {
  let mut slot = HUB.lock().await;
  if let Some(hub) = slot.as_ref() {
    return Ok(hub.adapter.clone());
  }
  let manager = Manager::new()
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?;
  let adapter = manager
    .adapters()
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?
    .into_iter()
    .next()
    .ok_or_else(|| Error::from_reason("no Bluetooth adapter"))?;
  let cloned = adapter.clone();
  *slot = Some(BleHub {
    _manager: manager,
    adapter,
    known: HashMap::new(),
  });
  Ok(cloned)
}

async fn remember(peripherals: Vec<Peripheral>) {
  let mut slot = HUB.lock().await;
  if let Some(hub) = slot.as_mut() {
    hub.known.clear();
    for peripheral in peripherals {
      hub.known.insert(peripheral.id().to_string(), peripheral);
    }
  }
}

async fn known(id: &str) -> Option<Peripheral> {
  let slot = HUB.lock().await;
  slot.as_ref().and_then(|hub| hub.known.get(id).cloned())
}

pub async fn scan_ble(service_uuids: Vec<String>, timeout_ms: u32) -> Result<Vec<ScanResult>> {
  let uuids = service_uuids
    .iter()
    .map(|item| parse_uuid(item))
    .collect::<Result<Vec<_>>>()?;
  let adapter = ensure_central().await?;
  let _ = adapter.stop_scan().await;
  adapter
    .start_scan(ScanFilter {
      services: uuids.clone(),
    })
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?;
  tokio::time::sleep(Duration::from_millis(timeout_ms.max(300) as u64)).await;
  let peripherals = adapter
    .peripherals()
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?;
  remember(peripherals.clone()).await;
  let mut out = Vec::new();
  for peripheral in peripherals {
    let props = peripheral
      .properties()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    let Some(props) = props else {
      continue;
    };
    let services: BTreeSet<String> = props.services.iter().map(|uuid| uuid.to_string()).collect();
    if !uuids.is_empty()
      && !uuids
        .iter()
        .any(|uuid| props.services.iter().any(|item| item == uuid))
    {
      continue;
    }
    out.push(ScanResult {
      id: peripheral.id().to_string(),
      name: props.local_name.unwrap_or_default(),
      services: services.into_iter().collect(),
    });
  }
  Ok(out)
}

pub struct BleDevice {
  peripheral: Peripheral,
  write_char: Characteristic,
  notify_char: Characteristic,
  notify: Mutex<Option<ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled>>>,
}

impl BleDevice {
  pub async fn connect(id: String, write_uuid: String, notify_uuid: String) -> Result<Self> {
    let write = parse_uuid(&write_uuid)?;
    let notify = parse_uuid(&notify_uuid)?;
    let peripheral = known(&id)
      .await
      .ok_or_else(|| Error::from_reason(format!("BLE device {id} not found. Scan first.")))?;
    peripheral
      .connect()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    peripheral
      .discover_services()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    let chars = peripheral.characteristics();
    let write_char = chars
      .iter()
      .find(|item| item.uuid == write)
      .cloned()
      .ok_or_else(|| Error::from_reason(format!("missing write characteristic {write_uuid}")))?;
    let notify_char = chars
      .iter()
      .find(|item| item.uuid == notify)
      .cloned()
      .ok_or_else(|| Error::from_reason(format!("missing notify characteristic {notify_uuid}")))?;
    peripheral
      .subscribe(&notify_char)
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    if let Some(hub) = HUB.lock().await.as_ref() {
      let _ = hub.adapter.stop_scan().await;
    }
    Ok(Self {
      peripheral,
      write_char,
      notify_char,
      notify: Mutex::new(None),
    })
  }

  pub async fn write(&self, data: &[u8]) -> Result<()> {
    self
      .peripheral
      .write(&self.write_char, data, WriteType::WithResponse)
      .await
      .map_err(|error| Error::from_reason(error.to_string()))
  }

  pub fn on_notify(&self, callback: JsFunction) -> Result<()> {
    let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled> = callback
      .create_threadsafe_function(0, |ctx| {
        let buffer = ctx.env.create_buffer_with_data(ctx.value)?;
        Ok(vec![buffer.into_unknown()])
      })?;
    *self.notify.lock().unwrap() = Some(tsfn.clone());
    let peripheral = self.peripheral.clone();
    RT.spawn(async move {
      let Ok(mut stream) = peripheral.notifications().await else {
        return;
      };
      while let Some(event) = stream.next().await {
        tsfn.call(Ok(event.value), ThreadsafeFunctionCallMode::NonBlocking);
      }
    });
    let _ = &self.notify_char;
    Ok(())
  }

  pub async fn disconnect(&self) -> Result<()> {
    self
      .peripheral
      .disconnect()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))
  }

  pub async fn is_connected(&self) -> Result<bool> {
    self
      .peripheral
      .is_connected()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))
  }
}

pub fn runtime() -> &'static Runtime {
  &RT
}
