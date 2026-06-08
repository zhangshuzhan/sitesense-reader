use crate::db::articles::{attach_scores_to_articles, row_to_article};
use crate::models::{Article, Group};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<Connection>;

#[tauri::command]
pub fn create_group(conn: State<DbState>, name: String) -> Result<Group, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute("INSERT INTO groups (name) VALUES (?1)", [&name])
        .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let group = conn
        .query_row(
            "SELECT id, name, created_at FROM groups WHERE id = ?1",
            [id],
            |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(group)
}

#[tauri::command]
pub fn delete_group(conn: State<DbState>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM groups WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_group(conn: State<DbState>, id: i64, new_name: String) -> Result<Group, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE groups SET name = ?1 WHERE id = ?2",
        rusqlite::params![new_name, id],
    )
    .map_err(|e| e.to_string())?;

    let group = conn
        .query_row(
            "SELECT id, name, created_at FROM groups WHERE id = ?1",
            [id],
            |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(group)
}

#[tauri::command]
pub fn add_article_to_group(
    conn: State<DbState>,
    article_id: i64,
    group_id: i64,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO article_groups (article_id, group_id) VALUES (?1, ?2)",
        [article_id, group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_article_from_group(
    conn: State<DbState>,
    article_id: i64,
    group_id: i64,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM article_groups WHERE article_id = ?1 AND group_id = ?2",
        [article_id, group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_groups(conn: State<DbState>) -> Result<Vec<Group>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM groups ORDER BY name")
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(groups)
}

#[tauri::command]
pub fn get_group_articles(
    conn: State<DbState>,
    group_id: i64,
    limit: Option<u64>,
    cursor: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let sql_base = "SELECT a.id, a.feed_id, a.title, a.link, a.author, a.content, a.summary,
                    a.published_at, a.updated_at, a.is_read, a.is_starred, a.is_favorite, a.created_at, a.thumbnail
             FROM articles a
             JOIN article_groups ag ON a.id = ag.article_id
             WHERE ag.group_id = ?";

    let mut where_clauses = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params.push(Box::new(group_id));

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
