use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub description: Option<String>,
    pub link: Option<String>,
    pub category: Option<String>,
    pub last_updated: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub id: i64,
    pub feed_id: i64,
    pub title: String,
    pub link: String,
    pub author: Option<String>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub updated_at: Option<String>,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_favorite: bool,
    pub created_at: String,
    pub thumbnail: Option<String>,
    pub scores: Option<Vec<ArticleScore>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewFeed {
    pub title: String,
    pub url: String,
    pub description: Option<String>,
    pub link: Option<String>,
    pub category: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewArticle {
    pub feed_id: i64,
    pub title: String,
    pub link: String,
    pub author: Option<String>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub updated_at: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub db_size: u64,
    pub article_count: u64,
    pub media_cache_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub conditions: String,
    pub actions: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTask {
    pub id: String,
    pub article_id: i64,
    pub rule_id: String,
    pub status: String,
    pub task_type: String,
    pub action_config: Option<String>,
    pub error_msg: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleScore {
    pub id: i64,
    pub article_id: i64,
    pub rule_id: String,
    pub score: i32,
    pub badge_name: Option<String>,
    pub badge_color: Option<String>,
    pub badge_icon: Option<String>,
    pub created_at: String,
}
