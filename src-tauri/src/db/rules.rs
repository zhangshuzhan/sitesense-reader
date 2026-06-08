use crate::models::{AiTask, ArticleScore, Rule};
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

type DbState = Mutex<Connection>;

fn query_rule_by_id(conn: &Connection, id: &str) -> Result<Rule, String> {
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
    .map_err(|e| e.to_string())
}

fn maybe_backfill_existing_articles(conn: &Connection, rule: &Rule) -> Result<(), String> {
    let (include_fetched, only_updated) = super::rules_engine::parse_scope_flags(&rule.conditions);
    if rule.is_active && include_fetched && !only_updated {
        super::rules_engine::backfill_rule_for_existing_articles(conn, rule)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_rules(state: State<'_, DbState>) -> Result<Vec<Rule>, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, is_active, conditions, actions, sort_order, created_at FROM rules ORDER BY sort_order ASC")
        .map_err(|e| e.to_string())?;

    let rules = stmt
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

    Ok(rules)
}

#[tauri::command]
pub fn create_rule(
    name: String,
    is_active: bool,
    conditions: String,
    actions: String,
    state: State<'_, DbState>,
) -> Result<Rule, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    // Get max sort_order
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM rules",
            [],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    let sort_order = max_sort + 1;

    conn.execute(
        "INSERT INTO rules (id, name, is_active, conditions, actions, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, name, is_active as i32, conditions, actions, sort_order],
    ).map_err(|e| e.to_string())?;

    let rule = query_rule_by_id(&conn, &id)?;
    maybe_backfill_existing_articles(&conn, &rule)?;
    Ok(rule)
}

#[tauri::command]
pub fn update_rule(
    id: String,
    name: String,
    is_active: bool,
    conditions: String,
    actions: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE rules SET name = ?1, is_active = ?2, conditions = ?3, actions = ?4 WHERE id = ?5",
        params![name, is_active as i32, conditions, actions, id],
    )
    .map_err(|e| e.to_string())?;

    let updated_rule = query_rule_by_id(&conn, &id)?;
    maybe_backfill_existing_articles(&conn, &updated_rule)?;

    Ok(())
}

#[tauri::command]
pub fn delete_rule(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rules WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_rules(rule_ids: Vec<String>, state: State<'_, DbState>) -> Result<(), String> {
    let mut conn = state.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, id) in rule_ids.iter().enumerate() {
        tx.execute(
            "UPDATE rules SET sort_order = ?1 WHERE id = ?2",
            params![index as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_pending_ai_tasks(limit: i32, state: State<'_, DbState>) -> Result<Vec<AiTask>, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;

    get_pending_ai_tasks_inner(&conn, limit)
}

fn get_pending_ai_tasks_inner(conn: &Connection, limit: i32) -> Result<Vec<AiTask>, String> {
    let mut stmt = conn.prepare("SELECT id, article_id, rule_id, status, task_type, action_config, error_msg, created_at FROM ai_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?1").map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map([limit], |row| {
            Ok(AiTask {
                id: row.get(0)?,
                article_id: row.get(1)?,
                rule_id: row.get(2)?,
                status: row.get(3)?,
                task_type: row.get(4)?,
                action_config: row.get(5)?,
                error_msg: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(tasks)
}

#[tauri::command]
pub fn update_ai_task_status(
    id: String,
    status: String,
    error_msg: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_tasks SET status = ?1, error_msg = ?2 WHERE id = ?3",
        params![status, error_msg, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn execute_rule_actions(
    article_id: i64,
    rule_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| e.to_string())?;

    let rule: Rule = conn.query_row("SELECT id, name, is_active, conditions, actions, sort_order, created_at FROM rules WHERE id = ?1", params![rule_id], |row| {
        Ok(Rule {
            id: row.get(0)?,
            name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? == 1,
            conditions: row.get(3)?,
            actions: row.get(4)?,
            sort_order: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    super::rules_engine::execute_actions(&conn, article_id, &rule).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_article_score(
    article_id: i64,
    rule_id: String,
    score: i32,
    badge_name: Option<String>,
    badge_color: Option<String>,
    badge_icon: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO article_scores (article_id, rule_id, score, badge_name, badge_color, badge_icon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![article_id, rule_id, score, badge_name, badge_color, badge_icon],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_article_scores(
    article_id: i64,
    state: State<'_, DbState>,
) -> Result<Vec<ArticleScore>, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, article_id, rule_id, score, badge_name, badge_color, badge_icon, created_at FROM article_scores WHERE article_id = ?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let scores = stmt
        .query_map([article_id], |row| {
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
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(scores)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn pending_ai_tasks_includes_task_type_and_action_config() {
        let conn = Connection::open_in_memory().unwrap();

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
            "INSERT INTO ai_tasks (id, article_id, rule_id, status, task_type, action_config, created_at)
             VALUES (?1, ?2, ?3, 'pending', 'action_score', ?4, '2026-02-26T00:00:00Z')",
            params!["task-1", 1i64, "rule-1", "{\"type\":\"ai_score\"}"],
        )
        .unwrap();

        let tasks = get_pending_ai_tasks_inner(&conn, 5).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].task_type, "action_score");
        assert_eq!(
            tasks[0].action_config.as_deref(),
            Some("{\"type\":\"ai_score\"}")
        );
    }
}
