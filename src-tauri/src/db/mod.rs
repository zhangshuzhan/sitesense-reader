pub mod articles;
pub mod cache;
pub mod feeds;
pub mod groups;
pub mod opml;
pub mod rules;
pub mod rules_engine;
pub mod tags;

use crate::models::{Article, EastmoneyReport, Feed, NewArticle};
use articles::{query_articles, row_to_article, ArticleFilter};
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tokio::task::JoinSet;

pub type DbState = Mutex<Connection>;
const FEED_REFRESH_CONCURRENCY: usize = 4;
const LEGACY_APP_IDENTIFIER: &str = "com.rss-reader.app";

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NavigationScope {
    All,
    Unread,
    Starred,
    Favorite,
    Feed,
    Tag,
    Group,
    Search,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleNavigationContext {
    pub scope: NavigationScope,
    pub feed_id: Option<i64>,
    pub tag_id: Option<i64>,
    pub group_id: Option<i64>,
    pub query: Option<String>,
}

impl Default for ArticleNavigationContext {
    fn default() -> Self {
        Self {
            scope: NavigationScope::All,
            feed_id: None,
            tag_id: None,
            group_id: None,
            query: None,
        }
    }
}

// Re-export all the command functions to maintain backward compatibility
pub use cache::{clean_all_articles, clean_articles, clean_media_cache, get_storage_info};
pub use feeds::{add_feed, delete_feed, edit_feed, get_feeds};
pub use groups::{
    add_article_to_group, create_group, delete_group, get_group_articles, get_groups,
    remove_article_from_group, rename_group,
};
pub use opml::{export_opml, import_opml};
pub use tags::{add_tag, get_all_tags, get_article_tags, get_articles_by_tag, remove_tag};

pub fn get_legacy_db_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(mut path) = std::env::current_dir() {
        path.push(".rss-reader-data");
        path.push("rss.db");
        paths.push(path);
    }

    if let Some(mut path) = dirs::data_dir() {
        path.push(LEGACY_APP_IDENTIFIER);
        path.push("rss.db");
        if !paths.contains(&path) {
            paths.push(path);
        }
    }

    paths
}

pub fn get_legacy_db_path() -> Option<PathBuf> {
    get_legacy_db_paths().into_iter().next()
}

pub fn init_database_at_path(db_path: &std::path::Path) -> SqliteResult<Connection> {
    let conn = Connection::open(db_path)?;

    // Enable foreign key constraints
    conn.execute("PRAGMA foreign_keys = ON", []).map_err(|e| {
        eprintln!("Warning: Failed to enable foreign keys: {}", e);
        e
    })?;

    // Performance PRAGMAs (use execute_batch — journal_mode returns a result row)
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -32000;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 134217728;",
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            url TEXT NOT NULL UNIQUE,
            link TEXT,
            category TEXT,
            last_updated TEXT,
            etag TEXT,
            last_modified TEXT,
            error_message TEXT,
            icon TEXT,
            source_type TEXT DEFAULT 'rss',
            auth_token TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    let _ = conn.execute("ALTER TABLE feeds ADD COLUMN icon TEXT", []);
    let _ = conn.execute("ALTER TABLE feeds ADD COLUMN source_type TEXT DEFAULT 'rss'", []);
    let _ = conn.execute("ALTER TABLE feeds ADD COLUMN auth_token TEXT", []);
    let _ = conn.execute("ALTER TABLE articles ADD COLUMN thumbnail TEXT", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feed_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            link TEXT NOT NULL,
            summary TEXT,
            content TEXT,
            author TEXT,
            published_at TEXT,
            updated_at TEXT,
            is_read INTEGER DEFAULT 0,
            is_starred INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read)",
        [],
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_link ON articles(link)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_tags (
            article_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (article_id, tag_id),
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_groups (
            article_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (article_id, group_id),
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Enable FTS5
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
            title,
            content,
            summary,
            author,
            content='articles',
            content_rowid='id'
        )",
        [],
    )?;

    // Triggers to keep FTS index up to date
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
            INSERT INTO articles_fts(rowid, title, content, summary, author)
            VALUES (new.id, new.title, new.content, new.summary, new.author);
        END",
        [],
    )?;
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, content, summary, author)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.author);
        END",
        [],
    )?;
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, title, content, summary, author)
            VALUES('delete', old.id, old.title, old.content, old.summary, old.author);
            INSERT INTO articles_fts(rowid, title, content, summary, author)
            VALUES (new.id, new.title, new.content, new.summary, new.author);
        END",
        [],
    )?;

    // Run integrity check
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap_or_else(|_| "error".to_string());

    if integrity != "ok" {
        eprintln!("Warning: Database integrity check failed: {}", integrity);
    }

    // Clean up orphaned articles (articles without a valid feed)
    let orphaned_count = conn
        .execute(
            "DELETE FROM articles WHERE feed_id NOT IN (SELECT id FROM feeds)",
            [],
        )
        .unwrap_or(0);

    if orphaned_count > 0 {
        eprintln!("Cleaned up {} orphaned articles", orphaned_count);
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            conditions TEXT NOT NULL,
            actions TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_tasks (
            id TEXT PRIMARY KEY,
            article_id INTEGER NOT NULL,
            rule_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            task_type TEXT DEFAULT 'condition',
            action_config TEXT,
            error_msg TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
            FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Migration: Add new columns to ai_tasks if they don't exist
    let _ = conn.execute(
        "ALTER TABLE ai_tasks ADD COLUMN task_type TEXT DEFAULT 'condition'",
        [],
    );
    let _ = conn.execute("ALTER TABLE ai_tasks ADD COLUMN action_config TEXT", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            rule_id TEXT NOT NULL,
            score INTEGER NOT NULL,
            badge_name TEXT,
            badge_color TEXT,
            badge_icon TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
            FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE,
            UNIQUE(article_id, rule_id)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_rule_executions (
            article_id INTEGER NOT NULL,
            rule_id TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (article_id, rule_id),
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
            FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_ai_summaries (
            article_id INTEGER PRIMARY KEY,
            summary TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // SiteSense financial interpretation cache (works with or without a cloud LLM key).
    conn.execute(
        "CREATE TABLE IF NOT EXISTS article_financial_insights (
            article_id INTEGER PRIMARY KEY,
            summary TEXT NOT NULL,
            sentiment TEXT NOT NULL,
            sentiment_score INTEGER NOT NULL DEFAULT 0,
            keywords TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'local',
            model TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // SiteSense: Eastmoney research reports — deduped by info_code.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS eastmoney_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            org_name TEXT NOT NULL DEFAULT '',
            org_sname TEXT NOT NULL DEFAULT '',
            stock_name TEXT,
            stock_code TEXT,
            industry_name TEXT,
            publish_date TEXT NOT NULL,
            info_code TEXT NOT NULL UNIQUE,
            summary TEXT,
            pdf_path TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Migration: add pdf_path column to existing eastmoney_reports tables.
    let _ = conn.execute("ALTER TABLE eastmoney_reports ADD COLUMN pdf_path TEXT", []);

    // SiteSense: A‑share stock alias lookup table.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_aliases (
            stock_code TEXT NOT NULL,
            alias      TEXT NOT NULL,
            alias_type TEXT NOT NULL DEFAULT 'short',
            PRIMARY KEY (alias)
        )",
        [],
    )?;
    let _ = seed_stock_aliases(&conn);

    // SiteSense: local market data (last 5 trading days)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stock_daily (
            code        TEXT NOT NULL,
            name        TEXT NOT NULL DEFAULT '',
            trade_date  TEXT NOT NULL,
            open        REAL DEFAULT 0,
            close       REAL DEFAULT 0,
            high        REAL DEFAULT 0,
            low         REAL DEFAULT 0,
            volume      INTEGER DEFAULT 0,
            amount      REAL DEFAULT 0,
            change_pct  REAL DEFAULT 0,
            PRIMARY KEY (code, trade_date)
        )",
        [],
    )?;

    // On startup, reset any tasks that were interrupted mid-processing
    let _ = conn.execute(
        "UPDATE ai_tasks SET status = 'pending', error_msg = NULL WHERE status = 'processing'",
        [],
    );

    Ok(conn)
}

#[tauri::command]
pub fn delete_feed_articles(conn: State<DbState>, feed_id: i64) -> Result<i64, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    // Also clean up associated tags and summaries
    let _ = conn.execute("DELETE FROM article_tags WHERE article_id IN (SELECT id FROM articles WHERE feed_id = ?1)", [feed_id]);
    let _ = conn.execute("DELETE FROM article_ai_summaries WHERE article_id IN (SELECT id FROM articles WHERE feed_id = ?1)", [feed_id]);
    let _ = conn.execute("DELETE FROM article_financial_insights WHERE article_id IN (SELECT id FROM articles WHERE feed_id = ?1)", [feed_id]);
    let count = conn.execute("DELETE FROM articles WHERE feed_id = ?1", [feed_id])
        .map_err(|e| e.to_string())?;
    Ok(count as i64)
}

#[tauri::command]
pub fn delete_article(conn: State<DbState>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM articles WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_articles(
    conn: State<DbState>,
    feed_id: Option<i64>,
    limit: Option<u64>,
    cursor: Option<String>,
    sort_by: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    query_articles(
        &conn,
        ArticleFilter::All,
        feed_id,
        sort_by.as_deref(),
        cursor.as_deref(),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn get_unread_articles(
    conn: State<DbState>,
    limit: Option<u64>,
    cursor: Option<String>,
    sort_by: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    query_articles(
        &conn,
        ArticleFilter::Unread,
        None,
        sort_by.as_deref(),
        cursor.as_deref(),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn get_starred_articles(
    conn: State<DbState>,
    limit: Option<u64>,
    cursor: Option<String>,
    sort_by: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    query_articles(
        &conn,
        ArticleFilter::Starred,
        None,
        sort_by.as_deref(),
        cursor.as_deref(),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn get_favorite_articles(
    conn: State<DbState>,
    limit: Option<u64>,
    cursor: Option<String>,
    sort_by: Option<String>,
) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    query_articles(
        &conn,
        ArticleFilter::Favorite,
        None,
        sort_by.as_deref(),
        cursor.as_deref(),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn search_articles(conn: State<DbState>, query: String) -> Result<Vec<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    search_articles_inner(&conn, query).map_err(|e| e.to_string())
}

fn search_articles_inner(conn: &Connection, query: String) -> SqliteResult<Vec<Article>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.feed_id, a.title, a.link, a.author, a.content, a.summary, a.published_at,
                 a.updated_at, a.is_read, a.is_starred, a.is_favorite, a.created_at, a.thumbnail
          FROM articles a
          JOIN articles_fts fts ON a.id = fts.rowid
          WHERE articles_fts MATCH ?1
          ORDER BY rank
          LIMIT 100",
    )?;

    let articles = stmt
        .query_map([&query], row_to_article)?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(articles)
}

#[tauri::command]
pub fn export_data(conn: State<DbState>, format: String) -> Result<String, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    export_data_impl(&conn, &format).map_err(|e| e.to_string())
}

fn export_data_impl(conn: &Connection, format: &str) -> Result<String, Box<dyn std::error::Error>> {
    if format == "json" {
        let mut stmt = conn.prepare(
            "SELECT id, feed_id, title, link, author, content, summary, published_at,
                    updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
             FROM articles",
        )?;

        let articles = stmt
            .query_map([], row_to_article)?
            .collect::<Result<Vec<_>, rusqlite::Error>>()?;

        let json = serde_json::to_string_pretty(&articles)?;
        Ok(json)
    } else {
        Err(format!("Unsupported format: {}", format).into())
    }
}

#[tauri::command]
pub fn mark_article_read(conn: State<DbState>, id: i64, is_read: bool) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE articles SET is_read = ?1 WHERE id = ?2",
        rusqlite::params![is_read as i32, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn mark_articles_read_inner(
    conn: &mut Connection,
    ids: &[i64],
    is_read: bool,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE articles SET is_read = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;

        for id in ids {
            stmt.execute(params![is_read as i32, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn mark_articles_read(
    conn: State<DbState>,
    ids: Vec<i64>,
    is_read: bool,
) -> Result<(), String> {
    let mut conn = conn.lock().map_err(|e| e.to_string())?;
    mark_articles_read_inner(&mut conn, &ids, is_read)
}

#[tauri::command]
pub fn toggle_article_star(conn: State<DbState>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE articles SET is_starred = NOT is_starred WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn toggle_article_favorite(conn: State<DbState>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE articles SET is_favorite = NOT is_favorite WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_article_summary(
    conn: State<DbState>,
    id: i64,
    summary: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE articles SET summary = ?1 WHERE id = ?2",
        params![summary, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_article_inner(conn: &Connection, id: i64) -> Result<Option<Article>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, feed_id, title, link, author, content, summary, published_at,
                    updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
             FROM articles
             WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let article = stmt
        .query_row([id], row_to_article)
        .map(Some)
        .or_else(|e| {
            if e.to_string().contains("no row found") {
                Ok(None)
            } else {
                Err(e.to_string())
            }
        })?;

    let Some(article) = article else {
        return Ok(None);
    };

    let mut articles = vec![article];
    articles::attach_scores_to_articles(conn, &mut articles)?;

    Ok(articles.pop())
}

#[tauri::command]
pub fn get_article(conn: State<DbState>, id: i64) -> Result<Option<Article>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    get_article_inner(&conn, id)
}

fn get_article_ai_summary_inner(
    conn: &Connection,
    article_id: i64,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT summary FROM article_ai_summaries WHERE article_id = ?1",
        [article_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_article_ai_summary(
    conn: State<DbState>,
    article_id: i64,
) -> Result<Option<String>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    get_article_ai_summary_inner(&conn, article_id)
}

fn upsert_article_ai_summary_inner(
    conn: &Connection,
    article_id: i64,
    summary: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO article_ai_summaries (article_id, summary, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(article_id) DO UPDATE SET summary = excluded.summary, created_at = excluded.created_at",
        params![article_id, summary, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_article_ai_summary(
    conn: State<DbState>,
    article_id: i64,
    summary: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    upsert_article_ai_summary_inner(&conn, article_id, summary)
}

#[tauri::command]
pub fn get_article_navigation(
    conn: State<DbState>,
    current_id: i64,
    context: Option<ArticleNavigationContext>,
) -> Result<(Option<Article>, Option<Article>), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    get_article_navigation_inner(&conn, current_id, context.unwrap_or_default())
}

fn get_article_navigation_inner(
    conn: &Connection,
    current_id: i64,
    mut context: ArticleNavigationContext,
) -> Result<(Option<Article>, Option<Article>), String> {
    let current_article = conn
        .query_row(
            "SELECT feed_id, published_at FROM articles WHERE id = ?1",
            [current_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let (current_feed_id, published_at) = current_article;

    if context.scope == NavigationScope::Feed && context.feed_id.is_none() {
        context.feed_id = Some(current_feed_id);
    }

    if context.scope == NavigationScope::Search {
        let query = context.query.as_deref().unwrap_or_default().trim();
        if query.is_empty() {
            return Ok((None, None));
        }
        return get_search_navigation_inner(conn, current_id, query);
    }

    let Some(published_at) = published_at else {
        return Ok((None, None));
    };

    let prev_article = query_navigation_neighbor(conn, current_id, &published_at, &context, true)?;
    let next_article = query_navigation_neighbor(conn, current_id, &published_at, &context, false)?;

    Ok((prev_article, next_article))
}

fn get_search_navigation_inner(
    conn: &Connection,
    current_id: i64,
    query: &str,
) -> Result<(Option<Article>, Option<Article>), String> {
    let articles = search_articles_inner(conn, query.to_string()).map_err(|e| e.to_string())?;
    let Some(current_index) = articles.iter().position(|article| article.id == current_id) else {
        return Ok((None, None));
    };

    let prev_article = articles.get(current_index + 1).cloned();
    let next_article = current_index
        .checked_sub(1)
        .and_then(|index| articles.get(index).cloned());

    Ok((prev_article, next_article))
}

fn query_navigation_neighbor(
    conn: &Connection,
    current_id: i64,
    published_at: &str,
    context: &ArticleNavigationContext,
    previous: bool,
) -> Result<Option<Article>, String> {
    let mut sql = String::from(
        "SELECT a.id, a.feed_id, a.title, a.link, a.author, a.content, a.summary, a.published_at,
                a.updated_at, a.is_read, a.is_starred, a.is_favorite, a.created_at, a.thumbnail
         FROM articles a",
    );
    let mut where_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    match context.scope {
        NavigationScope::All => {}
        NavigationScope::Unread => where_clauses.push("a.is_read = 0".to_string()),
        NavigationScope::Starred => where_clauses.push("a.is_starred = 1".to_string()),
        NavigationScope::Favorite => where_clauses.push("a.is_favorite = 1".to_string()),
        NavigationScope::Feed => {
            let feed_id = context
                .feed_id
                .ok_or_else(|| "feed scope requires feedId".to_string())?;
            where_clauses.push("a.feed_id = ?".to_string());
            params.push(Box::new(feed_id));
        }
        NavigationScope::Tag => {
            let tag_id = context
                .tag_id
                .ok_or_else(|| "tag scope requires tagId".to_string())?;
            sql.push_str(" JOIN article_tags at ON a.id = at.article_id");
            where_clauses.push("at.tag_id = ?".to_string());
            params.push(Box::new(tag_id));
        }
        NavigationScope::Group => {
            let group_id = context
                .group_id
                .ok_or_else(|| "group scope requires groupId".to_string())?;
            sql.push_str(" JOIN article_groups ag ON a.id = ag.article_id");
            where_clauses.push("ag.group_id = ?".to_string());
            params.push(Box::new(group_id));
        }
        NavigationScope::Search => unreachable!("search handled separately"),
    }

    if previous {
        where_clauses.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))".to_string());
    } else {
        where_clauses.push("(a.published_at > ? OR (a.published_at = ? AND a.id > ?))".to_string());
    }
    params.push(Box::new(published_at.to_string()));
    params.push(Box::new(published_at.to_string()));
    params.push(Box::new(current_id));

    let order_sql = if previous {
        "ORDER BY a.published_at DESC, a.id DESC"
    } else {
        "ORDER BY a.published_at ASC, a.id ASC"
    };

    let sql = format!(
        "{} WHERE {} {} LIMIT 1",
        sql,
        where_clauses.join(" AND "),
        order_sql
    );
    let params_refs: Vec<&dyn rusqlite::ToSql> =
        params.iter().map(|param| param.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    stmt.query_row(&*params_refs, row_to_article)
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            _ => Err(error.to_string()),
        })
}

#[derive(Debug, Clone)]
struct FeedRefreshJob {
    id: i64,
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
    source_type: String,
    auth_token: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FeedUpdateOutcome {
    pub new_articles: Vec<Article>,
    pub updated_article_ids: Vec<i64>,
    pub feed_changed: bool,
}

impl FeedUpdateOutcome {
    pub fn has_ui_changes(&self) -> bool {
        !self.new_articles.is_empty() || !self.updated_article_ids.is_empty() || self.feed_changed
    }

    fn merge(&mut self, other: FeedUpdateOutcome) {
        self.new_articles.extend(other.new_articles);
        self.updated_article_ids.extend(other.updated_article_ids);
        self.feed_changed |= other.feed_changed;
    }
}

fn apply_feed_update_result(
    conn: &Connection,
    feed_id: i64,
    fetch_result: crate::feed::FeedFetchResult,
) -> Result<FeedUpdateOutcome, String> {
    let now = chrono::Utc::now().to_rfc3339();

    if fetch_result.not_modified {
        let had_error = conn
            .query_row(
                "SELECT error_message FROM feeds WHERE id = ?1",
                [feed_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten()
            .is_some();

        conn.execute(
            "UPDATE feeds
             SET last_updated = ?1, updated_at = ?2, etag = ?3, last_modified = ?4, error_message = NULL
             WHERE id = ?5",
            params![
                now,
                now,
                fetch_result.etag,
                fetch_result.last_modified,
                feed_id
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(FeedUpdateOutcome {
            feed_changed: had_error,
            ..Default::default()
        });
    }

    let new_feed = fetch_result
        .feed
        .ok_or_else(|| "Missing feed payload for successful refresh".to_string())?;

    let previous_feed = conn
        .query_row(
            "SELECT title, description, link, category, icon, error_message FROM feeds WHERE id = ?1",
            [feed_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let feed_changed = previous_feed
        .map(
            |(title, description, link, category, icon, error_message)| {
                title != new_feed.title
                    || description != new_feed.description
                    || link != new_feed.link
                    || category != new_feed.category
                    || icon != new_feed.icon
                    || error_message.is_some()
            },
        )
        .unwrap_or(true);

    conn.execute(
        "UPDATE feeds
         SET title = ?1, description = ?2, link = ?3, category = ?4, icon = ?5,
             last_updated = ?6, updated_at = ?7, etag = ?8, last_modified = ?9, error_message = NULL
         WHERE id = ?10",
        params![
            new_feed.title,
            new_feed.description,
            new_feed.link,
            new_feed.category,
            new_feed.icon,
            now,
            now,
            fetch_result.etag,
            fetch_result.last_modified,
            feed_id
        ],
    )
    .map_err(|e| e.to_string())?;

    let mut outcome = FeedUpdateOutcome {
        feed_changed,
        ..Default::default()
    };

    for item in fetch_result.articles {
        let created_at = chrono::Utc::now().to_rfc3339();
        match upsert_article_from_feed_item(conn, feed_id, &item, &created_at) {
            Ok((article, is_new, is_updated)) => {
                let context = rules_engine::RuleTriggerContext {
                    is_existing_article: !is_new,
                    is_new_article: is_new,
                    allow_include_fetched: false,
                };

                if let Err(error) =
                    rules_engine::process_article_rules_with_context(conn, &article, context)
                {
                    eprintln!(
                        "Warning: Failed to process rules for article {}: {}",
                        article.id, error
                    );
                }

                tag_article_with_stocks(conn, article.id, &item.title, &item.content);

                if is_new {
                    outcome.new_articles.push(article);
                } else if is_updated {
                    outcome.updated_article_ids.push(article.id);
                }
            }
            Err(error) => {
                eprintln!(
                    "Warning: Failed to upsert article {} in feed {}: {}",
                    item.link, feed_id, error
                );
            }
        }
    }

    Ok(outcome)
}

#[tauri::command]
pub async fn fetch_and_add_feed(
    conn: State<'_, DbState>,
    url: String,
    category: Option<String>,
    rsshub_domain: Option<String>,
) -> Result<(Feed, Vec<Article>), String> {
    let fetcher = crate::feed::FeedFetcher::new()?;
    let fetch_result = fetcher
        .fetch_feed(
            &url,
            crate::feed::FeedRequestOptions {
                rsshub_domain,
                ..Default::default()
            },
        )
        .await?;
    let new_feed = fetch_result
        .feed
        .ok_or_else(|| "Missing feed payload for successful fetch".to_string())?;

    let conn = conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    // Use provided category or fallback to feed's category
    let final_category = category.or(new_feed.category);

    conn.execute(
        "INSERT INTO feeds (title, url, description, link, category, icon, source_type, auth_token, etag, last_modified, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            &new_feed.title,
            &new_feed.url,
            &new_feed.description,
            &new_feed.link,
            &final_category,
            &new_feed.icon,
            &new_feed.source_type,
            &Option::<String>::None,
            &fetch_result.etag,
            &fetch_result.last_modified,
            &now,
            &now
        ],
    )
    .map_err(|e| e.to_string())?;

    let feed_id = conn.last_insert_rowid();

    let mut articles = Vec::new();

    for item in fetch_result.articles {
        let created_at = chrono::Utc::now().to_rfc3339();
        let (article, is_new, _is_updated) =
            upsert_article_from_feed_item(&conn, feed_id, &item, &created_at)?;

        let context = rules_engine::RuleTriggerContext {
            is_existing_article: !is_new,
            is_new_article: is_new,
            allow_include_fetched: false,
        };

        if let Err(e) = rules_engine::process_article_rules_with_context(&conn, &article, context) {
            eprintln!(
                "Warning: Failed to process rules for article {}: {}",
                article.id, e
            );
        }

        if is_new {
            articles.push(article);
        }
    }

    let feed = Feed {
        id: feed_id,
        title: new_feed.title,
        description: new_feed.description,
        url: new_feed.url,
        link: new_feed.link,
        category: final_category,
        icon: new_feed.icon,
        last_updated: Some(now.clone()),
        etag: fetch_result.etag,
        last_modified: fetch_result.last_modified,
        error_message: None,
        created_at: now.clone(),
        updated_at: now,
        source_type: new_feed.source_type,
        auth_token: None,
        unread_count: Some(articles.len() as i64),
    };

    Ok((feed, articles))
}

/// SiteSense dual-mode: add a WordPress site as a feed. Tries public core REST first,
/// then plugin mode (requires an account token). The chosen `mode`/`auth` are stored on
/// the returned feed so the refresh path knows how to fetch again.
#[tauri::command]
pub async fn fetch_and_add_wordpress(
    conn: State<'_, DbState>,
    base: String,
    category: Option<String>,
    token: Option<String>,
) -> Result<(Feed, Vec<Article>), String> {
    let fetcher = crate::wordpress::WordPressFetcher::new()?;
    let result = fetcher
        .fetch(
            &base,
            crate::wordpress::WordPressFetchOptions {
                token: token.clone(),
                per_page: None,
            },
        )
        .await?;

    if !result.reachable {
        return Err(result
            .error_message
            .unwrap_or_else(|| "无法连接该 WordPress 站点".to_string()));
    }

    let new_feed = result
        .feed
        .ok_or_else(|| "Missing feed payload for successful fetch".to_string())?;

    let conn = conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let final_category = category.or(new_feed.category);

    conn.execute(
        "INSERT INTO feeds (title, url, description, link, category, icon, source_type, auth_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            &new_feed.title,
            &new_feed.url,
            &new_feed.description,
            &new_feed.link,
            &final_category,
            &new_feed.icon,
            "wordpress",
            &token,
            &now,
            &now
        ],
    )
    .map_err(|e| e.to_string())?;

    let feed_id = conn.last_insert_rowid();

    let mut articles = Vec::new();
    for item in result.articles {
        let created_at = chrono::Utc::now().to_rfc3339();
        let (article, is_new, _is_updated) =
            upsert_article_from_feed_item(&conn, feed_id, &item, &created_at)?;
        attach_categories_as_tags(&conn, article.id, &item.categories);
        tag_article_with_stocks(
            &conn,
            article.id,
            &item.title,
            &item.content,
        );

        let context = rules_engine::RuleTriggerContext {
            is_existing_article: !is_new,
            is_new_article: is_new,
            allow_include_fetched: false,
        };

        if let Err(e) = rules_engine::process_article_rules_with_context(&conn, &article, context) {
            eprintln!(
                "Warning: Failed to process rules for article {}: {}",
                article.id, e
            );
        }

        if is_new {
            articles.push(article);
        }
    }

    let feed = Feed {
        id: feed_id,
        title: new_feed.title,
        description: new_feed.description,
        url: new_feed.url,
        link: new_feed.link,
        category: final_category,
        icon: new_feed.icon,
        last_updated: Some(now.clone()),
        etag: None,
        last_modified: None,
        error_message: None,
        created_at: now.clone(),
        updated_at: now,
        source_type: "wordpress".to_string(),
        auth_token: token,
        unread_count: Some(articles.len() as i64),
    };

    Ok((feed, articles))
}

#[tauri::command]
pub async fn update_feed(
    conn: State<'_, DbState>,
    feed_id: i64,
    rsshub_domain: Option<String>,
) -> Result<Vec<Article>, String> {
    let outcome = update_feed_with_outcome(conn, feed_id, rsshub_domain).await?;
    Ok(outcome.new_articles)
}

pub async fn update_feed_with_outcome(
    conn: State<'_, DbState>,
    feed_id: i64,
    rsshub_domain: Option<String>,
) -> Result<FeedUpdateOutcome, String> {
    let fetcher = crate::feed::FeedFetcher::new()?;

    let job: FeedRefreshJob = {
        let conn_clone = conn.lock().map_err(|e| e.to_string())?;
        conn_clone
            .query_row(
                "SELECT id, url, etag, last_modified, source_type, auth_token FROM feeds WHERE id = ?1",
                [feed_id],
                |row| {
                    Ok(FeedRefreshJob {
                        id: row.get(0)?,
                        url: row.get(1)?,
                        etag: row.get(2)?,
                        last_modified: row.get(3)?,
                        source_type: row.get(4).unwrap_or_else(|_| "rss".to_string()),
                        auth_token: row.get(5)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?
    };

    if job.source_type == "wordpress" {
        let wp_fetcher = crate::wordpress::WordPressFetcher::new()?;
        let wp_result = wp_fetcher
            .fetch(
                &job.url,
                crate::wordpress::WordPressFetchOptions {
                    token: job.auth_token.clone(),
                    per_page: None,
                },
            )
            .await?;
        let conn = conn.lock().map_err(|e| e.to_string())?;
        if !wp_result.reachable {
            conn.execute(
                "UPDATE feeds SET error_message = ?1 WHERE id = ?2",
                params![wp_result.error_message.unwrap_or_default(), feed_id],
            )
            .ok();
            return Ok(FeedUpdateOutcome::default());
        }
        return apply_wordpress_update_result(&conn, feed_id, wp_result);
    }

    let fetch_result = fetcher
        .fetch_feed(
            &job.url,
            crate::feed::FeedRequestOptions {
                rsshub_domain,
                etag: job.etag,
                last_modified: job.last_modified,
            },
        )
        .await?;

    let conn = conn.lock().map_err(|e| e.to_string())?;
    apply_feed_update_result(&conn, feed_id, fetch_result)
}

#[tauri::command]
pub async fn update_all_feeds(
    conn: State<'_, DbState>,
    rsshub_domain: Option<String>,
) -> Result<Vec<Article>, String> {
    let outcome = update_all_feeds_with_outcome(conn, rsshub_domain).await?;
    Ok(outcome.new_articles)
}

pub async fn update_all_feeds_with_outcome(
    conn: State<'_, DbState>,
    rsshub_domain: Option<String>,
) -> Result<FeedUpdateOutcome, String> {
    let jobs: Vec<FeedRefreshJob> = {
        let conn_clone = conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn_clone
            .prepare("SELECT id, url, etag, last_modified, source_type, auth_token FROM feeds")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FeedRefreshJob {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    etag: row.get(2)?,
                    last_modified: row.get(3)?,
                    source_type: row.get(4).unwrap_or_else(|_| "rss".to_string()),
                    auth_token: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let fetcher = crate::feed::FeedFetcher::new()?;
    let wp_fetcher = crate::wordpress::WordPressFetcher::new()?;
    let mut outcome = FeedUpdateOutcome::default();

    for chunk in jobs.chunks(FEED_REFRESH_CONCURRENCY) {
        let mut join_set = JoinSet::new();

        for job in chunk.iter().cloned() {
            let fetcher = fetcher.clone();
            let wp_fetcher = wp_fetcher.clone();
            let rsshub_domain = rsshub_domain.clone();
            join_set.spawn(async move {
                if job.source_type == "wordpress" {
                    let result = wp_fetcher
                        .fetch(
                            &job.url,
                            crate::wordpress::WordPressFetchOptions {
                                token: job.auth_token.clone(),
                                per_page: None,
                            },
                        )
                        .await;
                    return (job.id, WordPressJobResult::Wordpress(result));
                }

                let result = fetcher
                    .fetch_feed(
                        &job.url,
                        crate::feed::FeedRequestOptions {
                            rsshub_domain,
                            etag: job.etag.clone(),
                            last_modified: job.last_modified.clone(),
                        },
                    )
                    .await;
                (job.id, WordPressJobResult::Rss(result))
            });
        }

        while let Some(result) = join_set.join_next().await {
            let (feed_id, job_result) = result.map_err(|e| e.to_string())?;
            match job_result {
                WordPressJobResult::Rss(fetch_result) => match fetch_result {
                    Ok(fetch_result) => {
                        let conn_lock = conn.lock().map_err(|e| e.to_string())?;
                        let feed_outcome =
                            apply_feed_update_result(&conn_lock, feed_id, fetch_result)?;
                        outcome.merge(feed_outcome);
                    }
                    Err(error) => {
                        let conn_lock = conn.lock().map_err(|e| e.to_string())?;
                        conn_lock
                            .execute(
                                "UPDATE feeds SET error_message = ?1 WHERE id = ?2",
                                params![error, feed_id],
                            )
                            .ok();
                    }
                },
                WordPressJobResult::Wordpress(wp_result) => {
                    match wp_result {
                        Ok(wp_result) => {
                            if !wp_result.reachable {
                                let conn_lock = conn.lock().map_err(|e| e.to_string())?;
                                conn_lock
                                    .execute(
                                        "UPDATE feeds SET error_message = ?1 WHERE id = ?2",
                                        params![wp_result.error_message.unwrap_or_default(), feed_id],
                                    )
                                    .ok();
                                continue;
                            }
                            let conn_lock = conn.lock().map_err(|e| e.to_string())?;
                            let feed_outcome =
                                apply_wordpress_update_result(&conn_lock, feed_id, wp_result)?;
                            outcome.merge(feed_outcome);
                        }
                        Err(error) => {
                            let conn_lock = conn.lock().map_err(|e| e.to_string())?;
                            conn_lock
                                .execute(
                                    "UPDATE feeds SET error_message = ?1 WHERE id = ?2",
                                    params![error, feed_id],
                                )
                                .ok();
                        }
                    }
                }
            }
        }
    }

    Ok(outcome)
}

/// Tagged result so the bulk refresh can carry either an RSS or a WordPress fetch outcome
/// through the same join-set.
enum WordPressJobResult {
    Rss(Result<crate::feed::FeedFetchResult, String>),
    Wordpress(Result<crate::wordpress::WordPressFetchResult, String>),
}

/// Upsert articles fetched from a WordPress source and refresh the feed's timestamp.
/// Populate the stock_aliases table with initial A‑share data.
/// Idempotent — only inserts aliases that don't exist yet.
fn seed_stock_aliases(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM stock_aliases", [], |r| r.get(0)).unwrap_or(0);
    if count > 0 { return Ok(()); }

    let db = crate::stock_tagger::load_stock_db();
    for (full_name, (code, short)) in &db.name_to_info {
        // Full name alias
        let _ = conn.execute("INSERT OR IGNORE INTO stock_aliases (stock_code, alias, alias_type) VALUES (?1,?2,'full')", [code.as_str(), full_name.as_str()]);
        // Short label alias
        let _ = conn.execute("INSERT OR IGNORE INTO stock_aliases (stock_code, alias, alias_type) VALUES (?1,?2,'short')", [code.as_str(), short.as_str()]);
        // Code alias
        let _ = conn.execute("INSERT OR IGNORE INTO stock_aliases (stock_code, alias, alias_type) VALUES (?1,?2,'code')", [code.as_str(), code.as_str()]);
    }
    Ok(())
}
fn attach_categories_as_tags(conn: &Connection, article_id: i64, categories: &[String]) {
    for cat in categories {
        if cat.trim().is_empty() {
            continue;
        }
        if conn
            .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [cat])
            .is_err()
        {
            continue;
        }
        if let Ok(tag_id) = conn.query_row("SELECT id FROM tags WHERE name = ?1", [cat], |r| {
            r.get::<_, i64>(0)
        }) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?1, ?2)",
                [article_id, tag_id],
            );
        }
    }
}

/// Scan an article against the A‑share stock database and attach matched
/// stocks as tags. Uses the same algorithm as paomiji.com's Knowledge‑Planet collector.
fn tag_article_with_stocks(
    conn: &Connection,
    article_id: i64,
    title: &str,
    content: &Option<String>,
) {
    use std::sync::LazyLock;
    static DB: LazyLock<crate::stock_tagger::StockDb> = LazyLock::new(crate::stock_tagger::load_stock_db);
    let text = format!("{} {}", title, content.as_deref().unwrap_or(""));
    let matches = crate::stock_tagger::find_stocks_in_text(&text, &DB);
    for (code, short, _full) in matches {
        if conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&code]).is_err() { continue; }
        if let Ok(tag_id) = conn.query_row("SELECT id FROM tags WHERE name = ?1", [&code], |r| r.get::<_,i64>(0)) {
            let _ = conn.execute("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?1,?2)", [article_id, tag_id]);
        }
        if conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&short]).is_err() { continue; }
        if let Ok(tag_id) = conn.query_row("SELECT id FROM tags WHERE name = ?1", [&short], |r| r.get::<_,i64>(0)) {
            let _ = conn.execute("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?1,?2)", [article_id, tag_id]);
        }
    }
}

fn apply_wordpress_update_result(
    conn: &Connection,
    feed_id: i64,
    result: crate::wordpress::WordPressFetchResult,
) -> Result<FeedUpdateOutcome, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut outcome = FeedUpdateOutcome::default();

    for item in result.articles {
        let created_at = now.clone();
        let (article, is_new, _is_updated) =
            upsert_article_from_feed_item(conn, feed_id, &item, &created_at)?;
        attach_categories_as_tags(conn, article.id, &item.categories);

        let context = rules_engine::RuleTriggerContext {
            is_existing_article: !is_new,
            is_new_article: is_new,
            allow_include_fetched: false,
        };

        if let Err(error) = rules_engine::process_article_rules_with_context(conn, &article, context)
        {
            eprintln!(
                "Warning: Failed to process rules for WordPress article {}: {}",
                article.id, error
            );
        }

        if is_new {
            outcome.new_articles.push(article);
        }
    }

    conn.execute(
        "UPDATE feeds SET last_updated = ?1, updated_at = ?2, error_message = NULL WHERE id = ?3",
        params![now, now, feed_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(outcome)
}

fn upsert_article_from_feed_item(
    conn: &Connection,
    feed_id: i64,
    item: &NewArticle,
    created_at: &str,
) -> Result<(Article, bool, bool), String> {
    let existing: Option<Article> = conn
        .query_row(
            "SELECT id, feed_id, title, link, summary, content, author, published_at,
                    updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
             FROM articles WHERE link = ?1",
            params![&item.link],
            row_to_article,
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(existing_article) = existing {
        let is_updated = existing_article.title != item.title
            || existing_article.summary != item.summary
            || existing_article.content != item.content
            || existing_article.author != item.author
            || existing_article.published_at != item.published_at
            || existing_article.updated_at != item.updated_at
            || existing_article.thumbnail != item.thumbnail;

        if is_updated {
            conn.execute(
                "UPDATE articles
                 SET title = ?1, summary = ?2, content = ?3, author = ?4,
                     published_at = ?5, updated_at = ?6, thumbnail = ?7
                 WHERE id = ?8",
                params![
                    &item.title,
                    &item.summary,
                    &item.content,
                    &item.author,
                    &item.published_at,
                    &item.updated_at,
                    &item.thumbnail,
                    existing_article.id
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        let article = Article {
            id: existing_article.id,
            feed_id: existing_article.feed_id,
            title: item.title.clone(),
            link: item.link.clone(),
            summary: item.summary.clone(),
            content: item.content.clone(),
            author: item.author.clone(),
            published_at: item.published_at.clone(),
            updated_at: item.updated_at.clone(),
            is_read: existing_article.is_read,
            is_starred: existing_article.is_starred,
            is_favorite: existing_article.is_favorite,
            created_at: existing_article.created_at,
            thumbnail: item.thumbnail.clone(),
            scores: None,
        };

        return Ok((article, false, is_updated));
    }

    conn.execute(
        "INSERT INTO articles (feed_id, title, link, summary, content, author, published_at, updated_at, thumbnail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            feed_id,
            &item.title,
            &item.link,
            &item.summary,
            &item.content,
            &item.author,
            &item.published_at,
            &item.updated_at,
            &item.thumbnail,
            created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    let article = Article {
        id: conn.last_insert_rowid(),
        feed_id,
        title: item.title.clone(),
        link: item.link.clone(),
        summary: item.summary.clone(),
        content: item.content.clone(),
        author: item.author.clone(),
        published_at: item.published_at.clone(),
        updated_at: item.updated_at.clone(),
        is_read: false,
        is_starred: false,
        is_favorite: false,
        created_at: created_at.to_string(),
        thumbnail: item.thumbnail.clone(),
        scores: None,
    };

    Ok((article, true, false))
}

// ── Eastmoney research report commands (SiteSense) ──

/// Helper: read all known Eastmoney info_codes without borrowing issues.
fn known_eastmoney_codes(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT info_code FROM eastmoney_reports")
        .map_err(|e| e.to_string())?;
    let rows: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Collect Eastmoney reports for all four categories. Deduplicates by info_code.
/// Called on app startup and then periodically to fill gaps.
#[tauri::command]
pub async fn collect_eastmoney_reports(
    conn: State<'_, DbState>,
) -> Result<Vec<EastmoneyReport>, String> {
    let known = {
        let c = conn.lock().map_err(|e| e.to_string())?;
        known_eastmoney_codes(&c)?
    };

    let fetcher = crate::eastmoney::EastmoneyFetcher::new()?;
    let today = crate::eastmoney::today_str();
    let half_year = crate::eastmoney::six_months_ago();
    let items = fetcher
        .fetch_all(&known, &half_year, &today)
        .await
        .map_err(|e| format!("Eastmoney fetch: {}", e))?;

    let conn = conn.lock().map_err(|e| e.to_string())?;
    let mut inserted: Vec<EastmoneyReport> = Vec::new();
    for item in items {
        let created_at = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO eastmoney_reports (category, title, org_name, org_sname, stock_name, stock_code, industry_name, publish_date, info_code, summary, is_read, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)",
            rusqlite::params![
                &item.category,
                &item.title,
                &item.org_name,
                &item.org_sname,
                &item.stock_name,
                &item.stock_code,
                &item.industry_name,
                &item.publish_date,
                &item.info_code,
                &item.summary,
                &created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        inserted.push(EastmoneyReport {
            id,
            category: item.category,
            title: item.title,
            org_name: item.org_name,
            org_sname: item.org_sname,
            stock_name: item.stock_name,
            stock_code: item.stock_code,
            industry_name: item.industry_name,
            publish_date: item.publish_date,
            info_code: item.info_code,
            summary: item.summary,
            is_read: false,
            pdf_path: None,
            created_at,
        });
    }

    Ok(inserted)
}

/// List reports by category, sorted newest first.
#[tauri::command]
pub fn get_eastmoney_reports(
    conn: State<'_, DbState>,
    category: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<EastmoneyReport>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let offset = offset.unwrap_or(0);
    let mut stmt = conn
        .prepare(
            "SELECT id, category, title, org_name, org_sname, stock_name, stock_code,
                    industry_name, publish_date, info_code, summary, pdf_path, is_read, created_at
             FROM eastmoney_reports
             WHERE category = ?1
             ORDER BY publish_date DESC, id DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![&category, limit, offset], |row| {
            Ok(EastmoneyReport {
                id: row.get(0)?,
                category: row.get(1)?,
                title: row.get(2)?,
                org_name: row.get(3)?,
                org_sname: row.get(4)?,
                stock_name: row.get(5)?,
                stock_code: row.get(6)?,
                industry_name: row.get(7)?,
                publish_date: row.get(8)?,
                info_code: row.get(9)?,
                summary: row.get(10)?,
                pdf_path: row.get(11)?,
                is_read: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Mark a single report as read.
#[tauri::command]
pub fn mark_eastmoney_report_read(conn: State<'_, DbState>, report_id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE eastmoney_reports SET is_read = 1 WHERE id = ?1",
        [report_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the latest publish_date in a category so the frontend knows what was the
/// last gap-fill checkpoint.
#[tauri::command]
pub fn get_eastmoney_last_date(
    conn: State<'_, DbState>,
    category: String,
) -> Result<Option<String>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT publish_date FROM eastmoney_reports WHERE category = ?1 ORDER BY publish_date DESC LIMIT 1",
            [&category],
            |r| r.get(0),
        )
        .ok();
    Ok(result)
}

/// Helper: get all reports that need PDF downloads.
fn pending_pdf_reports(conn: &Connection) -> Result<Vec<EastmoneyReport>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category, title, org_name, org_sname, stock_name, stock_code,
                    industry_name, publish_date, info_code, summary, pdf_path, is_read, created_at
             FROM eastmoney_reports WHERE pdf_path IS NULL OR pdf_path = ''",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<EastmoneyReport> = stmt
        .query_map([], |row| {
            Ok(EastmoneyReport {
                id: row.get(0)?,
                category: row.get(1)?,
                title: row.get(2)?,
                org_name: row.get(3)?,
                org_sname: row.get(4)?,
                stock_name: row.get(5)?,
                stock_code: row.get(6)?,
                industry_name: row.get(7)?,
                publish_date: row.get(8)?,
                info_code: row.get(9)?,
                summary: row.get(10)?,
                pdf_path: row.get(11)?,
                is_read: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Build a human-readable PDF filename following paomiji's scraper naming:
/// `20260722_600519_贵州茅台_中信证券_AP202607221827258468.pdf`
/// For industry reports (no stock code): `20260722_电子_中信证券_AP....pdf`
fn build_report_filename(r: &EastmoneyReport) -> String {
    let pub_date = r.publish_date.chars().take(10).collect::<String>().replace('-', "");
    let org = if r.org_sname.is_empty() { &r.org_name } else { &r.org_sname };
    let org = if org.is_empty() { "NA" } else { org.as_str() };
    let mut parts: Vec<String> = vec![pub_date];
    if let Some(sc) = &r.stock_code {
        if !sc.is_empty() { parts.push(sc.clone()); }
    }
    if let Some(sn) = &r.stock_name {
        if !sn.is_empty() { parts.push(sn.clone()); }
    }
    if r.stock_code.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
        if let Some(ind) = &r.industry_name {
            if !ind.is_empty() { parts.push(ind.clone()); }
        }
    }
    parts.push(org.to_string());
    parts.push(r.info_code.clone());
    sanitize_filename(&parts.join("_"))
}

fn sanitize_filename(name: &str) -> String {
    let clean: String = name.chars().map(|c| {
        if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | ' ') { '_' } else { c }
    }).collect();
    let clean = clean.trim().to_string();
    if clean.len() > 120 { clean[..120].to_string() } else { clean }
}

/// Download PDFs for Eastmoney reports that don't have one yet.
#[tauri::command]
pub async fn download_eastmoney_pdfs(
    conn: State<'_, DbState>,
) -> Result<i64, String> {
    let fetcher = crate::eastmoney::EastmoneyFetcher::new()?;
    let reports_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.jinxin.rssreader")
        .join("reports");

    let pending = {
        let c = conn.lock().map_err(|e| e.to_string())?;
        pending_pdf_reports(&c)?
    };

    let mut downloaded = 0i64;
    for report in &pending {
        let filename = build_report_filename(report);
        // Folder structure: 个股/{stock_code}/, 行业/{industry}/, 策略/, 晨报/
        let folder = match report.category.as_str() {
            "stock" => {
                let sc = report.stock_code.as_deref().unwrap_or("其他");
                format!("个股/{}", sanitize_filename(sc))
            }
            "industry" => {
                let ind = report.industry_name.as_deref().unwrap_or("其他");
                format!("行业/{}", sanitize_filename(ind))
            }
            "macro" => "策略".to_string(),
            "morning" => "晨报".to_string(),
            _ => "其他".to_string(),
        };
        let dest = reports_dir.join(folder).join(&filename);
        match fetcher
            .download_pdf_to(&report.info_code, &dest)
            .await
        {
            Ok(pdf_path) => {
                let conn = conn.lock().map_err(|e| e.to_string())?;
                let _ = conn.execute(
                    "UPDATE eastmoney_reports SET pdf_path = ?1 WHERE id = ?2",
                    rusqlite::params![&pdf_path, report.id],
                );
                downloaded += 1;
            }
            Err(e) => eprintln!("Eastmoney PDF {}: {}", report.info_code, e),
        }
    }

    Ok(downloaded)
}

/// Download PDFs only for the reports the user selected (by ID).
#[tauri::command]
pub async fn download_selected_pdfs(
    conn: State<'_, DbState>, report_ids: Vec<i64>,
) -> Result<i64, String> {
    let fetcher = crate::eastmoney::EastmoneyFetcher::new()?;
    let reports_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.jinxin.rssreader")
        .join("reports");

    let pending = {
        let c = conn.lock().map_err(|e| e.to_string())?;
        pending_pdf_reports(&c)?
    };

    let mut downloaded = 0i64;
    for report in &pending {
        if !report_ids.contains(&report.id) { continue; }
        let filename = build_report_filename(report);
        let folder = match report.category.as_str() {
            "stock" => format!("个股/{}", sanitize_filename(report.stock_code.as_deref().unwrap_or("其他"))),
            "industry" => format!("行业/{}", sanitize_filename(report.industry_name.as_deref().unwrap_or("其他"))),
            "macro" => "策略".to_string(),
            "morning" => "晨报".to_string(),
            _ => "其他".to_string(),
        };
        let dest = reports_dir.join(folder).join(&filename);
        match fetcher.download_pdf_to(&report.info_code, &dest).await {
            Ok(pdf_path) => {
                let conn = conn.lock().map_err(|e| e.to_string())?;
                let _ = conn.execute("UPDATE eastmoney_reports SET pdf_path = ?1 WHERE id = ?2",
                    rusqlite::params![&pdf_path, report.id]);
                downloaded += 1;
            }
            Err(e) => eprintln!("Eastmoney PDF {}: {}", report.info_code, e),
        }
    }
    Ok(downloaded)
}

// ── Market data sync ──
#[tauri::command]
pub async fn sync_market_data(
    conn: State<'_, DbState>,
) -> Result<crate::market_data::MarketDataCheck, String> {
    let fetcher = crate::market_data::MarketFetcher::new()?;
    let bars = fetcher.fetch_today_all().await
        .map_err(|e| format!("Market fetch: {}", e))?;

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let check = crate::market_data::validate_market_data(&bars, &today);

    let conn = conn.lock().map_err(|e| e.to_string())?;

    for bar in &bars {
        conn.execute(
            "INSERT OR REPLACE INTO stock_daily (code, name, trade_date, open, close, high, low, volume, amount, change_pct)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                &bar.code, &bar.name, &bar.trade_date,
                bar.open, bar.close, bar.high, bar.low,
                bar.volume, bar.amount, bar.change_pct,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Clean: keep only the latest 5 trading days
    let days = crate::market_data::recent_trading_days(
        &chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2026,1,1).unwrap()),
        5,
    );
    if let Some(oldest) = days.last() {
        let cutoff = oldest.format("%Y-%m-%d").to_string();
        let _ = conn.execute("DELETE FROM stock_daily WHERE trade_date < ?1", [&cutoff]);
    }

    Ok(check)
}

/// Quick check: does market data need updating? Returns a hint message or None.
#[tauri::command]
pub fn check_market_status(
    conn: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    Ok(crate::market_data::needs_market_sync(&conn))
}

/// Download PDFs embedded in an article's content and replace URLs with local paths.
#[tauri::command]
pub async fn download_article_pdfs(
    conn: State<'_, DbState>, article_id: i64,
) -> Result<String, String> {
    let (content, _content_opt): (String, Option<String>) = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let content_val: Option<String> = conn.query_row(
            "SELECT content FROM articles WHERE id = ?1", [article_id],
            |r| r.get::<_,Option<String>>(0)
        ).map_err(|e| e.to_string())?;
        let c = content_val.clone().unwrap_or_default();
        (c, content_val)
    };
    if content.is_empty() { return Ok(content); }

    let pdf_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
        .join("com.jinxin.rssreader").join("article_pdfs");
    let downloader = crate::pdf_downloader::PdfDownloader::new(pdf_dir)?;
    let replacements = downloader.download_embedded_pdfs(&content).await;
    if replacements.is_empty() { return Ok(content); }

    let new_content = crate::pdf_downloader::replace_pdf_links(&content, &replacements);
    let conn = conn.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE articles SET content = ?1 WHERE id = ?2",
        rusqlite::params![&new_content, article_id]).map_err(|e| e.to_string())?;
    Ok(new_content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn legacy_db_paths_include_old_locations() {
        let paths = get_legacy_db_paths();
        let cwd_legacy = PathBuf::from(".rss-reader-data").join("rss.db");

        assert!(paths.iter().any(|path| path.ends_with(&cwd_legacy)));

        if let Some(mut old_app_path) = dirs::data_dir() {
            old_app_path.push(LEGACY_APP_IDENTIFIER);
            old_app_path.push("rss.db");
            assert!(paths.contains(&old_app_path));
        }
    }

    #[test]
    fn init_database_resets_interrupted_ai_tasks() {
        let db_path =
            std::env::temp_dir().join(format!("rss-reader-init-reset-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE ai_tasks (
                    id TEXT PRIMARY KEY,
                    article_id INTEGER NOT NULL,
                    rule_id TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    error_msg TEXT
                )",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO ai_tasks (id, article_id, rule_id, status, error_msg)
                 VALUES ('task-1', 1, 'rule-1', 'processing', 'interrupted')",
                [],
            )
            .unwrap();
        }

        let conn = init_database_at_path(&db_path).unwrap();
        let (status, error_msg): (String, Option<String>) = conn
            .query_row(
                "SELECT status, error_msg FROM ai_tasks WHERE id = 'task-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(status, "pending");
        assert_eq!(error_msg, None);

        drop(conn);
        let _ = std::fs::remove_file(&db_path);
    }

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        // Enable foreign key constraints
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                url TEXT NOT NULL UNIQUE,
                link TEXT,
                category TEXT,
                last_updated TEXT,
                etag TEXT,
                last_modified TEXT,
                error_message TEXT,
                icon TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                link TEXT NOT NULL,
                summary TEXT,
                content TEXT,
                author TEXT,
                published_at TEXT,
                updated_at TEXT,
                is_read INTEGER DEFAULT 0,
                is_starred INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                thumbnail TEXT,
                FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        // Enable FTS5
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                title,
                content,
                summary,
                author,
                content='articles',
                content_rowid='id'
            )",
            [],
        )
        .unwrap();

        // Triggers to keep FTS index up to date
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
                INSERT INTO articles_fts(rowid, title, content, summary, author)
                VALUES (new.id, new.title, new.content, new.summary, new.author);
            END",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                conditions TEXT NOT NULL,
                actions TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn apply_feed_update_result_handles_not_modified_without_articles() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url, etag, last_modified, error_message)
             VALUES ('Cached Feed', 'https://example.com/feed.xml', 'old-etag', 'old-date', 'stale error')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        let outcome = apply_feed_update_result(
            &conn,
            feed_id,
            crate::feed::FeedFetchResult {
                feed: None,
                articles: Vec::new(),
                etag: Some("\"new-etag\"".to_string()),
                last_modified: Some("Wed, 21 Oct 2015 07:28:00 GMT".to_string()),
                not_modified: true,
            },
        )
        .unwrap();

        let article_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM articles", [], |row| row.get(0))
            .unwrap();
        let (etag, last_modified, error_message): (Option<String>, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT etag, last_modified, error_message FROM feeds WHERE id = ?1",
                [feed_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert!(outcome.new_articles.is_empty());
        assert!(outcome.updated_article_ids.is_empty());
        assert_eq!(article_count, 0);
        assert_eq!(etag.as_deref(), Some("\"new-etag\""));
        assert_eq!(
            last_modified.as_deref(),
            Some("Wed, 21 Oct 2015 07:28:00 GMT")
        );
        assert!(error_message.is_none());
    }

    #[test]
    fn apply_feed_update_result_reports_updated_existing_articles() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url, description, link)
             VALUES ('Old Feed', 'https://example.com/feed.xml', 'Old description', 'https://example.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, summary, content, created_at)
             VALUES (?1, 'Old title', 'https://example.com/article', 'Old summary', 'Old content', '2020-01-01T00:00:00Z')",
            [feed_id],
        )
        .unwrap();
        let article_id = conn.last_insert_rowid();

        let outcome = apply_feed_update_result(
            &conn,
            feed_id,
            crate::feed::FeedFetchResult {
                feed: Some(crate::models::NewFeed {
                    title: "New Feed".to_string(),
                    url: "https://example.com/feed.xml".to_string(),
                    description: Some("New description".to_string()),
                    link: Some("https://example.com".to_string()),
                    category: None,
                    icon: None,
                    source_type: "rss".to_string(),
                }),
                articles: vec![NewArticle {
                    feed_id,
                    title: "New title".to_string(),
                    link: "https://example.com/article".to_string(),
                    summary: Some("New summary".to_string()),
                    content: Some("New content".to_string()),
                    author: None,
                    published_at: None,
                    updated_at: Some("2026-01-01T00:00:00Z".to_string()),
                    thumbnail: None,
                    categories: Vec::new(),
                }],
                etag: None,
                last_modified: None,
                not_modified: false,
            },
        )
        .unwrap();

        assert!(outcome.new_articles.is_empty());
        assert_eq!(outcome.updated_article_ids, vec![article_id]);
        assert!(outcome.feed_changed);
        assert!(outcome.has_ui_changes());
    }

    #[test]
    fn test_search_by_author() {
        let conn = setup_test_db();

        // Insert a feed
        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        // Insert an article with a specific author
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, content, author)
             VALUES (?1, 'Rust News', 'http://rust.com', 'Some content', 'Linus Torvalds')",
            [feed_id],
        )
        .unwrap();

        // Search by author
        let results = search_articles_inner(&conn, "Linus".to_string()).unwrap();

        assert_eq!(results.len(), 1, "Should find article by author");
        assert_eq!(results[0].author.as_deref(), Some("Linus Torvalds"));
    }

    #[test]
    fn test_export_json() {
        let conn = setup_test_db();
        // Insert data
        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let fid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link) VALUES (?1, 'A1', 'L1')",
            [fid],
        )
        .unwrap();

        // Export
        let json = export_data_impl(&conn, "json").unwrap();

        // Check content
        assert!(json.contains("A1"), "JSON should contain article title");
        assert!(json.contains("L1"), "JSON should contain article link");
    }

    #[test]
    fn get_article_attaches_scores() {
        let conn = setup_test_db();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                conditions TEXT NOT NULL,
                actions TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS article_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                rule_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                badge_name TEXT,
                badge_color TEXT,
                badge_icon TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
                FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE,
                UNIQUE(article_id, rule_id)
            )",
            [],
        )
        .unwrap();

        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link) VALUES (?1, 'A1', 'L1')",
            [feed_id],
        )
        .unwrap();
        let article_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO rules (id, name, conditions, actions) VALUES ('rule-1', 'Rule 1', '{}', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rules (id, name, conditions, actions) VALUES ('rule-2', 'Rule 2', '{}', '[]')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO article_scores (article_id, rule_id, score) VALUES (?1, 'rule-1', 90)",
            [article_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO article_scores (article_id, rule_id, score) VALUES (?1, 'rule-2', 80)",
            [article_id],
        )
        .unwrap();

        let article = get_article_inner(&conn, article_id).unwrap().unwrap();
        assert!(article.scores.is_some());
        assert_eq!(article.scores.unwrap().len(), 2);
    }

    #[test]
    fn upsert_and_get_article_ai_summary() {
        let conn = setup_test_db();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS article_ai_summaries (
                article_id INTEGER PRIMARY KEY,
                summary TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link) VALUES (?1, 'A1', 'L1')",
            [feed_id],
        )
        .unwrap();
        let article_id = conn.last_insert_rowid();

        upsert_article_ai_summary_inner(&conn, article_id, "S1".to_string()).unwrap();
        assert_eq!(
            get_article_ai_summary_inner(&conn, article_id).unwrap(),
            Some("S1".to_string())
        );

        upsert_article_ai_summary_inner(&conn, article_id, "S2".to_string()).unwrap();
        assert_eq!(
            get_article_ai_summary_inner(&conn, article_id).unwrap(),
            Some("S2".to_string())
        );
    }

    #[test]
    fn navigation_respects_unread_scope() {
        let conn = setup_test_db();

        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at, is_read) VALUES (?1, 'Read newer', 'L1', '2026-01-03T00:00:00Z', 1)",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at, is_read) VALUES (?1, 'Unread current', 'L2', '2026-01-02T00:00:00Z', 0)",
            [feed_id],
        )
        .unwrap();
        let current_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at, is_read) VALUES (?1, 'Unread older', 'L3', '2026-01-01T00:00:00Z', 0)",
            [feed_id],
        )
        .unwrap();

        let (prev_article, next_article) = get_article_navigation_inner(
            &conn,
            current_id,
            ArticleNavigationContext {
                scope: NavigationScope::Unread,
                feed_id: None,
                tag_id: None,
                group_id: None,
                query: None,
            },
        )
        .unwrap();

        assert_eq!(
            prev_article.map(|article| article.title),
            Some("Unread older".to_string())
        );
        assert_eq!(next_article.map(|article| article.title), None);
    }

    #[test]
    fn navigation_respects_feed_scope() {
        let conn = setup_test_db();

        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let feed_id_1 = conn.last_insert_rowid();
        conn.execute("INSERT INTO feeds (title, url) VALUES ('F2', 'U2')", [])
            .unwrap();
        let feed_id_2 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at) VALUES (?1, 'Other feed newer', 'L1', '2026-01-03T00:00:00Z')",
            [feed_id_2],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at) VALUES (?1, 'Current', 'L2', '2026-01-02T00:00:00Z')",
            [feed_id_1],
        )
        .unwrap();
        let current_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at) VALUES (?1, 'Same feed older', 'L3', '2026-01-01T00:00:00Z')",
            [feed_id_1],
        )
        .unwrap();

        let (prev_article, next_article) = get_article_navigation_inner(
            &conn,
            current_id,
            ArticleNavigationContext {
                scope: NavigationScope::Feed,
                feed_id: Some(feed_id_1),
                tag_id: None,
                group_id: None,
                query: None,
            },
        )
        .unwrap();

        assert_eq!(
            prev_article.map(|article| article.title),
            Some("Same feed older".to_string())
        );
        assert_eq!(next_article.map(|article| article.title), None);
    }

    #[test]
    fn navigation_respects_search_scope() {
        let conn = setup_test_db();

        conn.execute("INSERT INTO feeds (title, url) VALUES ('F1', 'U1')", [])
            .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, content, published_at) VALUES (?1, 'Rust latest', 'L1', 'rust rust rust async guide', '2026-01-03T00:00:00Z')",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, content, published_at) VALUES (?1, 'Rust middle', 'L2', 'rust borrow checker', '2026-01-02T00:00:00Z')",
            [feed_id],
        )
        .unwrap();
        let current_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, content, published_at) VALUES (?1, 'Python only', 'L3', 'python asyncio', '2026-01-01T00:00:00Z')",
            [feed_id],
        )
        .unwrap();

        let (prev_article, next_article) = get_article_navigation_inner(
            &conn,
            current_id,
            ArticleNavigationContext {
                scope: NavigationScope::Search,
                feed_id: None,
                tag_id: None,
                group_id: None,
                query: Some("rust".to_string()),
            },
        )
        .unwrap();

        assert_eq!(prev_article.map(|article| article.title), None);
        assert_eq!(
            next_article.map(|article| article.title),
            Some("Rust latest".to_string())
        );
    }
}
