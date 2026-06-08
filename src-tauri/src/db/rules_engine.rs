use super::articles::row_to_article;
use crate::models::{Article, Rule};
use rusqlite::{params, Connection};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Default)]
pub struct RuleTriggerContext {
    pub is_existing_article: bool,
    pub is_new_article: bool,
    pub allow_include_fetched: bool,
}

pub fn parse_scope_flags(conditions_json: &str) -> (bool, bool) {
    let conditions: Value = match serde_json::from_str(conditions_json) {
        Ok(v) => v,
        Err(_) => return (false, false),
    };

    let only_updated = conditions
        .get("onlyUpdatedArticles")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let include_fetched = if only_updated {
        false
    } else {
        conditions
            .get("includeFetchedArticles")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    };

    (include_fetched, only_updated)
}

/// Evaluate a rule against an article.
/// Returns (matched, needs_ai_task).
pub fn evaluate_rule(rule: &Rule, article: &Article) -> (bool, bool) {
    if !rule.is_active {
        return (false, false);
    }

    let conditions: Value = match serde_json::from_str(&rule.conditions) {
        Ok(v) => v,
        Err(_) => return (false, false),
    };

    let logic = conditions
        .get("logic")
        .and_then(|v| v.as_str())
        .unwrap_or("and");
    let items = match conditions.get("items").and_then(|v| v.as_array()) {
        Some(i) => i,
        None => return (false, false),
    };

    if items.is_empty() {
        return (false, false);
    }

    let mut has_ai_condition = false;
    let mut sync_match_count = 0;
    let mut non_ai_count = 0;

    for item in items.iter() {
        let c_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let c_operator = item.get("operator").and_then(|v| v.as_str()).unwrap_or("");
        let c_value = item
            .get("value")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();

        if c_type == "ai_prompt" {
            has_ai_condition = true;
            continue; // Skip AI conditions for sync evaluation
        }

        non_ai_count += 1;
        let mut matched = false;

        match c_type {
            "title" => {
                let title = article.title.to_lowercase();
                matched = match c_operator {
                    "contains" => title.contains(&c_value),
                    "not_contains" => !title.contains(&c_value),
                    "equals" => title == c_value,
                    _ => false,
                };
            }
            "content" => {
                let content = article.content.as_deref().unwrap_or("").to_lowercase();
                let summary = article.summary.as_deref().unwrap_or("").to_lowercase();
                matched = match c_operator {
                    "contains" => content.contains(&c_value) || summary.contains(&c_value),
                    "not_contains" => !content.contains(&c_value) && !summary.contains(&c_value),
                    _ => false,
                };
            }
            "author" => {
                let author = article.author.as_deref().unwrap_or("").to_lowercase();
                matched = match c_operator {
                    "contains" => author.contains(&c_value),
                    "equals" => author == c_value,
                    _ => false,
                };
            }
            "feed_id" => {
                matched = article.feed_id.to_string() == c_value;
            }
            _ => {}
        }

        if matched {
            sync_match_count += 1;
        }
    }

    if logic == "and" {
        // For AND logic, ALL non-AI conditions must match
        if non_ai_count > 0 && sync_match_count < non_ai_count {
            (false, false)
        }
        // If they all matched (or there were no non-AI conditions), the outcome depends on AI
        else if has_ai_condition {
            (true, true) // It matches so far, but needs AI to confirm
        } else {
            (true, false) // All matched, no AI needed
        }
    } else {
        // For OR logic, if ANY non-AI condition matched, we can fire immediately
        if sync_match_count > 0 {
            (true, false)
        }
        // No non-AI condition matched, but we have an AI condition. Let AI decide.
        else if has_ai_condition {
            (true, true)
        } else {
            // Nothing matched, no AI condition
            (false, false)
        }
    }
}

pub fn execute_actions(conn: &Connection, article_id: i64, rule: &Rule) -> Result<(), String> {
    let actions: Vec<Value> = match serde_json::from_str(&rule.actions) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    for action in actions {
        let a_type = action.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match a_type {
            "mark_read" => {
                let _ = conn.execute(
                    "UPDATE articles SET is_read = 1 WHERE id = ?1",
                    params![article_id],
                );
            }
            "star" => {
                let _ = conn.execute(
                    "UPDATE articles SET is_starred = 1 WHERE id = ?1",
                    params![article_id],
                );
            }
            "add_tag" => {
                if let Some(tag_name) = action.get("value").and_then(|v| v.as_str()) {
                    // Try to get or create tag
                    let tag_name_trim = tag_name.trim();
                    if tag_name_trim.is_empty() {
                        continue;
                    }

                    let tag_id: Result<i64, _> = conn.query_row(
                        "SELECT id FROM tags WHERE name = ?1",
                        params![tag_name_trim],
                        |row| row.get(0),
                    );

                    let id = match tag_id {
                        Ok(id) => id,
                        Err(_) => {
                            let _ = conn.execute(
                                "INSERT INTO tags (name) VALUES (?1)",
                                params![tag_name_trim],
                            );
                            conn.last_insert_rowid()
                        }
                    };

                    // Link tag
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?1, ?2)",
                        params![article_id, id],
                    );
                }
            }
            "add_group" => {
                if let Some(group_name) = action.get("value").and_then(|v| v.as_str()) {
                    let group_name_trim = group_name.trim();
                    if group_name_trim.is_empty() {
                        continue;
                    }

                    let group_id: Result<i64, _> = conn.query_row(
                        "SELECT id FROM groups WHERE name = ?1",
                        params![group_name_trim],
                        |row| row.get(0),
                    );

                    let id = match group_id {
                        Ok(id) => id,
                        Err(_) => {
                            let _ = conn.execute(
                                "INSERT INTO groups (name) VALUES (?1)",
                                params![group_name_trim],
                            );
                            conn.last_insert_rowid()
                        }
                    };

                    // Link group
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO article_groups (article_id, group_id) VALUES (?1, ?2)",
                        params![article_id, id]
                    );
                }
            }
            _ => {}
        }
    }

    Ok(())
}

pub fn process_article_rules(conn: &Connection, article: &Article) -> Result<(), String> {
    process_article_rules_with_context(conn, article, RuleTriggerContext::default())
}

fn should_skip_by_scope(rule: &Rule, context: RuleTriggerContext) -> bool {
    let (include_fetched, only_new) = parse_scope_flags(&rule.conditions);

    if only_new {
        return !context.is_new_article;
    }

    if context.is_existing_article && !(include_fetched && context.allow_include_fetched) {
        return true;
    }

    false
}

fn has_rule_execution(conn: &Connection, article_id: i64, rule_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM article_rule_executions WHERE article_id = ?1 AND rule_id = ?2 LIMIT 1",
        params![article_id, rule_id],
        |_| Ok(()),
    )
    .map(|_| true)
    .or_else(|error| {
        if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
            Ok(false)
        } else {
            Err(error.to_string())
        }
    })
}

fn mark_rule_execution(conn: &Connection, article_id: i64, rule_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO article_rule_executions (article_id, rule_id) VALUES (?1, ?2)",
        params![article_id, rule_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn process_single_rule(
    conn: &Connection,
    article: &Article,
    rule: &Rule,
    context: RuleTriggerContext,
) -> Result<(), String> {
    if should_skip_by_scope(rule, context) {
        return Ok(());
    }

    if context.allow_include_fetched && has_rule_execution(conn, article.id, &rule.id)? {
        return Ok(());
    }

    let (matched, needs_ai) = evaluate_rule(rule, article);
    if !matched {
        return Ok(());
    }

    if needs_ai {
        let task_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO ai_tasks (id, article_id, rule_id, status, task_type) VALUES (?1, ?2, ?3, 'pending', 'condition')",
            params![task_id, article.id, rule.id]
        )
        .map_err(|e| e.to_string())?;
        mark_rule_execution(conn, article.id, &rule.id)?;
        return Ok(());
    }

    execute_actions(conn, article.id, rule)?;

    if let Ok(actions) = serde_json::from_str::<Vec<Value>>(&rule.actions) {
        for action in actions {
            if action.get("type").and_then(|v| v.as_str()) == Some("ai_score") {
                let task_id = Uuid::new_v4().to_string();
                let action_config = action.to_string();
                conn.execute(
                    "INSERT INTO ai_tasks (id, article_id, rule_id, status, task_type, action_config) VALUES (?1, ?2, ?3, 'pending', 'action_score', ?4)",
                    params![task_id, article.id, rule.id, action_config]
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    mark_rule_execution(conn, article.id, &rule.id)?;
    Ok(())
}

pub fn process_article_rules_with_context(
    conn: &Connection,
    article: &Article,
    context: RuleTriggerContext,
) -> Result<(), String> {
    // 1. Load active rules
    let mut stmt = conn.prepare("SELECT id, name, is_active, conditions, actions, sort_order, created_at FROM rules WHERE is_active = 1 ORDER BY sort_order ASC").map_err(|e| e.to_string())?;

    let rules: Vec<Rule> = stmt
        .query_map([], |row| {
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                is_active: row.get::<_, i32>(2)? == 1,
                conditions: row.get(3)?,
                actions: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    for rule in rules {
        process_single_rule(conn, article, &rule, context)?;
    }

    Ok(())
}

pub fn backfill_rule_for_existing_articles(conn: &Connection, rule: &Rule) -> Result<(), String> {
    let (include_fetched, only_updated) = parse_scope_flags(&rule.conditions);
    if !rule.is_active || !include_fetched || only_updated {
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, feed_id, title, link, author, content, summary, published_at,
                    updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
             FROM articles
             ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;

    let articles: Vec<Article> = stmt
        .query_map([], row_to_article)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let context = RuleTriggerContext {
        is_existing_article: true,
        is_new_article: false,
        allow_include_fetched: true,
    };

    for article in articles {
        process_single_rule(conn, &article, rule, context)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER NOT NULL,
                conditions TEXT NOT NULL,
                actions TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE articles (
                id INTEGER PRIMARY KEY,
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
                created_at TEXT NOT NULL,
                thumbnail TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE ai_tasks (
                id TEXT PRIMARY KEY,
                article_id INTEGER NOT NULL,
                rule_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                task_type TEXT DEFAULT 'condition',
                action_config TEXT,
                error_msg TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE article_rule_executions (
                article_id INTEGER NOT NULL,
                rule_id TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (article_id, rule_id)
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO articles (
                id, feed_id, title, link, author, content, summary, published_at, updated_at,
                is_read, is_starred, is_favorite, created_at, thumbnail
            ) VALUES (
                1, 1, 'hello world', 'https://example.com/1', NULL, NULL, NULL, NULL, NULL,
                0, 0, 0, '2026-01-01T00:00:00Z', NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    fn insert_rule(conn: &Connection, id: &str, conditions: &str) {
        conn.execute(
            "INSERT INTO rules (id, name, is_active, conditions, actions, sort_order, created_at)
             VALUES (?1, 'test-rule', 1, ?2, '[{\"type\":\"mark_read\"}]', 0, '2026-01-01T00:00:00Z')",
            params![id, conditions],
        )
        .unwrap();
    }

    fn sample_article() -> Article {
        Article {
            id: 1,
            feed_id: 1,
            title: "hello world".to_string(),
            link: "https://example.com/1".to_string(),
            author: None,
            content: None,
            summary: None,
            published_at: None,
            updated_at: None,
            is_read: false,
            is_starred: false,
            is_favorite: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            thumbnail: None,
            scores: None,
        }
    }

    fn read_is_read(conn: &Connection) -> i32 {
        conn.query_row("SELECT is_read FROM articles WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn read_execution_count(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM article_rule_executions WHERE article_id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn get_rule(conn: &Connection, id: &str) -> Rule {
        conn.query_row(
            "SELECT id, name, is_active, conditions, actions, sort_order, created_at FROM rules WHERE id = ?1",
            params![id],
            |row| {
                Ok(Rule {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_active: row.get::<_, i32>(2)? == 1,
                    conditions: row.get(3)?,
                    actions: row.get(4)?,
                    sort_order: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .unwrap()
    }

    #[test]
    fn include_fetched_does_not_run_during_regular_refresh() {
        let conn = setup_conn();
        insert_rule(
            &conn,
            "r1",
            r#"{
                "logic":"and",
                "items":[{"type":"title","operator":"contains","value":"hello"}],
                "includeFetchedArticles":true
            }"#,
        );
        let article = sample_article();

        process_article_rules_with_context(
            &conn,
            &article,
            RuleTriggerContext {
                is_existing_article: true,
                is_new_article: false,
                allow_include_fetched: false,
            },
        )
        .unwrap();

        assert_eq!(read_is_read(&conn), 0);
    }

    #[test]
    fn skips_existing_article_when_only_new_enabled() {
        let conn = setup_conn();
        insert_rule(
            &conn,
            "r2",
            r#"{
                "logic":"and",
                "items":[{"type":"title","operator":"contains","value":"hello"}],
                "includeFetchedArticles":true,
                "onlyUpdatedArticles":true
            }"#,
        );
        let article = sample_article();

        process_article_rules_with_context(
            &conn,
            &article,
            RuleTriggerContext {
                is_existing_article: true,
                is_new_article: false,
                allow_include_fetched: false,
            },
        )
        .unwrap();

        assert_eq!(read_is_read(&conn), 0);
    }

    #[test]
    fn processes_new_article_when_only_new_enabled() {
        let conn = setup_conn();
        insert_rule(
            &conn,
            "r3",
            r#"{
                "logic":"and",
                "items":[{"type":"title","operator":"contains","value":"hello"}],
                "onlyUpdatedArticles":true
            }"#,
        );
        let article = sample_article();

        process_article_rules_with_context(
            &conn,
            &article,
            RuleTriggerContext {
                is_existing_article: false,
                is_new_article: true,
                allow_include_fetched: false,
            },
        )
        .unwrap();

        assert_eq!(read_is_read(&conn), 1);
    }

    #[test]
    fn include_fetched_backfill_runs_once_for_unprocessed_articles() {
        let conn = setup_conn();
        insert_rule(
            &conn,
            "r4",
            r#"{
                "logic":"and",
                "items":[{"type":"title","operator":"contains","value":"hello"}],
                "includeFetchedArticles":true
            }"#,
        );

        let rule = get_rule(&conn, "r4");
        backfill_rule_for_existing_articles(&conn, &rule).unwrap();
        assert_eq!(read_is_read(&conn), 1);
        assert_eq!(read_execution_count(&conn), 1);

        conn.execute("UPDATE articles SET is_read = 0 WHERE id = 1", [])
            .unwrap();

        backfill_rule_for_existing_articles(&conn, &rule).unwrap();
        assert_eq!(read_is_read(&conn), 0);
        assert_eq!(read_execution_count(&conn), 1);
    }
}
