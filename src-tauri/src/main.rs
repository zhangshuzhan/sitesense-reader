mod app_menu;
mod app_runtime;
mod commands;
mod media_protocol;
mod window_lifecycle;

use std::sync::{Arc, Mutex};

use app_menu::{build_app_menu, MENU_ID_QUIT};
use app_runtime::{background_scheduler, run_cleanup_if_needed, AppRuntime, AppRuntimeState};
use rss_reader::db::{get_legacy_db_paths, init_database_at_path};
use tauri::{Manager, RunEvent};
use window_lifecycle::{
    load_saved_window_state, restore_and_show_main_window, save_window_state, MAIN_WINDOW_LABEL,
};
#[cfg(target_os = "macos")]
use window_lifecycle::ensure_main_window;

fn init_database(app: &mut tauri::App) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Cannot create data dir: {e}"))?;

    let db_path = data_dir.join("rss.db");
    if !db_path.exists() {
        for legacy in get_legacy_db_paths() {
            if legacy == db_path || !legacy.exists() {
                continue;
            }

            eprintln!("Migrating database from {:?} to {:?}", legacy, db_path);
            if let Err(error) = std::fs::copy(&legacy, &db_path) {
                eprintln!("Warning: Migration copy failed: {error}");
            }
            break;
        }
    }

    let conn = init_database_at_path(&db_path)
        .map_err(|e| format!("Failed to initialize database: {e}"))?;
    app.manage(Mutex::new(conn));
    Ok(())
}

fn main() {
    let runtime_state = Arc::new(Mutex::new(AppRuntimeState::default()));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppRuntime(runtime_state.clone()));

    let builder = media_protocol::register(builder)
        .setup(move |app| {
            init_database(app)?;

            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu).map_err(|e| e.to_string())?;

            {
                let runtime = app.state::<AppRuntime>();
                let mut runtime = runtime.0.lock().map_err(|e| e.to_string())?;
                runtime.main_window_exists = app.get_webview_window(MAIN_WINDOW_LABEL).is_some();
                runtime.window_context.last_route =
                    load_saved_window_state(app.handle()).last_route;
            }

            restore_and_show_main_window(app.handle())?;

            let scheduler_app = app.handle().clone();
            let scheduler_state = runtime_state.clone();
            tauri::async_runtime::spawn(async move {
                let _ = run_cleanup_if_needed(&scheduler_app, &scheduler_state, true).await;
                background_scheduler(scheduler_app, scheduler_state).await;
            });

            Ok(())
        })
        .invoke_handler(commands::handler());

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app_handle, event| match event {
        RunEvent::MenuEvent(event) if event.id().as_ref() == MENU_ID_QUIT => {
            let runtime = app_handle.state::<AppRuntime>();
            if let Ok(mut runtime) = runtime.0.lock() {
                runtime.is_quitting = true;
            }
            app_handle.exit(0);
        }
        RunEvent::ExitRequested { api, code, .. } => {
            let should_prevent = {
                let runtime = app_handle.state::<AppRuntime>();
                let mut runtime = match runtime.0.lock() {
                    Ok(runtime) => runtime,
                    Err(_) => return,
                };

                if code.is_some() {
                    runtime.is_quitting = true;
                    false
                } else if runtime.is_quitting {
                    false
                } else if runtime.main_window_close_requested {
                    runtime.main_window_close_requested = false;
                    true
                } else {
                    false
                }
            };

            if should_prevent {
                api.prevent_exit();
            }
        }
        RunEvent::WindowEvent { label, event, .. } if label == MAIN_WINDOW_LABEL => match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                let _ = save_window_state(app_handle);
                let runtime = app_handle.state::<AppRuntime>();
                if let Ok(mut runtime) = runtime.0.lock() {
                    runtime.main_window_close_requested = true;
                };
            }
            tauri::WindowEvent::Destroyed => {
                let runtime = app_handle.state::<AppRuntime>();
                if let Ok(mut runtime) = runtime.0.lock() {
                    runtime.main_window_exists = false;
                    if runtime.main_window_close_requested {
                        let runtime_state = app_handle.state::<AppRuntime>().0.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            if let Ok(mut runtime) = runtime_state.lock() {
                                if !runtime.main_window_exists {
                                    runtime.main_window_close_requested = false;
                                }
                            }
                        });
                    }
                };
            }
            tauri::WindowEvent::Focused(_) => {
                let runtime = app_handle.state::<AppRuntime>();
                if let Ok(mut runtime) = runtime.0.lock() {
                    runtime.main_window_exists = true;
                };
            }
            _ => {}
        },
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                let runtime = app_handle.state::<AppRuntime>();
                let _ = ensure_main_window(app_handle, &runtime.0);
            }
        }
        RunEvent::Exit => {
            let _ = save_window_state(app_handle);
        }
        _ => {}
    });
}
