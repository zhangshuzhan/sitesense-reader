use crate::db::{articles::row_to_article, rules_engine, DbState};
use crate::models::{Article, Rule};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

static AI_QUEUE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfilePayload {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub provider: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummaryArticleInput {
    pub id: Option<i64>,
    pub title: String,
    pub content: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueueRunResult {
    pub processed: usize,
    pub failed: usize,
    pub task_results: Vec<AiQueueTaskResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueueTaskResult {
    pub id: String,
    pub article_id: i64,
    pub rule_id: String,
    pub task_type: String,
    pub status: String,
    pub error_msg: Option<String>,
}

#[derive(Debug)]
struct PendingAiTask {
    id: String,
    article_id: i64,
    rule_id: String,
    _status: String,
    task_type: String,
    action_config: Option<String>,
    _error_msg: Option<String>,
    _created_at: String,
}

fn build_ai_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build AI client: {e}"))
}

fn normalize_openai_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn normalize_anthropic_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/messages") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/messages")
    }
}

async fn call_ai_api(
    client: &Client,
    profile: &AiProfilePayload,
    system_prompt: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    if profile.api_key.trim().is_empty() {
        return Err("API key is missing".to_string());
    }

    if profile.provider == "anthropic" {
        let endpoint = normalize_anthropic_endpoint(if profile.base_url.trim().is_empty() {
            "https://api.anthropic.com/v1"
        } else {
            &profile.base_url
        });
        let response = client
            .post(endpoint)
            .header("x-api-key", &profile.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": profile.model,
                "messages": [{ "role": "user", "content": prompt }],
                "system": system_prompt,
                "max_tokens": max_tokens,
            }))
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {e}"))?;

        if !response.status().is_success() {
            let error_data: Value = response.json().await.unwrap_or(Value::Null);
            return Err(error_data
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Anthropic request failed")
                .to_string());
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;
        Ok(payload
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find_map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("text") {
                        item.get("text").and_then(Value::as_str).map(str::to_string)
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_else(|| "{}".to_string()))
    } else {
        let endpoint = normalize_openai_endpoint(if profile.base_url.trim().is_empty() {
            "https://api.openai.com/v1"
        } else {
            &profile.base_url
        });
        let response = client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", profile.api_key))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": profile.model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": prompt }
                ],
                "max_tokens": max_tokens,
            }))
            .send()
            .await
            .map_err(|e| format!("OpenAI-compatible request failed: {e}"))?;

        if !response.status().is_success() {
            let error_data: Value = response.json().await.unwrap_or(Value::Null);
            return Err(error_data
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("OpenAI-compatible request failed")
                .to_string());
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse OpenAI-compatible response: {e}"))?;
        Ok(payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("{}")
            .to_string())
    }
}

fn truncate_for_tokens(content: &str, token_limit: usize) -> String {
    let soft_limit = token_limit.saturating_mul(3).max(1200);
    truncate_to_byte_limit(content, soft_limit).to_string()
}

fn truncate_to_byte_limit(content: &str, max_bytes: usize) -> &str {
    if content.len() <= max_bytes {
        return content;
    }

    let mut end = max_bytes;
    while !content.is_char_boundary(end) {
        end -= 1;
    }
    &content[..end]
}

fn extract_json_object(text: &str) -> Result<Value, String> {
    let start = text
        .find('{')
        .ok_or_else(|| "AI response did not contain JSON".to_string())?;
    let end = text
        .rfind('}')
        .ok_or_else(|| "AI response did not contain JSON".to_string())?;
    serde_json::from_str::<Value>(&text[start..=end])
        .map_err(|e| format!("Failed to parse AI JSON: {e}"))
}

fn query_article(conn: &Connection, article_id: i64) -> Result<Article, String> {
    conn.query_row(
        "SELECT id, feed_id, title, link, author, content, summary, published_at,
                updated_at, is_read, is_starred, is_favorite, created_at, thumbnail
         FROM articles WHERE id = ?1",
        [article_id],
        row_to_article,
    )
    .map_err(|e| e.to_string())
}

fn query_rule(conn: &Connection, rule_id: &str) -> Result<Rule, String> {
    conn.query_row(
        "SELECT id, name, is_active, conditions, actions, sort_order, created_at FROM rules WHERE id = ?1",
        [rule_id],
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

fn query_pending_ai_tasks(conn: &Connection, limit: i32) -> Result<Vec<PendingAiTask>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, article_id, rule_id, status, task_type, action_config, error_msg, created_at
             FROM ai_tasks
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([limit], |row| {
            Ok(PendingAiTask {
                id: row.get(0)?,
                article_id: row.get(1)?,
                rule_id: row.get(2)?,
                _status: row.get(3)?,
                task_type: row
                    .get::<_, Option<String>>(4)?
                    .unwrap_or_else(|| "condition".to_string()),
                action_config: row.get(5)?,
                _error_msg: row.get(6)?,
                _created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn claim_pending_ai_task(conn: &Connection, task_id: &str) -> Result<bool, String> {
    let changed = conn
        .execute(
            "UPDATE ai_tasks SET status = 'processing', error_msg = NULL
             WHERE id = ?1 AND status = 'pending'",
            [task_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed == 1)
}

fn select_profile<'a>(
    profiles: &'a [AiProfilePayload],
    preferred_id: Option<&str>,
) -> Result<&'a AiProfilePayload, String> {
    if let Some(profile_id) = preferred_id {
        if let Some(profile) = profiles
            .iter()
            .find(|profile| profile.id == profile_id && !profile.api_key.trim().is_empty())
        {
            return Ok(profile);
        }
    }

    profiles
        .iter()
        .find(|profile| !profile.api_key.trim().is_empty())
        .ok_or_else(|| "No usable AI profile available".to_string())
}

async fn summarize_content_with_profile(
    client: &Client,
    content: &str,
    profile: &AiProfilePayload,
) -> Result<String, String> {
    let prompt = truncate_for_tokens(content, 4000);
    let system_prompt = if profile.prompt.trim().is_empty() {
        "You are a helpful assistant that summarizes articles. Please provide a concise summary."
    } else {
        profile.prompt.as_str()
    };
    call_ai_api(client, profile, system_prompt, &prompt, 1024).await
}

async fn translate_content_with_profile(
    client: &Client,
    content: &str,
    profile: &AiProfilePayload,
    target_language: &str,
) -> Result<String, String> {
    let prompt = truncate_for_tokens(content, 4000);
    let system_prompt = format!(
        "You are a professional translator. Translate the following content into {target_language}. Maintain the original tone and formatting. Only return the translated text."
    );
    call_ai_api(client, profile, &system_prompt, &prompt, 2048).await
}

#[tauri::command]
pub async fn generate_article_summary(
    article_id: i64,
    profile: AiProfilePayload,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let cached_summary = {
        let conn = state.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT summary FROM article_ai_summaries WHERE article_id = ?1",
            [article_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(summary) = cached_summary {
        return Ok(summary);
    }

    let article = {
        let conn = state.lock().map_err(|e| e.to_string())?;
        query_article(&conn, article_id)?
    };

    let content = article.content.or(article.summary).unwrap_or(article.title);
    let client = build_ai_client()?;
    let summary = summarize_content_with_profile(&client, &content, &profile).await?;

    let conn = state.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO article_ai_summaries (article_id, summary) VALUES (?1, ?2)",
        params![article_id, summary],
    )
    .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
pub async fn translate_content(
    content: String,
    profile: AiProfilePayload,
    target_language: String,
) -> Result<String, String> {
    let client = build_ai_client()?;
    translate_content_with_profile(&client, &content, &profile, &target_language).await
}

#[tauri::command]
pub async fn batch_generate_summary(
    articles: Vec<BatchSummaryArticleInput>,
    mode: String,
    profile: AiProfilePayload,
    state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let client = build_ai_client()?;

    if mode == "separate" {
        for article in articles {
            let content = article
                .content
                .or(article.summary)
                .unwrap_or_else(|| article.title.clone());
            let summary = summarize_content_with_profile(&client, &content, &profile).await?;
            if let Some(article_id) = article.id {
                let conn = state.lock().map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT OR REPLACE INTO article_ai_summaries (article_id, summary) VALUES (?1, ?2)",
                    params![article_id, summary],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        return Ok(None);
    }

    let combined_content = articles
        .iter()
        .enumerate()
        .map(|(index, article)| {
            let content = article
                .summary
                .clone()
                .or(article.content.clone())
                .unwrap_or_default();
            let truncated = if content.len() > 1200 {
                format!("{}...", truncate_to_byte_limit(&content, 1200))
            } else {
                content
            };
            format!("Article {}: {}\n{}\n", index + 1, article.title, truncated)
        })
        .collect::<Vec<_>>()
        .join("\n---\n\n");

    let final_content = if combined_content.len() > 50_000 {
        format!(
            "{}... (truncated)",
            truncate_to_byte_limit(&combined_content, 50_000)
        )
    } else {
        combined_content
    };

    let system_prompt = format!(
        "You are a helpful assistant. Please provide a digest summary of the following {} articles. Group related topics together if possible. Format the output with clear headings and bullet points.",
        articles.len()
    );

    let summary = call_ai_api(&client, &profile, &system_prompt, &final_content, 4096).await?;
    Ok(Some(summary))
}

#[tauri::command]
pub async fn run_ai_queue(
    profiles: Vec<AiProfilePayload>,
    state: State<'_, DbState>,
) -> Result<AiQueueRunResult, String> {
    let _queue_guard = AI_QUEUE_LOCK.lock().await;

    if profiles.is_empty() {
        return Ok(AiQueueRunResult {
            processed: 0,
            failed: 0,
            task_results: Vec::new(),
        });
    }

    let client = build_ai_client()?;
    let mut processed = 0usize;
    let mut failed = 0usize;
    let mut task_results = Vec::new();

    loop {
        let tasks = {
            let conn = state.lock().map_err(|e| e.to_string())?;
            query_pending_ai_tasks(&conn, 5)?
        };

        if tasks.is_empty() {
            break;
        }

        for task in tasks {
            let (article, rule) = {
                let conn = state.lock().map_err(|e| e.to_string())?;
                let article = query_article(&conn, task.article_id)?;
                let rule = query_rule(&conn, &task.rule_id)?;
                if !claim_pending_ai_task(&conn, &task.id)? {
                    continue;
                }
                (article, rule)
            };

            let content = article
                .content
                .clone()
                .or(article.summary.clone())
                .unwrap_or_else(|| article.title.clone());

            let task_result = async {
                if task.task_type == "action_score" {
                    let action: Value = serde_json::from_str(
                        task.action_config
                            .as_deref()
                            .ok_or_else(|| "Missing action config".to_string())?,
                    )
                    .map_err(|e| format!("Invalid action config: {e}"))?;

                    let preferred_profile = action.get("aiProfileId").and_then(Value::as_str);
                    let profile = select_profile(&profiles, preferred_profile)?;
                    let prompt = action
                        .get("prompt")
                        .and_then(Value::as_str)
                        .unwrap_or("Score this article 0-100 and return JSON with score and reason.");

                    let response = call_ai_api(
                        &client,
                        profile,
                        "You are a helpful assistant that returns ONLY valid JSON.",
                        &format!(
                            "Score this article 0-100 based on the following criteria: {prompt}. Return JSON: {{ \"score\": 85, \"reason\": \"...\" }}\n\nArticle Title: {}\nArticle Content: {}",
                            article.title,
                            truncate_for_tokens(&content, 3000)
                        ),
                        1024,
                    )
                    .await?;
                    let parsed = extract_json_object(&response)?;
                    let score = parsed
                        .get("score")
                        .and_then(Value::as_i64)
                        .ok_or_else(|| "AI score response did not include a numeric score".to_string())?;

                    let conn = state.lock().map_err(|e| e.to_string())?;
                    conn.execute(
                        "INSERT OR REPLACE INTO article_scores (article_id, rule_id, score, badge_name, badge_color, badge_icon)
                         VALUES (?1, ?2, ?3, ?4, NULL, NULL)",
                        params![article.id, rule.id, score as i32, rule.name],
                    )
                    .map_err(|e| e.to_string())?;
                    Ok::<(), String>(())
                } else {
                    let conditions: Value = serde_json::from_str(&rule.conditions)
                        .map_err(|e| format!("Invalid rule conditions JSON: {e}"))?;
                    let ai_condition = conditions
                        .get("items")
                        .and_then(Value::as_array)
                        .and_then(|items| {
                            items.iter().find(|item| {
                                item.get("type").and_then(Value::as_str) == Some("ai_prompt")
                            })
                        })
                        .ok_or_else(|| "Rule does not contain an AI condition".to_string())?;

                    let profile = select_profile(
                        &profiles,
                        ai_condition.get("aiProfileId").and_then(Value::as_str),
                    )?;
                    let prompt_value = ai_condition
                        .get("value")
                        .and_then(Value::as_str)
                        .unwrap_or("Determine whether this article matches the condition.");
                    let token_limit = ai_condition
                        .get("tokenLimit")
                        .and_then(Value::as_u64)
                        .unwrap_or(3000) as usize;

                    let response = call_ai_api(
                        &client,
                        profile,
                        "You are a helpful assistant that returns ONLY valid JSON.",
                        &format!(
                            "Evaluate if this article matches the condition: {prompt_value}. Return JSON: {{ \"match\": true, \"reason\": \"...\" }}\n\nArticle Title: {}\nArticle Content: {}",
                            article.title,
                            truncate_for_tokens(&content, token_limit)
                        ),
                        1024,
                    )
                    .await?;
                    let parsed = extract_json_object(&response)?;
                    let is_match = parsed
                        .get("match")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);

                    if is_match {
                        let conn = state.lock().map_err(|e| e.to_string())?;
                        rules_engine::execute_actions(&conn, article.id, &rule)?;
                    }

                    Ok::<(), String>(())
                }
            }
            .await;

            let conn = state.lock().map_err(|e| e.to_string())?;
            match task_result {
                Ok(()) => {
                    let task_result = AiQueueTaskResult {
                        id: task.id.clone(),
                        article_id: task.article_id,
                        rule_id: task.rule_id.clone(),
                        task_type: task.task_type.clone(),
                        status: "done".to_string(),
                        error_msg: None,
                    };
                    conn.execute(
                        "UPDATE ai_tasks SET status = 'done', error_msg = NULL WHERE id = ?1",
                        [task.id.as_str()],
                    )
                    .map_err(|e| e.to_string())?;
                    processed += 1;
                    task_results.push(task_result);
                }
                Err(error) => {
                    let task_result = AiQueueTaskResult {
                        id: task.id.clone(),
                        article_id: task.article_id,
                        rule_id: task.rule_id.clone(),
                        task_type: task.task_type.clone(),
                        status: "failed".to_string(),
                        error_msg: Some(error.clone()),
                    };
                    conn.execute(
                        "UPDATE ai_tasks SET status = 'failed', error_msg = ?1 WHERE id = ?2",
                        params![error, task.id],
                    )
                    .map_err(|e| e.to_string())?;
                    failed += 1;
                    task_results.push(task_result);
                }
            }
        }
    }

    Ok(AiQueueRunResult {
        processed,
        failed,
        task_results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_pending_ai_task_only_claims_once() {
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
            "INSERT INTO ai_tasks (id, article_id, rule_id, status)
             VALUES ('task-1', 1, 'rule-1', 'pending')",
            [],
        )
        .unwrap();

        assert!(claim_pending_ai_task(&conn, "task-1").unwrap());
        assert!(!claim_pending_ai_task(&conn, "task-1").unwrap());
    }
}
