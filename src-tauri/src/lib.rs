// Claude Shell — Tauri shell. Hosts the webview, owns the pty terminals, and
// spawns/supervises the Bun sidecar that runs the Claude Agent SDK.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rand::Rng;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child as StdChild, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

struct PtyEntry {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

struct AppState {
    sidecar: Mutex<Option<StdChild>>,
    sidecar_port: Mutex<u16>,
    secret: String,
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
fn pty_create(app: AppHandle, state: State<AppState>, cwd: String) -> Result<String, String> {
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let mut cmd = CommandBuilder::new(shell);
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

fn project_root() -> PathBuf {
    // Dev + local use: the repo root next to src-tauri. (Bundled installs would
    // ship the sidecar as a resource — not wired up yet.)
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn spawn_sidecar(app: AppHandle) {
    let state = app.state::<AppState>();
    let secret = state.secret.clone();
    let mut cmd = Command::new("bun");
    cmd.args(["run", "src/sidecar/index.ts"])
        .current_dir(project_root())
        .env("SIDECAR_SECRET", &secret)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[sidecar] failed to spawn bun: {e}");
            return;
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
}

pub fn run() {
    let secret: String = {
        let mut rng = rand::thread_rng();
        (0..32)
            .map(|_| format!("{:x}", rng.gen_range(0..16)))
            .collect()
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            sidecar: Mutex::new(None),
            sidecar_port: Mutex::new(0),
            secret,
            ptys: Mutex::new(HashMap::new()),
            pty_counter: Mutex::new(0),
        })
        .setup(|app| {
            spawn_sidecar(app.handle().clone());
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
            save_text_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
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
