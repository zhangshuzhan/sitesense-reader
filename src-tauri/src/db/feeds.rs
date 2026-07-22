use crate::models::{Feed, NewFeed};
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<Connection>;

#[tauri::command]
pub fn get_feeds(conn: State<DbState>) -> Result<Vec<Feed>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.title, f.url, f.description, f.link, f.category, f.last_updated, f.etag,
                    f.last_modified, f.error_message, f.created_at, f.updated_at, f.icon,
                    f.source_type, f.auth_token,
                    (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) as unread_count
             FROM feeds f
             ORDER BY f.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let feeds = stmt
        .query_map([], |row| {
            Ok(Feed {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                description: row.get(3)?,
                link: row.get(4)?,
                category: row.get(5)?,
                last_updated: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                error_message: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                icon: row.get(12)?,
                source_type: row.get(13).unwrap_or_else(|_| "rss".to_string()),
                auth_token: row.get(14)?,
                unread_count: Some(row.get::<_, i64>(15)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(feeds)
}

#[tauri::command]
pub fn add_feed(conn: State<DbState>, feed: NewFeed) -> Result<Feed, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO feeds (title, url, description, link, category, icon, source_type, auth_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            feed.title,
            feed.url,
            feed.description,
            feed.link,
            feed.category,
            feed.icon,
            feed.source_type,
            Option::<String>::None,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Feed {
        id,
        title: feed.title,
        url: feed.url,
        description: feed.description,
        link: feed.link,
        category: feed.category,
        last_updated: None,
        etag: None,
        last_modified: None,
        error_message: None,
        created_at: now.clone(),
        updated_at: now,
        icon: feed.icon,
        source_type: feed.source_type,
        auth_token: None,
        unread_count: Some(0),
    })
}

#[tauri::command]
pub fn edit_feed(
    conn: State<DbState>,
    id: i64,
    title: String,
    category: Option<String>,
) -> Result<Feed, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE feeds SET title = ?1, category = ?2, updated_at = ?3 WHERE id = ?4",
        params![title, category, now, id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, url, description, link, category, last_updated, etag, last_modified, error_message, created_at, updated_at, icon, source_type, auth_token FROM feeds WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let feed = stmt
        .query_row([id], |row| {
            Ok(Feed {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                description: row.get(3)?,
                link: row.get(4)?,
                category: row.get(5)?,
                last_updated: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                error_message: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                icon: row.get(12)?,
                source_type: row.get(13).unwrap_or_else(|_| "rss".to_string()),
                auth_token: row.get(14)?,
                unread_count: None,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(feed)
}

#[tauri::command]
pub fn delete_feed(conn: State<DbState>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM feeds WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
