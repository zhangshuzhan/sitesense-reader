use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size};

use crate::app_runtime::AppRuntimeState;

pub const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_RESTORED_WIDTH: f64 = 800.0;
const MIN_RESTORED_HEIGHT: f64 = 600.0;
const FALLBACK_MAX_RESTORED_WIDTH: f64 = 2400.0;
const FALLBACK_MAX_RESTORED_HEIGHT: f64 = 1600.0;
const MONITOR_MARGIN: f64 = 40.0;

#[derive(Debug, Clone, Copy)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedWindowState {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub maximized: bool,
    pub last_route: Option<String>,
}

fn window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join(WINDOW_STATE_FILE))
}

pub fn load_saved_window_state(app: &AppHandle) -> SavedWindowState {
    let Ok(path) = window_state_path(app) else {
        return SavedWindowState::default();
    };

    std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<SavedWindowState>(&contents).ok())
        .unwrap_or_default()
}

pub fn save_window_state(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let position = window
        .outer_position()
        .ok()
        .map(|value| value.to_logical::<f64>(scale_factor));
    let size = window
        .inner_size()
        .ok()
        .map(|value| value.to_logical::<f64>(scale_factor));
    let (max_width, max_height) = restored_size_limits(&window);
    let maximized = window.is_maximized().unwrap_or(false);
    let route = {
        let runtime = app.state::<crate::app_runtime::AppRuntime>();
        let route = runtime
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .window_context
            .last_route
            .clone();
        route
    };

    let state = SavedWindowState {
        x: position.map(|value| value.x),
        y: position.map(|value| value.y),
        width: size.map(|value| clamp_dimension(value.width, MIN_RESTORED_WIDTH, max_width)),
        height: size.map(|value| clamp_dimension(value.height, MIN_RESTORED_HEIGHT, max_height)),
        maximized,
        last_route: route,
    };

    let path = window_state_path(app)?;
    let payload = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(path, payload).map_err(|e| e.to_string())
}

fn apply_saved_window_state(
    window: &tauri::WebviewWindow,
    state: &SavedWindowState,
) -> Result<(), String> {
    let restored_size = sanitized_restored_size(window, state);

    if let Some((width, height)) = restored_size {
        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    }

    if let Some((x, y)) = sanitized_restored_position(window, state, restored_size) {
        window
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
    }

    if state.maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn restored_monitor_rect(window: &tauri::WebviewWindow) -> LogicalRect {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let position = monitor.position().to_logical::<f64>(scale_factor);
        let size = monitor.size().to_logical::<f64>(scale_factor);
        return LogicalRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        };
    }

    LogicalRect {
        x: 0.0,
        y: 0.0,
        width: FALLBACK_MAX_RESTORED_WIDTH,
        height: FALLBACK_MAX_RESTORED_HEIGHT,
    }
}

fn restored_size_limits(window: &tauri::WebviewWindow) -> (f64, f64) {
    let monitor = restored_monitor_rect(window);
    (
        (monitor.width - MONITOR_MARGIN).max(MIN_RESTORED_WIDTH),
        (monitor.height - MONITOR_MARGIN).max(MIN_RESTORED_HEIGHT),
    )
}

fn sanitized_restored_size(
    window: &tauri::WebviewWindow,
    state: &SavedWindowState,
) -> Option<(f64, f64)> {
    let (max_width, max_height) = restored_size_limits(window);
    sanitized_size(state.width, state.height, max_width, max_height)
}

fn sanitized_size(
    width: Option<f64>,
    height: Option<f64>,
    max_width: f64,
    max_height: f64,
) -> Option<(f64, f64)> {
    let width = width?;
    let height = height?;

    if !width.is_finite() || !height.is_finite() {
        return None;
    }

    Some((
        clamp_dimension(width, MIN_RESTORED_WIDTH, max_width),
        clamp_dimension(height, MIN_RESTORED_HEIGHT, max_height),
    ))
}

fn clamp_dimension(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max.max(min))
}

fn current_window_size(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale_factor);
    Some((size.width, size.height))
}

fn sanitized_restored_position(
    window: &tauri::WebviewWindow,
    state: &SavedWindowState,
    restored_size: Option<(f64, f64)>,
) -> Option<(f64, f64)> {
    if state.x.is_none() || state.y.is_none() {
        return None;
    }

    let (width, height) = restored_size.or_else(|| current_window_size(window))?;
    let monitor = restored_monitor_rect(window);
    sanitized_position_in_rect(state.x, state.y, width, height, monitor)
        .or_else(|| Some(centered_position_in_rect(width, height, monitor)))
}

#[cfg(test)]
fn sanitized_position(
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
    monitor_width: f64,
    monitor_height: f64,
) -> Option<(f64, f64)> {
    sanitized_position_in_rect(
        x,
        y,
        width,
        height,
        LogicalRect {
            x: 0.0,
            y: 0.0,
            width: monitor_width,
            height: monitor_height,
        },
    )
}

fn sanitized_position_in_rect(
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
    monitor: LogicalRect,
) -> Option<(f64, f64)> {
    let x = x?;
    let y = y?;
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return None;
    }

    let window = LogicalRect {
        x,
        y,
        width,
        height,
    };
    if rects_intersect(window, monitor) {
        Some((x, y))
    } else {
        None
    }
}

fn rects_intersect(a: LogicalRect, b: LogicalRect) -> bool {
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

#[cfg(test)]
fn centered_position(
    width: f64,
    height: f64,
    monitor_width: f64,
    monitor_height: f64,
) -> (f64, f64) {
    centered_position_in_rect(
        width,
        height,
        LogicalRect {
            x: 0.0,
            y: 0.0,
            width: monitor_width,
            height: monitor_height,
        },
    )
}

fn centered_position_in_rect(width: f64, height: f64, monitor: LogicalRect) -> (f64, f64) {
    (
        monitor.x + ((monitor.width - width) / 2.0).max(0.0),
        monitor.y + ((monitor.height - height) / 2.0).max(0.0),
    )
}

pub fn restore_and_show_main_window(app: &AppHandle) -> Result<(), String> {
    let saved_state = load_saved_window_state(app);
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    apply_saved_window_state(&window, &saved_state)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_main_window(
    app: &AppHandle,
    runtime: &Arc<Mutex<AppRuntimeState>>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
        runtime.main_window_exists = true;
        return Ok(());
    }

    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .or_else(|| app.config().app.windows.first())
        .ok_or_else(|| "Missing main window config".to_string())?
        .clone();

    let window = tauri::WebviewWindowBuilder::from_config(app, &window_config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    let saved_state = load_saved_window_state(app);
    apply_saved_window_state(&window, &saved_state)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
    runtime.main_window_close_requested = false;
    runtime.main_window_exists = true;
    if runtime.window_context.last_route.is_none() {
        runtime.window_context.last_route = saved_state.last_route;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_size_clamps_corrupted_saved_width() {
        let size = sanitized_size(Some(36740.0), Some(1626.0), 1440.0, 900.0).unwrap();

        assert_eq!(size, (1440.0, 900.0));
    }

    #[test]
    fn sanitized_size_ignores_invalid_values() {
        assert_eq!(
            sanitized_size(Some(f64::INFINITY), Some(800.0), 1440.0, 900.0),
            None
        );
        assert_eq!(sanitized_size(Some(1200.0), None, 1440.0, 900.0), None);
    }

    #[test]
    fn sanitized_size_respects_minimum_window_size() {
        let size = sanitized_size(Some(100.0), Some(100.0), 1440.0, 900.0).unwrap();

        assert_eq!(size, (MIN_RESTORED_WIDTH, MIN_RESTORED_HEIGHT));
    }

    #[test]
    fn sanitized_position_rejects_offscreen_coordinates() {
        assert_eq!(
            sanitized_position(Some(36740.0), Some(1200.0), 800.0, 600.0, 1440.0, 900.0),
            None
        );
    }

    #[test]
    fn centered_position_uses_visible_monitor_area() {
        assert_eq!(
            centered_position(800.0, 600.0, 1440.0, 900.0),
            (320.0, 150.0)
        );
    }
}
