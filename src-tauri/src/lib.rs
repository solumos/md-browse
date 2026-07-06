use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

/// Pending headless renders: request id → the channel awaiting its captured HTML.
#[derive(Default)]
struct Pending(Mutex<HashMap<u64, oneshot::Sender<String>>>);

static NEXT_REQ: AtomicU64 = AtomicU64::new(1);

/// How long to wait for an offscreen render to report back before giving up.
const RENDER_TIMEOUT: Duration = Duration::from_secs(15);

/// Injected into the offscreen page before its own scripts run. It lets the page's
/// JavaScript build the DOM, waits for it to go quiet, then emits the rendered HTML
/// back as a Tauri event. (The headless webview is granted `core:event:allow-emit`
/// for exactly this — and nothing else — via capabilities/headless.json.)
const CAPTURE_JS: &str = r#"
(function () {
  var REQ = __REQ__;
  var sent = false;
  function send() {
    if (sent) return;
    sent = true;
    try {
      window.__TAURI__.event.emit('headless-capture', {
        reqId: REQ,
        html: document.documentElement.outerHTML,
      });
    } catch (e) {}
  }
  var quiet = null;
  function bump() {
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(send, 900); // fire once the DOM has been quiet ~0.9s
  }
  setTimeout(send, 6000); // hard ceiling regardless of ongoing activity
  try {
    var mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch (e) {}
  window.addEventListener('DOMContentLoaded', bump);
  window.addEventListener('load', bump);
  bump();
})();
"#;

/// Render `url` with JavaScript in an offscreen webview and return the settled DOM's
/// HTML — the fallback when the no-JS fetch/convert produced a near-empty page.
#[tauri::command]
async fn render_with_js(app: AppHandle, url: String) -> Result<String, String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "invalid url".to_string())?;
    let req_id = NEXT_REQ.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel::<String>();
    app.state::<Pending>().0.lock().unwrap().insert(req_id, tx);

    let label = format!("headless-{req_id}");
    let script = CAPTURE_JS.replace("__REQ__", &req_id.to_string());

    let app2 = app.clone();
    let label2 = label.clone();
    let built = app.run_on_main_thread(move || {
        // Must be visible for WKWebView to load/run JS, so park it off-screen,
        // unfocused, and out of the taskbar so the user never sees it.
        let _ = WebviewWindowBuilder::new(&app2, &label2, WebviewUrl::External(parsed))
            .initialization_script(&script)
            .visible(true)
            .focused(false)
            .skip_taskbar(true)
            .position(-4000.0, -4000.0)
            .inner_size(1000.0, 1400.0)
            .build();
    });
    if built.is_err() {
        app.state::<Pending>().0.lock().unwrap().remove(&req_id);
        return Err("could not open a render view".into());
    }

    let result = tokio::time::timeout(RENDER_TIMEOUT, rx).await;

    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    app.state::<Pending>().0.lock().unwrap().remove(&req_id);

    match result {
        Ok(Ok(html)) => Ok(html),
        _ => Err("could not render the page with JavaScript".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending::default())
        .setup(|app| {
            // Offscreen render webviews emit their captured HTML as this event.
            let handle = app.handle().clone();
            app.listen_any("headless-capture", move |ev| {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) else {
                    return;
                };
                let req = v.get("reqId").and_then(|x| x.as_u64());
                let html = v.get("html").and_then(|x| x.as_str()).map(str::to_string);
                if let (Some(req), Some(html)) = (req, html) {
                    if let Some(tx) = handle.state::<Pending>().0.lock().unwrap().remove(&req) {
                        let _ = tx.send(html);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![render_with_js])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
