use btleplug::api::{
  Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
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
use tokio::sync::mpsc;
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
  pub rssi: Option<i16>,
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

async fn disconnect_known() {
  let known = {
    let slot = HUB.lock().await;
    slot
      .as_ref()
      .map(|hub| hub.known.values().cloned().collect::<Vec<_>>())
      .unwrap_or_default()
  };
  for peripheral in known {
    let _ = peripheral.disconnect().await;
  }
}

pub async fn scan_ble(service_uuids: Vec<String>, timeout_ms: u32) -> Result<Vec<ScanResult>> {
  let uuids = service_uuids
    .iter()
    .map(|item| parse_uuid(item))
    .collect::<Result<Vec<_>>>()?;
  disconnect_known().await;
  let adapter = ensure_central().await?;
  let _ = adapter.stop_scan().await;
  // iOS often omits the 128-bit service UUID when the GAP name is long.
  // Filter in JS by UUID *or* advertised name instead of at CoreBluetooth.
  adapter
    .start_scan(ScanFilter { services: Vec::new() })
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
      && !services.is_empty()
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
      rssi: props.rssi,
    });
  }
  Ok(out)
}

fn flags_label(flags: CharPropFlags) -> String {
  let mut parts = Vec::new();
  if flags.contains(CharPropFlags::READ) {
    parts.push("read");
  }
  if flags.contains(CharPropFlags::WRITE) {
    parts.push("write");
  }
  if flags.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
    parts.push("wwr");
  }
  if flags.contains(CharPropFlags::NOTIFY) {
    parts.push("notify");
  }
  if flags.contains(CharPropFlags::INDICATE) {
    parts.push("indicate");
  }
  if parts.is_empty() {
    parts.push("none");
  }
  parts.join(",")
}

pub struct BleDevice {
  peripheral: Peripheral,
  write_char: Characteristic,
  notify_rx: Mutex<Option<mpsc::UnboundedReceiver<Vec<u8>>>>,
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
    let have = if chars.is_empty() {
      "none".to_string()
    } else {
      chars
        .iter()
        .map(|item| format!("{}/{}", item.service_uuid, item.uuid))
        .collect::<Vec<_>>()
        .join(",")
    };
    let write_char = chars
      .iter()
      .find(|item| item.uuid == write)
      .cloned()
      .ok_or_else(|| {
        Error::from_reason(format!(
          "missing write characteristic want={write_uuid} have={have}"
        ))
      })?;
    let notify_char = chars
      .iter()
      .find(|item| item.uuid == notify)
      .cloned()
      .ok_or_else(|| {
        Error::from_reason(format!(
          "missing notify characteristic want={notify_uuid} have={have}"
        ))
      })?;
    // Subscribe to the broadcast *before* CCCD, on this task. Spawning
    // notifications() races subscribe() and btleplug drops those packets.
    let stream = peripheral
      .notifications()
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    let (tx, rx) = mpsc::unbounded_channel();
    RT.spawn(async move {
      let mut stream = stream;
      while let Some(event) = stream.next().await {
        if tx.send(event.value).is_err() {
          break;
        }
      }
    });
    peripheral
      .subscribe(&notify_char)
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?;
    // iOS sometimes drops the first ATT write if it races the CCCD.
    tokio::time::sleep(Duration::from_millis(150)).await;
    if let Some(hub) = HUB.lock().await.as_ref() {
      let _ = hub.adapter.stop_scan().await;
    }
    Ok(Self {
      peripheral,
      write_char,
      notify_rx: Mutex::new(Some(rx)),
    })
  }

  pub fn debug_info(&self) -> String {
    format!(
      "write={} flags={}",
      self.write_char.uuid,
      flags_label(self.write_char.properties)
    )
  }

  pub async fn write(&self, data: &[u8]) -> Result<()> {
    let peripheral = self.peripheral.clone();
    let write_char = self.write_char.clone();
    let payload = data.to_vec();
    // Never WriteWithResponse: macOS CoreBluetooth queues that ATT write
    // until didWriteValue, which iOS/munim often never sends, and then
    // scan/connect on the same central freeze.
    runtime()
      .spawn(async move {
        peripheral
          .write(&write_char, &payload, WriteType::WithoutResponse)
          .await
          .map_err(|error| Error::from_reason(error.to_string()))
      })
      .await
      .map_err(|error| Error::from_reason(error.to_string()))??;
    Ok(())
  }

  pub fn on_notify(&self, callback: JsFunction) -> Result<()> {
    let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::CalleeHandled> = callback
      .create_threadsafe_function(0, |ctx| {
        let buffer = ctx.env.create_buffer_with_data(ctx.value)?;
        Ok(vec![buffer.into_unknown()])
      })?;
    let rx = self.notify_rx.lock().unwrap().take();
    RT.spawn(async move {
      let Some(mut rx) = rx else {
        return;
      };
      while let Some(value) = rx.recv().await {
        tsfn.call(Ok(value), ThreadsafeFunctionCallMode::Blocking);
      }
    });
    Ok(())
  }

  pub async fn disconnect(&self) -> Result<()> {
    let peripheral = self.peripheral.clone();
    runtime()
      .spawn(async move {
        peripheral
          .disconnect()
          .await
          .map_err(|error| Error::from_reason(error.to_string()))
      })
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?
  }

  pub async fn is_connected(&self) -> Result<bool> {
    let peripheral = self.peripheral.clone();
    runtime()
      .spawn(async move {
        peripheral
          .is_connected()
          .await
          .map_err(|error| Error::from_reason(error.to_string()))
      })
      .await
      .map_err(|error| Error::from_reason(error.to_string()))?
  }
}

pub fn runtime() -> &'static Runtime {
  &RT
}
