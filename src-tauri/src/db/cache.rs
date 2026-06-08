use crate::models::StorageInfo;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

type DbState = Mutex<Connection>;

#[tauri::command]
pub fn clean_articles(
    conn: State<DbState>,
    days: u32,
    except_starred: bool,
) -> Result<usize, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    clean_articles_inner(&conn, days, except_starred)
}

fn clean_articles_inner(
    conn: &Connection,
    days: u32,
    except_starred: bool,
) -> Result<usize, String> {
    let cutoff_date = chrono::Utc::now() - chrono::Duration::days(days as i64);
    let cutoff_str = cutoff_date.to_rfc3339();

    let sql = if except_starred {
        "DELETE FROM articles WHERE COALESCE(published_at, created_at) < ?1 AND is_starred = 0 AND is_favorite = 0"
    } else {
        "DELETE FROM articles WHERE COALESCE(published_at, created_at) < ?1 AND is_favorite = 0"
    };

    let count = conn.execute(sql, [cutoff_str]).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn clean_all_articles(conn: State<DbState>, except_starred: bool) -> Result<usize, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let sql = if except_starred {
        "DELETE FROM articles WHERE is_starred = 0 AND is_favorite = 0"
    } else {
        "DELETE FROM articles WHERE is_favorite = 0"
    };

    let count = conn.execute(sql, []).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle, conn: State<DbState>) -> Result<StorageInfo, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let db_size = conn
        .query_row("PRAGMA database_list", [], |row| {
            let path: String = row.get(2)?;
            Ok(path)
        })
        .ok()
        .and_then(|p| std::fs::metadata(&p).ok())
        .map(|m| m.len())
        .unwrap_or(0);

    let article_count: u64 = conn
        .query_row("SELECT COUNT(*) FROM articles", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let media_cache_size = get_dir_size(&cache_dir).unwrap_or(0);

    Ok(StorageInfo {
        db_size,
        article_count,
        media_cache_size,
    })
}

fn get_dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut size = 0;
    if path.exists() {
        if path.is_dir() {
            for entry in std::fs::read_dir(path)? {
                let entry = entry?;
                let metadata = entry.metadata()?;
                if metadata.is_dir() {
                    size += get_dir_size(&entry.path())?;
                } else {
                    size += metadata.len();
                }
            }
        } else {
            size = std::fs::metadata(path)?.len();
        }
    }
    Ok(size)
}

#[tauri::command]
pub fn clean_media_cache(
    app: AppHandle,
    days: u32,
    max_size_mb: Option<u64>,
) -> Result<usize, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("media_cache");
    let mut deleted_count = 0;

    if !cache_dir.exists() {
        return Ok(0);
    }

    let entries = std::fs::read_dir(&cache_dir).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now();
    let max_age = std::time::Duration::from_secs((days as u64) * 24 * 60 * 60);
    let mut remaining_files: Vec<(std::path::PathBuf, u64, u64)> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let modified = metadata.modified().unwrap_or(now);
        let modified_ts = modified
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let should_delete_by_age = if days == 0 {
            true
        } else {
            now.duration_since(modified)
                .map(|age| age > max_age)
                .unwrap_or(false)
        };

        if should_delete_by_age {
            if std::fs::remove_file(&path).is_ok() {
                deleted_count += 1;
            }
            continue;
        }

        remaining_files.push((path, metadata.len(), modified_ts));
    }

    if let Some(max_size_mb) = max_size_mb.filter(|value| *value > 0) {
        let max_size_bytes = max_size_mb.saturating_mul(1024 * 1024);
        let mut total_size: u64 = remaining_files.iter().map(|(_, size, _)| *size).sum();

        if total_size > max_size_bytes {
            remaining_files.sort_by_key(|(_, _, modified_ts)| *modified_ts);

            for (path, size, _) in remaining_files {
                if total_size <= max_size_bytes {
                    break;
                }

                if std::fs::remove_file(&path).is_ok() {
                    deleted_count += 1;
                    total_size = total_size.saturating_sub(size);
                }
            }
        }
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_articles() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                published_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                is_starred INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0
            )",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn clean_articles_falls_back_to_created_at_when_published_at_is_missing() {
        let conn = setup_articles();
        conn.execute(
            "INSERT INTO articles (title, published_at, created_at)
             VALUES ('Old undated article', NULL, '2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        let deleted = clean_articles_inner(&conn, 30, true).unwrap();

        assert_eq!(deleted, 1);
    }
}
