pub mod sink;
#[cfg(feature = "tauri-adapter")]
pub mod tauri;

pub use sink::{EventSink, SinkTransportAdapter};
#[cfg(feature = "tauri-adapter")]
pub use tauri::TauriTransportAdapter;
