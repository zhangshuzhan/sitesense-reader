use crate::models::{Article, ArticleScore};
use rusqlite::{Connection, Row};
use std::collections::HashMap;

/// Convert a database row to an Article struct.
/// This function is used by all article query functions to ensure consistent mapping.
pub fn row_to_article(row: &Row) -> Result<Article, rusqlite::Error> {
    Ok(Article {
        id: row.get(0)?,
        feed_id: row.get(1)?,
        title: row.get(2)?,
        link: row.get(3)?,
        author: row.get(4)?,
        content: row.get(5)?,
        summary: row.get(6)?,
        published_at: row.get(7)?,
        updated_at: row.get(8)?,
        is_read: row.get::<_, i64>(9)? == 1,
        is_starred: row.get::<_, i64>(10)? == 1,
        is_favorite: row.get::<_, i64>(11)? == 1,
        created_at: row.get(12)?,
        thumbnail: row.get(13)?,
        scores: None,
    })
}

/// Filter type for article queries
#[derive(Debug, Clone, Copy)]
pub enum ArticleFilter {
    All,
    Unread,
    Starred,
    Favorite,
}

/// Query articles with optional filtering, pagination, and sorting.
/// This unified function replaces get_articles, get_unread_articles, get_starred_articles, and get_favorite_articles.
pub fn query_articles(
    conn: &Connection,
    filter: ArticleFilter,
    feed_id: Option<i64>,
    sort_by: Option<&str>,
    cursor: Option<&str>,
    limit: u64,
) -> Result<Vec<Article>, String> {
    let score_sort_rule_id = sort_by
        .and_then(|s| s.strip_prefix("score_desc:"))
        .filter(|s| !s.is_empty());
    let is_score_sort = score_sort_rule_id.is_some();

    let sql_base = if is_score_sort {
        "SELECT a.id, a.feed_id, a.title, a.link, a.author, a.content, a.summary, a.published_at,
                a.updated_at, a.is_read, a.is_starred, a.is_favorite, a.created_at, a.thumbnail,
                COALESCE((SELECT score FROM article_scores WHERE article_id = a.id AND rule_id = ?), 0) as rule_score
         FROM articles a"
    } else {
        "SELECT id, feed_id, title, link, author, content, summary, published_at,
                updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
         FROM articles"
    };

    let mut where_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut offset = 0u64;

    // Apply filter-specific WHERE clause
    match filter {
        ArticleFilter::Unread => {
            where_clauses.push("is_read = 0".to_string());
        }
        ArticleFilter::Starred => {
            where_clauses.push("is_starred = 1".to_string());
        }
        ArticleFilter::Favorite => {
            where_clauses.push("is_favorite = 1".to_string());
        }
        ArticleFilter::All => {}
    }

    if let Some(rule_id) = score_sort_rule_id {
        params.push(Box::new(rule_id.to_string()));
    }

    // Apply feed_id filter
    if let Some(fid) = feed_id {
        if is_score_sort {
            where_clauses.push("a.feed_id = ?".to_string());
        } else {
            where_clauses.push("feed_id = ?".to_string());
        }
        params.push(Box::new(fid));
    }

    // Apply cursor-based pagination
    if let Some(c) = cursor {
        if let Some(off_str) = c.strip_prefix("offset|") {
            if let Ok(off) = off_str.parse::<u64>() {
                offset = off;
            }
        } else if let Some((ts, id_str)) = c.split_once('|') {
            if let Ok(id) = id_str.parse::<i64>() {
                if is_score_sort {
                    where_clauses.push(
                        "(a.published_at < ? OR (a.published_at = ? AND a.id < ?))".to_string(),
                    );
                } else {
                    where_clauses
                        .push("(published_at < ? OR (published_at = ? AND id < ?))".to_string());
                }
                params.push(Box::new(ts.to_string()));
                params.push(Box::new(ts.to_string()));
                params.push(Box::new(id));
            }
        }
    }

    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = if is_score_sort {
        "ORDER BY rule_score DESC, a.published_at DESC, a.id DESC"
    } else {
        "ORDER BY published_at DESC, id DESC"
    };

    let sql = if offset > 0 {
        format!("{} {} {} LIMIT ? OFFSET ?", sql_base, where_sql, order_sql)
    } else {
        format!("{} {} {} LIMIT ?", sql_base, where_sql, order_sql)
    };

    params.push(Box::new(limit));
    if offset > 0 {
        params.push(Box::new(offset));
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut articles = stmt
        .query_map(&*params_refs, row_to_article)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    attach_scores_to_articles(conn, &mut articles)?;
    Ok(articles)
}

/// Attach scores to articles in bulk for efficient querying
pub fn attach_scores_to_articles(
    conn: &Connection,
    articles: &mut [Article],
) -> Result<(), String> {
    if articles.is_empty() {
        return Ok(());
    }

    let article_ids: Vec<i64> = articles.iter().map(|a| a.id).collect();
    let placeholders = vec!["?"; article_ids.len()].join(", ");

    let sql = format!(
        "SELECT id, article_id, rule_id, score, badge_name, badge_color, badge_icon, created_at
         FROM article_scores
         WHERE article_id IN ({})",
        placeholders
    );

    let params: Vec<&dyn rusqlite::ToSql> = article_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut scores_map: HashMap<i64, Vec<ArticleScore>> = HashMap::new();

    let rows = stmt
        .query_map(&*params, |row| {
            Ok(ArticleScore {
                id: row.get(0)?,
                article_id: row.get(1)?,
                rule_id: row.get(2)?,
                score: row.get(3)?,
                badge_name: row.get(4)?,
                badge_color: row.get(5)?,
                badge_icon: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let score = row.map_err(|e| e.to_string())?;
        scores_map.entry(score.article_id).or_default().push(score);
    }

    for article in articles.iter_mut() {
        if let Some(scores) = scores_map.remove(&article.id) {
            article.scores = Some(scores);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE
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
                author TEXT,
                content TEXT,
                summary TEXT,
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

        conn.execute(
            "CREATE TABLE IF NOT EXISTS article_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                rule_id TEXT,
                score INTEGER NOT NULL,
                badge_name TEXT,
                badge_color TEXT,
                badge_icon TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn query_articles_sorts_by_specific_rule_score() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at) VALUES (?1, 'Article 1', 'http://test.com/1', '2026-01-02T00:00:00Z')",
            [feed_id],
        )
        .unwrap();
        let article_id_1 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, published_at) VALUES (?1, 'Article 2', 'http://test.com/2', '2026-01-01T00:00:00Z')",
            [feed_id],
        )
        .unwrap();
        let article_id_2 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO article_scores (article_id, rule_id, score) VALUES (?1, 'r1', 10)",
            [article_id_1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO article_scores (article_id, rule_id, score) VALUES (?1, 'r1', 50)",
            [article_id_2],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO article_scores (article_id, rule_id, score) VALUES (?1, 'r2', 90)",
            [article_id_1],
        )
        .unwrap();

        let articles = query_articles(
            &conn,
            ArticleFilter::All,
            None,
            Some("score_desc:r1"),
            None,
            10,
        )
        .unwrap();

        assert_eq!(articles.len(), 2);
        assert_eq!(articles[0].id, article_id_2);
        assert_eq!(articles[1].id, article_id_1);
    }

    #[test]
    fn test_query_articles_all() {
        let conn = setup_test_db();

        // Insert a feed
        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        // Insert articles
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_read, is_starred, is_favorite) VALUES (?1, 'Article 1', 'http://test.com/1', 0, 0, 0)",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_read, is_starred, is_favorite) VALUES (?1, 'Article 2', 'http://test.com/2', 1, 1, 1)",
            [feed_id],
        )
        .unwrap();

        let articles = query_articles(&conn, ArticleFilter::All, None, None, None, 10).unwrap();
        assert_eq!(articles.len(), 2);
    }

    #[test]
    fn test_query_articles_unread() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_read) VALUES (?1, 'Unread Article', 'http://test.com/1', 0)",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_read) VALUES (?1, 'Read Article', 'http://test.com/2', 1)",
            [feed_id],
        )
        .unwrap();

        let articles = query_articles(&conn, ArticleFilter::Unread, None, None, None, 10).unwrap();
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Unread Article");
        assert!(!articles[0].is_read);
    }

    #[test]
    fn test_query_articles_starred() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_starred) VALUES (?1, 'Starred Article', 'http://test.com/1', 1)",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_starred) VALUES (?1, 'Normal Article', 'http://test.com/2', 0)",
            [feed_id],
        )
        .unwrap();

        let articles = query_articles(&conn, ArticleFilter::Starred, None, None, None, 10).unwrap();
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Starred Article");
        assert!(articles[0].is_starred);
    }

    #[test]
    fn test_query_articles_favorite() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Test Feed', 'http://test.com')",
            [],
        )
        .unwrap();
        let feed_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_favorite) VALUES (?1, 'Favorite Article', 'http://test.com/1', 1)",
            [feed_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link, is_favorite) VALUES (?1, 'Normal Article', 'http://test.com/2', 0)",
            [feed_id],
        )
        .unwrap();

        let articles =
            query_articles(&conn, ArticleFilter::Favorite, None, None, None, 10).unwrap();
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Favorite Article");
        assert!(articles[0].is_favorite);
    }

    #[test]
    fn test_query_articles_with_feed_id() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Feed 1', 'http://test1.com')",
            [],
        )
        .unwrap();
        let feed_id1 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO feeds (title, url) VALUES ('Feed 2', 'http://test2.com')",
            [],
        )
        .unwrap();
        let feed_id2 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO articles (feed_id, title, link) VALUES (?1, 'Article 1', 'http://test.com/1')",
            [feed_id1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (feed_id, title, link) VALUES (?1, 'Article 2', 'http://test.com/2')",
            [feed_id2],
        )
        .unwrap();

        let articles =
            query_articles(&conn, ArticleFilter::All, Some(feed_id1), None, None, 10).unwrap();
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Article 1");
    }
}
