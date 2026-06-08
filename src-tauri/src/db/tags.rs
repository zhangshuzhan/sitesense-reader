use crate::db::articles::{attach_scores_to_articles, row_to_article};
use crate::models::{Article, Tag};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<Connection>;

#[tauri::command]
pub fn add_tag(conn: State<DbState>, article_id: i64, tag_name: String) -> Result<Tag, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&tag_name])
        .map_err(|e| e.to_string())?;

    let tag_id: i64 = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", [&tag_name], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?1, ?2)",
        [article_id, tag_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Tag {
        id: tag_id,
        name: tag_name,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn remove_tag(conn: State<DbState>, article_id: i64, tag_id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM article_tags WHERE article_id = ?1 AND tag_id = ?2",
        [article_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_article_tags(conn: State<DbState>, article_id: i64) -> Result<Vec<Tag>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.created_at
         FROM tags t
         JOIN article_tags at ON t.id = at.tag_id
         WHERE at.article_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([article_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn get_articles_by_tag(
    conn: State<DbState>,
    tag_id: i64,
    limit: Option<u64>,
    cursor: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let sql_base = "SELECT a.id, a.feed_id, a.title, a.link, a.author, a.content, a.summary,
                    a.published_at, a.updated_at, a.is_read, a.is_starred, a.is_favorite, a.created_at, a.thumbnail
             FROM articles a
             JOIN article_tags at ON a.id = at.article_id
             WHERE at.tag_id = ?";

    let mut where_clauses = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params.push(Box::new(tag_id));

    if let Some(c) = cursor {
        if let Some((ts, id_str)) = c.split_once('|') {
            if let Ok(id) = id_str.parse::<i64>() {
                where_clauses.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
                params.push(Box::new(ts.to_string()));
                params.push(Box::new(ts.to_string()));
                params.push(Box::new(id));
            }
        }
    }

    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("AND {}", where_clauses.join(" AND "))
    };

    let sql = format!(
        "{} {} ORDER BY a.published_at DESC, a.id DESC LIMIT ?",
        sql_base, where_sql
    );
    params.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut articles = stmt
        .query_map(&*params_refs, row_to_article)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    attach_scores_to_articles(&conn, &mut articles)?;
    Ok(articles)
}

#[tauri::command]
pub fn get_all_tags(conn: State<DbState>) -> Result<Vec<Tag>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tags)
}
