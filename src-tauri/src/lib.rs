use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct BackendState {
    base_url: Mutex<Option<String>>,
    public_base_url: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackendReady {
    base_url: String,
    public_base_url: Option<String>,
}

#[derive(Deserialize)]
struct BackendReadyMessage {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "publicBaseUrl")]
    public_base_url: Option<String>,
}

#[tauri::command]
fn get_backend_url(state: State<'_, BackendState>) -> Option<String> {
    state.base_url.lock().ok().and_then(|url| url.clone())
}

#[tauri::command]
fn get_public_base_url(state: State<'_, BackendState>) -> Option<String> {
    state.public_base_url.lock().ok().and_then(|url| url.clone())
}

fn app_data_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    let backups = app_data.join("backups");
    fs::create_dir_all(&backups)?;
    Ok((app_data.join("fun-run.sqlite"), backups))
}

fn resolve_backend_entry(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let entry = app.path().resolve("backend-runtime/src/server.js", BaseDirectory::Resource)?;
    if !entry.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("Backend entry not found: {}", entry.display())).into());
    }
    Ok(entry)
}

fn resolve_node_sidecar(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(sidecar) = app.path().resolve("node.exe", BaseDirectory::Resource) {
        if sidecar.is_file() {
            return Ok(sidecar);
        }
    }

    let staged = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("node-x86_64-pc-windows-msvc.exe");
    if staged.is_file() {
        return Ok(staged);
    }

    let sibling = std::env::current_exe()?.with_file_name("node.exe");
    if sibling.is_file() {
        return Ok(sibling);
    }

    Err(io::Error::new(io::ErrorKind::NotFound, "Bundled Node runtime was not found").into())
}

fn node_script_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    if let Some(path) = path.to_string_lossy().strip_prefix(r"\\?\") {
        return PathBuf::from(path);
    }
    path.to_path_buf()
}

fn start_backend(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let (database_path, backup_dir) = app_data_paths(&handle)?;
    let entry = resolve_backend_entry(&handle)?;
    let node = resolve_node_sidecar(&handle)?;
    eprintln!("Starting race service: {} {}", node.display(), entry.display());

    let mut command = Command::new(node);
    command
        .arg(node_script_path(&entry))
        .env("HOST", "127.0.0.1")
        .env("PORT", "0")
        .env("DATABASE_PATH", database_path)
        .env("BACKUP_DIR", backup_dir)
        .env("TAURI_SIDECAR", "1")
        .env("SERVE_FRONTEND", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Ok(public_frontend) = app.path().resolve("public-frontend", BaseDirectory::Resource) {
        if public_frontend.join("index.html").is_file() {
            command
                .env("LAN_SHARING", "1")
                .env("PUBLIC_FRONTEND_DIST", public_frontend);
        }
    }

    // A stable marker makes this reset run once in the next packaged release.
    // It is intentionally absent from debug builds and future launches.
    if !cfg!(debug_assertions) {
        command.env("CLEAN_START_TOKEN", "first-clean-package-2026-10");
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| io::Error::other("Could not capture race service output"))?;
    let stderr = child.stderr.take().ok_or_else(|| io::Error::other("Could not capture race service errors"))?;
    app.manage(BackendState {
        base_url: Mutex::new(None),
        public_base_url: Mutex::new(None),
        child: Mutex::new(Some(child)),
    });

    let stdout_handle = handle.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if let Some(json) = line.trim().strip_prefix("SIDECAR_READY:") {
                        match serde_json::from_str::<BackendReadyMessage>(json) {
                            Ok(ready) => publish_ready(&stdout_handle, ready.base_url, ready.public_base_url),
                            Err(error) => eprintln!("Could not parse race service readiness message: {error}"),
                        }
                    } else if !line.trim().is_empty() {
                        println!("[race-service] {line}");
                    }
                }
                Err(error) => eprintln!("Could not read race service output: {error}"),
            }
        }
        if let Some(state) = stdout_handle.try_state::<BackendState>() {
            if let Ok(mut url) = state.base_url.lock() { *url = None; }
            if let Ok(mut url) = state.public_base_url.lock() { *url = None; }
        }
        eprintln!("Race service output closed.");
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => eprintln!("[race-service] {line}"),
                Ok(_) => {}
                Err(error) => eprintln!("Could not read race service errors: {error}"),
            }
        }
    });
    Ok(())
}

fn publish_ready(app: &AppHandle, base_url: String, public_base_url: Option<String>) {
    if let Some(state) = app.try_state::<BackendState>() {
        if let Ok(mut current) = state.base_url.lock() { *current = Some(base_url.clone()); }
        if let Ok(mut current) = state.public_base_url.lock() { *current = public_base_url.clone(); }
    }
    if let Err(error) = app.emit("backend-ready", BackendReady { base_url, public_base_url }) {
        eprintln!("Could not notify the frontend that the race service is ready: {error}");
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![get_backend_url, get_public_base_url])
        .setup(|app| start_backend(app))
        .build(tauri::generate_context!())
        .expect("error while building Sunday Stride");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = handle.try_state::<BackendState>() {
                if let Ok(mut child) = state.child.lock() {
                    if let Some(mut process) = child.take() {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                }
            }
        }
    });
}
