use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use rss_reader::db::{self, DbState};

use crate::window_lifecycle::ensure_main_window;

const BACKGROUND_TICK_SECONDS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    auto_update: bool,
    update_interval: u64,
    rsshub_domain: Option<String>,
    auto_cleanup_enabled: bool,
    auto_cleanup_days: u32,
    auto_cleanup_except_starred: bool,
    media_cache_enabled: bool,
    media_cache_days: u32,
    media_cache_max_size_mb: Option<u64>,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            auto_update: true,
            update_interval: 15,
            rsshub_domain: Some("https://rsshub.app".to_string()),
            auto_cleanup_enabled: false,
            auto_cleanup_days: 30,
            auto_cleanup_except_starred: true,
            media_cache_enabled: false,
            media_cache_days: 30,
            media_cache_max_size_mb: Some(500),
        }
    }
}

impl RuntimeSettings {
    fn has_cleanup_work(&self) -> bool {
        self.auto_cleanup_enabled || self.media_cache_enabled
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowRestoreContext {
    pub last_route: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedRefreshPayload {
    new_article_ids: Vec<i64>,
    new_article_count: usize,
    updated_article_ids: Vec<i64>,
    updated_article_count: usize,
    feeds_changed: bool,
    deleted_article_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRefreshResponse {
    new_article_ids: Vec<i64>,
    new_article_count: usize,
    updated_article_ids: Vec<i64>,
    updated_article_count: usize,
    feeds_changed: bool,
}

#[derive(Debug, Default)]
pub struct AppRuntimeState {
    pub is_quitting: bool,
    pub main_window_close_requested: bool,
    pub main_window_exists: bool,
    pub settings: RuntimeSettings,
    pub window_context: WindowRestoreContext,
    last_feed_refresh_at: Option<chrono::DateTime<chrono::Utc>>,
    last_cleanup_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl AppRuntimeState {
    fn apply_settings(&mut self, settings: RuntimeSettings) {
        if !self.settings.has_cleanup_work() && settings.has_cleanup_work() {
            self.last_cleanup_at = None;
        }
        self.settings = settings;
    }
}

#[derive(Clone)]
pub struct AppRuntime(pub Arc<Mutex<AppRuntimeState>>);

#[tauri::command]
pub fn sync_runtime_settings(
    settings: RuntimeSettings,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<(), String> {
    let mut runtime = runtime.0.lock().map_err(|e| e.to_string())?;
    runtime.apply_settings(settings);
    Ok(())
}

#[tauri::command]
pub fn sync_window_context(
    context: WindowRestoreContext,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<(), String> {
    let mut runtime = runtime.0.lock().map_err(|e| e.to_string())?;
    runtime.window_context = context;
    Ok(())
}

#[tauri::command]
pub fn get_window_restore_context(
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<WindowRestoreContext, String> {
    let runtime = runtime.0.lock().map_err(|e| e.to_string())?;
    Ok(runtime.window_context.clone())
}

#[tauri::command]
pub fn show_or_create_main_window(
    app_handle: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<(), String> {
    ensure_main_window(&app_handle, &runtime.0)
}

#[tauri::command]
pub fn request_quit(
    app_handle: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<(), String> {
    {
        let mut runtime = runtime.0.lock().map_err(|e| e.to_string())?;
        runtime.is_quitting = true;
    }
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn run_feed_refresh(
    app_handle: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<FeedRefreshResponse, String> {
    run_feed_refresh_internal(&app_handle, &runtime.0, true).await
}

pub async fn run_cleanup_if_needed(
    app: &AppHandle,
    runtime_state: &Arc<Mutex<AppRuntimeState>>,
    force: bool,
) -> Result<(), String> {
    let settings = {
        let runtime = runtime_state.lock().map_err(|e| e.to_string())?;
        runtime.settings.clone()
    };

    if !force {
        let last_cleanup_at = {
            let runtime = runtime_state.lock().map_err(|e| e.to_string())?;
            runtime.last_cleanup_at
        };
        if let Some(last_cleanup_at) = last_cleanup_at {
            if chrono::Utc::now() - last_cleanup_at < chrono::Duration::hours(24) {
                return Ok(());
            }
        }
    }

    let mut cleanup_ran = false;
    let mut deleted_article_count = 0;

    if settings.auto_cleanup_enabled {
        cleanup_ran = true;
        deleted_article_count = db::cache::clean_articles(
            app.state::<DbState>(),
            settings.auto_cleanup_days,
            settings.auto_cleanup_except_starred,
        )?;
    }

    if settings.media_cache_enabled {
        cleanup_ran = true;
        db::cache::clean_media_cache(
            app.clone(),
            settings.media_cache_days,
            settings.media_cache_max_size_mb,
        )?;
    }

    if cleanup_ran {
        let mut runtime = runtime_state.lock().map_err(|e| e.to_string())?;
        runtime.last_cleanup_at = Some(chrono::Utc::now());
    }

    if deleted_article_count > 0 {
        app.emit(
            "app-runtime://feeds-updated",
            FeedRefreshPayload {
                new_article_ids: Vec::new(),
                new_article_count: 0,
                updated_article_ids: Vec::new(),
                updated_article_count: 0,
                feeds_changed: true,
                deleted_article_count,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

async fn run_feed_refresh_internal(
    app: &AppHandle,
    runtime_state: &Arc<Mutex<AppRuntimeState>>,
    force: bool,
) -> Result<FeedRefreshResponse, String> {
    let settings = {
        let runtime = runtime_state.lock().map_err(|e| e.to_string())?;
        runtime.settings.clone()
    };

    if !force && !settings.auto_update {
        return Ok(FeedRefreshResponse {
            new_article_ids: Vec::new(),
            new_article_count: 0,
            updated_article_ids: Vec::new(),
            updated_article_count: 0,
            feeds_changed: false,
        });
    }

    let outcome =
        db::update_all_feeds_with_outcome(app.state::<DbState>(), settings.rsshub_domain).await?;
    let new_article_ids = outcome
        .new_articles
        .iter()
        .map(|article| article.id)
        .collect::<Vec<_>>();
    let payload = FeedRefreshPayload {
        new_article_ids: new_article_ids.clone(),
        new_article_count: new_article_ids.len(),
        updated_article_ids: outcome.updated_article_ids.clone(),
        updated_article_count: outcome.updated_article_ids.len(),
        feeds_changed: outcome.feed_changed,
        deleted_article_count: 0,
    };

    {
        let mut runtime = runtime_state.lock().map_err(|e| e.to_string())?;
        runtime.last_feed_refresh_at = Some(chrono::Utc::now());
    }

    if outcome.has_ui_changes() {
        app.emit("app-runtime://feeds-updated", payload)
            .map_err(|e| e.to_string())?;
    }

    Ok(FeedRefreshResponse {
        new_article_ids,
        new_article_count: outcome.new_articles.len(),
        updated_article_ids: outcome.updated_article_ids.clone(),
        updated_article_count: outcome.updated_article_ids.len(),
        feeds_changed: outcome.feed_changed,
    })
}

pub async fn background_scheduler(app: AppHandle, runtime_state: Arc<Mutex<AppRuntimeState>>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(BACKGROUND_TICK_SECONDS)).await;

        let (is_quitting, settings, last_feed_refresh_at) = match runtime_state.lock() {
            Ok(runtime) => (
                runtime.is_quitting,
                runtime.settings.clone(),
                runtime.last_feed_refresh_at,
            ),
            Err(_) => continue,
        };

        if is_quitting {
            break;
        }

        if settings.auto_update {
            let should_refresh = last_feed_refresh_at
                .map(|last_refresh| {
                    chrono::Utc::now() - last_refresh
                        >= chrono::Duration::minutes(settings.update_interval as i64)
                })
                .unwrap_or(true);

            if should_refresh {
                let _ = run_feed_refresh_internal(&app, &runtime_state, false).await;
            }
        }

        let _ = run_cleanup_if_needed(&app, &runtime_state, false).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabling_cleanup_resets_the_cleanup_gate() {
        let mut runtime = AppRuntimeState::default();
        runtime.last_cleanup_at = Some(chrono::Utc::now());

        let mut settings = RuntimeSettings::default();
        settings.auto_cleanup_enabled = true;

        runtime.apply_settings(settings);

        assert!(runtime.last_cleanup_at.is_none());
    }

    #[test]
    fn disabled_cleanup_features_do_not_count_as_a_cleanup_run() {
        let settings = RuntimeSettings::default();

        assert!(!settings.has_cleanup_work());
    }
}
