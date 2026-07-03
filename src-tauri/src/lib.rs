// Claude Shell — Tauri shell. Hosts the webview, owns the pty terminals, and
// spawns/supervises the Bun sidecar that runs the Claude Agent SDK.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rand::Rng;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child as StdChild, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, UserAttentionType};

struct PtyEntry {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

struct AppState {
    sidecar: Mutex<Option<StdChild>>,
    sidecar_port: Mutex<u16>,
    secret: String,
    exiting: AtomicBool,
    ptys: Mutex<HashMap<String, PtyEntry>>,
    pty_counter: Mutex<u64>,
}

#[derive(serde::Serialize)]
struct SidecarInfo {
    port: u16,
    secret: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyExit {
    id: String,
}

/// Frontend polls this until the sidecar has reported its port.
#[tauri::command]
fn sidecar_info(state: State<AppState>) -> SidecarInfo {
    SidecarInfo {
        port: *state.sidecar_port.lock().unwrap(),
        secret: state.secret.clone(),
    }
}

#[tauri::command]
fn pty_create(
    app: AppHandle,
    state: State<AppState>,
    cwd: String,
    shell: Option<String>,
) -> Result<String, String> {
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell_exe = match shell.as_deref() {
        Some("powershell") => "powershell.exe".to_string(),
        Some("pwsh") => "pwsh.exe".to_string(),
        _ => std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
    };
    let mut cmd = CommandBuilder::new(shell_exe);
    cmd.cwd(cwd);
    let child = pty.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pty.slave);

    let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty.master.take_writer().map_err(|e| e.to_string())?;

    let id = {
        let mut counter = state.pty_counter.lock().unwrap();
        *counter += 1;
        format!("pty-{}", *counter)
    };
    state.ptys.lock().unwrap().insert(
        id.clone(),
        PtyEntry {
            writer,
            master: pty.master,
            child,
        },
    );

    let reader_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app.emit("pty-exit", PtyExit { id: reader_id });
                    break;
                }
                Ok(n) => {
                    let _ = app.emit(
                        "pty-data",
                        PtyData {
                            id: reader_id.clone(),
                            data: String::from_utf8_lossy(&buf[..n]).into_owned(),
                        },
                    );
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
fn pty_write(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let entry = ptys.get_mut(&id).ok_or("pty not found")?;
    entry
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let entry = ptys.get(&id).ok_or("pty not found")?;
    entry
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: State<AppState>, id: String) {
    if let Some(mut entry) = state.ptys.lock().unwrap().remove(&id) {
        let _ = entry.child.kill();
    }
}

/// Fallback when the embedded terminal can't be used: real console window.
#[tauri::command]
fn open_terminal(cwd: String) {
    let _ = Command::new("cmd.exe")
        .args(["/c", "start", "cmd"])
        .current_dir(cwd)
        .spawn();
}

/// External links from chat markdown open in the default browser.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) links".into());
    }
    Command::new("cmd.exe")
        .args(["/c", "start", "", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Used by "export chat" — the save dialog runs in the frontend, we do the write.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

/// Screenshot a URL by loading it in a hidden webview and asking the DevTools
/// protocol for a capture. Uses the app's own WebView2, so it sees the same
/// network the app does (headless browsers are blocked by some VPN filters).
/// Returns base64 PNG.
#[tauri::command]
async fn capture_url(
    app: AppHandle,
    url: String,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    let label = format!(
        "capture-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .visible(false)
        .skip_taskbar(true)
        .inner_size(width, height)
        .build()
        .map_err(|e| e.to_string())?;

    // Give the page time to load and settle (fonts, first paint, dev-server HMR).
    let _ = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(Duration::from_millis(3000));
    })
    .await;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    #[cfg(windows)]
    {
        let tx2 = tx.clone();
        window
            .with_webview(move |webview| unsafe {
                use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
                use windows_core::{HSTRING, PCWSTR};
                let controller = webview.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = tx2.send(Err(format!("no CoreWebView2: {e}")));
                        return;
                    }
                };
                let tx3 = tx2.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |code, json| {
                        if code.is_ok() {
                            let _ = tx3.send(Ok(json));
                        } else {
                            let _ = tx3.send(Err(format!("CDP capture failed: {code:?}")));
                        }
                        Ok(())
                    },
                ));
                let method = HSTRING::from("Page.captureScreenshot");
                let params = HSTRING::from("{\"format\":\"png\"}");
                if let Err(e) = core.CallDevToolsProtocolMethod(
                    PCWSTR(method.as_ptr()),
                    PCWSTR(params.as_ptr()),
                    &handler,
                ) {
                    let _ = tx2.send(Err(format!("CDP call failed: {e}")));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = tx.send(Err("capture only implemented on Windows".into()));
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(12))
            .map_err(|_| "capture timed out".to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = window.close();

    let json = result??;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    value["data"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "no image data in CDP response".to_string())
}

/// Taskbar attention when a notification fires while the window is unfocused.
#[tauri::command]
fn flash_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.request_user_attention(Some(UserAttentionType::Informational));
    }
}

fn project_root() -> PathBuf {
    // Dev: the repo root next to src-tauri.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

/// Packaged builds ship the sidecar as a bundled resource; dev runs it
/// straight from the repo. Both need bun on PATH.
fn sidecar_command(app: &AppHandle, secret: &str) -> Command {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("sidecar").join("sidecar.js"))
        .filter(|p| p.exists());

    let mut cmd = Command::new("bun");
    match bundled {
        Some(bundle) => {
            let dir = bundle.parent().expect("bundle has a dir").to_path_buf();
            cmd.arg("run").arg(&bundle).current_dir(dir);
        }
        None => {
            cmd.args(["run", "src/sidecar/index.ts"])
                .current_dir(project_root());
        }
    }
    cmd.env("SIDECAR_SECRET", secret)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Keeps the sidecar alive for the app's lifetime — if the Bun process dies,
/// the port resets (so the frontend's reconnect loop waits) and it respawns.
fn supervise_sidecar(app: AppHandle) {
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        if state.exiting.load(Ordering::SeqCst) {
            break;
        }

        let mut child = match sidecar_command(&app, &state.secret).spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sidecar] failed to spawn bun: {e}");
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let app2 = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(port) = line.strip_prefix("SIDECAR_PORT=") {
                        if let Ok(port) = port.trim().parse::<u16>() {
                            *app2.state::<AppState>().sidecar_port.lock().unwrap() = port;
                            let _ = app2.emit("sidecar-ready", port);
                        }
                    }
                    println!("[sidecar] {line}");
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("[sidecar] {line}");
                }
            });
        }
        *state.sidecar.lock().unwrap() = Some(child);

        // Poll for exit without holding the lock (RunEvent::Exit needs it to kill).
        loop {
            std::thread::sleep(Duration::from_millis(500));
            if state.exiting.load(Ordering::SeqCst) {
                return;
            }
            let mut guard = state.sidecar.lock().unwrap();
            match guard.as_mut().map(|c| c.try_wait()) {
                Some(Ok(None)) => {} // still running
                _ => {
                    guard.take();
                    break;
                }
            }
        }

        *state.sidecar_port.lock().unwrap() = 0;
        eprintln!("[sidecar] exited — restarting in 1.5s");
        std::thread::sleep(Duration::from_millis(1500));
    });
}

pub fn run() {
    let secret: String = {
        let mut rng = rand::thread_rng();
        (0..32)
            .map(|_| format!("{:x}", rng.gen_range(0..16)))
            .collect()
    };

    tauri::Builder::default()
        // Second launches focus the existing window — two instances would
        // fight over settings, terminals, and the sidecar.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            sidecar: Mutex::new(None),
            sidecar_port: Mutex::new(0),
            secret,
            exiting: AtomicBool::new(false),
            ptys: Mutex::new(HashMap::new()),
            pty_counter: Mutex::new(0),
        })
        .setup(|app| {
            supervise_sidecar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_info,
            pty_create,
            pty_write,
            pty_resize,
            pty_kill,
            open_terminal,
            open_external,
            save_text_file,
            capture_url,
            flash_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.exiting.store(true, Ordering::SeqCst);
                // Sessions and terminals die with their owners.
                if let Some(mut child) = state.sidecar.lock().unwrap().take() {
                    let _ = child.kill();
                }
                for (_, mut entry) in state.ptys.lock().unwrap().drain() {
                    let _ = entry.child.kill();
                }
            }
        });
}
