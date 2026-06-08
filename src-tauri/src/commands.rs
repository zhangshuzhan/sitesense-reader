use std::process::Command;

use rss_reader::ai;
use rss_reader::db;

use crate::media_protocol;

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http/https links are supported".to_string()),
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        media_protocol::cache_media,
        open_external_url,
        crate::app_runtime::sync_runtime_settings,
        crate::app_runtime::sync_window_context,
        crate::app_runtime::get_window_restore_context,
        crate::app_runtime::show_or_create_main_window,
        crate::app_runtime::request_quit,
        crate::app_runtime::run_feed_refresh,
        ai::generate_article_summary,
        ai::translate_content,
        ai::batch_generate_summary,
        ai::run_ai_queue,
        db::feeds::get_feeds,
        db::feeds::add_feed,
        db::feeds::edit_feed,
        db::feeds::delete_feed,
        db::get_articles,
        db::get_unread_articles,
        db::get_article,
        db::get_article_ai_summary,
        db::get_article_navigation,
        db::update_feed,
        db::update_all_feeds,
        db::mark_article_read,
        db::mark_articles_read,
        db::toggle_article_star,
        db::get_starred_articles,
        db::toggle_article_favorite,
        db::get_favorite_articles,
        db::update_article_summary,
        db::upsert_article_ai_summary,
        db::search_articles,
        db::fetch_and_add_feed,
        db::opml::import_opml,
        db::opml::export_opml,
        db::export_data,
        db::tags::add_tag,
        db::tags::remove_tag,
        db::tags::get_article_tags,
        db::tags::get_articles_by_tag,
        db::tags::get_all_tags,
        db::groups::create_group,
        db::groups::delete_group,
        db::groups::rename_group,
        db::groups::add_article_to_group,
        db::groups::remove_article_from_group,
        db::delete_article,
        db::groups::get_groups,
        db::groups::get_group_articles,
        db::cache::clean_media_cache,
        db::cache::clean_articles,
        db::cache::clean_all_articles,
        db::cache::get_storage_info,
        db::rules::get_rules,
        db::rules::create_rule,
        db::rules::update_rule,
        db::rules::delete_rule,
        db::rules::reorder_rules,
        db::rules::get_pending_ai_tasks,
        db::rules::update_ai_task_status,
        db::rules::execute_rule_actions,
        db::rules::save_article_score,
        db::rules::get_article_scores,
    ]
}
