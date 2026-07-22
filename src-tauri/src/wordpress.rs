//! WordPress dual-mode adapter.
//!
//! SiteSense merges two ways of reading a WordPress site, both done in pure Rust
//! (no browser, therefore **no CORS** headaches):
//!
//! 1. **Public / core REST mode** (`wp`) — reads `/wp-json/wp/v2/posts` which every
//!    WordPress site exposes by default. No login, no plugin. This is the preferred
//!    mode and mirrors the behaviour of a normal RSS reader.
//! 2. **Plugin mode** (`sitesense`) — when the site installed the *SiteSense Connector*
//!    plugin and the user supplied a WordPress account token, we read the private
//!    `/wp-json/sitesense/v1/posts` (and fall back to `/sitesense/v1/ranking`) endpoints
//!    with a `Bearer` token. Used for sites that restrict public content.
//!
//! The frontend decides which mode to use by calling [`detect_wordpress`] first.

use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::models::{NewArticle, NewFeed};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordPressFetchOptions {
    /// Optional WordPress account token for plugin (sitesense) mode.
    pub token: Option<String>,
    pub per_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordPressFetchResult {
    pub feed: Option<NewFeed>,
    pub articles: Vec<NewArticle>,
    /// `"wp"` (public core REST) or `"sitesense"` (plugin, token required).
    pub mode: String,
    /// `"public"` or `"account"`.
    pub auth: String,
    pub reachable: bool,
    pub error_message: Option<String>,
}

pub struct WordPressFetcher {
    client: reqwest::Client,
}

impl WordPressFetcher {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        Ok(Self { client })
    }

    /// Normalize a user-entered base (host or URL) into a clean `https://host` string.
    fn normalize_base(base: &str) -> String {
        let mut s = base.trim().to_string();
        if !s.starts_with("http://") && !s.starts_with("https://") {
            s = format!("https://{}", s);
        }
        while s.ends_with('/') {
            s.pop();
        }
        s
    }

    /// Fetch a WordPress site, trying public mode first, then plugin mode when a token
    /// is supplied. Returns a result describing the chosen mode (or that it is unreachable).
    ///
    /// Public mode paginates through the REST API and collects up to `MAX_ARTICLES` recent
    /// posts (a single REST request is capped at 100 by WordPress anyway).
    pub async fn fetch(
        &self,
        base: &str,
        options: WordPressFetchOptions,
    ) -> Result<WordPressFetchResult, String> {
        let base = Self::normalize_base(base);
        let per_page = options.per_page.unwrap_or(50).clamp(1, 100) as usize;

        // 1) Public core REST — no token, no plugin. Paginated for more articles.
        if let Ok(result) = self.fetch_public_paginated(&base, per_page).await {
            return Ok(result);
        }

        // 2) Plugin mode with an account token.
        if let Some(token) = options.token.as_deref().filter(|t| !t.trim().is_empty()) {
            let plugin_urls = [
                format!("{}/wp-json/sitesense/v1/posts?per_page={}", base, per_page),
                format!("{}/wp-json/sitesense/v1/ranking?per_page={}", base, per_page),
            ];
            for url in plugin_urls {
                if let Ok(result) = self.try_fetch_posts(&base, &url, Some(token.to_string())).await
                {
                    return Ok(result);
                }
            }
        }

        Ok(WordPressFetchResult {
            feed: None,
            articles: Vec::new(),
            mode: String::new(),
            auth: String::new(),
            reachable: false,
            error_message: Some(
                "无法连接该 WordPress 站点，或该站点未开放公开内容且未提供账户 Token".to_string(),
            ),
        })
    }

    /// Paginated public REST fetch, collecting up to `MAX_ARTICLES` posts.
    async fn fetch_public_paginated(
        &self,
        base: &str,
        per_page: usize,
    ) -> Result<WordPressFetchResult, String> {
        const MAX_ARTICLES: usize = 100;
        const MAX_PAGES: usize = 5;
        let mut articles: Vec<NewArticle> = Vec::new();
        let mut page = 1usize;

        while page <= MAX_PAGES && articles.len() < MAX_ARTICLES {
            let url = format!(
                "{}/wp-json/wp/v2/posts?_embed=1&per_page={}&orderby=date&order=desc&page={}",
                base, per_page, page
            );
            let value = self.get_json(&url, None).await?;
            let posts = extract_posts_array(&value);
            if posts.is_empty() {
                break;
            }
            for post in &posts {
                if let Some(article) = map_wp_post(post) {
                    articles.push(article);
                }
            }
            if posts.len() < per_page {
                break;
            }
            page += 1;
        }

        if articles.is_empty() {
            return Err("WordPress response contained no posts".to_string());
        }

        let feed = self.build_feed(base).await;
        Ok(WordPressFetchResult {
            feed: Some(feed),
            articles,
            mode: "wp".to_string(),
            auth: "public".to_string(),
            reachable: true,
            error_message: None,
        })
    }

    /// GET a URL (optionally with a bearer token) and parse the JSON body.
    async fn get_json(&self, url: &str, token: Option<&str>) -> Result<Value, String> {
        let mut request = self.client.get(url);
        if let Some(token) = token {
            request = request.header(AUTHORIZATION, format!("Bearer {}", token));
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("WordPress request failed: {}", e))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("WordPress HTTP {} from {}", status, url));
        }
        response
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse WordPress JSON: {}", e))
    }

    async fn try_fetch_posts(
        &self,
        base: &str,
        url: &str,
        token: Option<String>,
    ) -> Result<WordPressFetchResult, String> {
        let mut request = self.client.get(url);
        if let Some(token) = token.as_ref() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", token));
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("WordPress request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("WordPress HTTP {} from {}", status, url));
        }

        let value: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse WordPress JSON: {}", e))?;

        let posts = extract_posts_array(&value);
        if posts.is_empty() {
            return Err("WordPress response contained no posts".to_string());
        }

        let mode = if token.is_some() {
            "sitesense"
        } else {
            "wp"
        }
        .to_string();
        let auth = if token.is_some() {
            "account"
        } else {
            "public"
        }
        .to_string();

        let articles: Vec<NewArticle> = posts.iter().filter_map(map_wp_post).collect();
        let feed = self.build_feed(base).await;

        Ok(WordPressFetchResult {
            feed: Some(feed),
            articles,
            mode,
            auth,
            reachable: true,
            error_message: None,
        })
    }

    /// Build the feed metadata. Best-effort: reads the site name from `/wp-json`; falls
    /// back to the host name when the root API is unavailable.
    async fn build_feed(&self, base: &str) -> NewFeed {
        let root_url = format!("{}/wp-json", base);
        if let Ok(resp) = self.client.get(&root_url).send().await {
            if let Ok(v) = resp.json::<Value>().await {
                let title = v
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let description = v
                    .get("description")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                let link = v.get("url").and_then(|x| x.as_str()).map(|s| s.to_string());
                let icon = v
                    .get("icon")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                if !title.is_empty() {
                    return NewFeed {
                        title,
                        url: base.to_string(),
                        description,
                        link,
                        category: None,
                        icon,
                        source_type: "wordpress".to_string(),
                    };
                }
            }
        }

        let host = base
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        NewFeed {
            title: host.to_string(),
            url: base.to_string(),
            description: None,
            link: Some(base.to_string()),
            category: None,
            icon: None,
            source_type: "wordpress".to_string(),
        }
    }
}

impl Clone for WordPressFetcher {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
        }
    }
}

impl Default for WordPressFetcher {
    fn default() -> Self {
        Self::new().expect("Failed to build WordPress HTTP client")
    }
}

/// Strip source‑site tag markup, shortcodes, and links from WordPress content.
fn clean_wp_content(html: &str) -> String {
    let mut s = html.to_string();
    // Remove WordPress shortcodes (e.g. [stock id="xxx"], [tag]...[/tag])
    let sc_re = regex::Regex::new(r"\[/?[a-zA-Z][^\]]*\]").unwrap();
    s = sc_re.replace_all(&s, "").to_string();
    // Remove inline stock-tag spans
    let span_re = regex::Regex::new(r#"<span[^>]*class="[^"]*tag[^"]*"[^>]*>.*?</span>"#).unwrap();
    s = span_re.replace_all(&s, "").to_string();
    // Remove all <a> tags but keep inner text (strip links)
    let a_re = regex::Regex::new(r#"<a\b[^>]*>(.*?)</a>"#).unwrap();
    s = a_re.replace_all(&s, "$1").to_string();
    s
}

/// Accept either a bare JSON array of posts, or an object that wraps them under one of
/// the common keys (`posts`, `data`, `articles`, `items`). This keeps us tolerant of
/// both the standard `wp/v2/posts` shape and the SiteSense plugin's wrapper.
fn extract_posts_array(value: &Value) -> Vec<Value> {
    match value {
        Value::Array(arr) => arr.clone(),
        Value::Object(map) => {
            for key in ["posts", "data", "articles", "items"] {
                if let Some(Value::Array(arr)) = map.get(key) {
                    return arr.clone();
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

/// Map a single WordPress post object (standard `wp/v2` or plugin-equivalent shape) into
/// our internal [`NewArticle`] model.
fn map_wp_post(post: &Value) -> Option<NewArticle> {
    let link = post.get("link")?.as_str()?.to_string();
    let title = post
        .get("title")
        .and_then(|t| t.get("rendered"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    if title.is_empty() {
        return None;
    }

    let content = post
        .get("content")
        .and_then(|c| c.get("rendered"))
        .and_then(|c| c.as_str())
        .map(|s| clean_wp_content(s));
    let summary = post
        .get("excerpt")
        .and_then(|e| e.get("rendered"))
        .and_then(|e| e.as_str())
        .map(|s| s.to_string());
    let published_at = post
        .get("date")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string());
    let updated_at = post
        .get("modified")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());

    let author = post
        .get("_embedded")
        .and_then(|e| e.get("author"))
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let thumbnail = post
        .get("_embedded")
        .and_then(|e| e.get("wp:featuredmedia"))
        .and_then(|m| m.as_array())
        .and_then(|m| m.first())
        .and_then(|m| m.get("source_url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    let categories = post
        .get("_embedded")
        .and_then(|e| e.get("wp:term"))
        .and_then(|t| t.as_array())
        .map(|terms| {
            terms
                .iter()
                .filter_map(|term| {
                    let taxonomy = term.get("taxonomy").and_then(|x| x.as_str()).unwrap_or("");
                    if taxonomy == "category" {
                        term.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    Some(NewArticle {
        feed_id: 0,
        title,
        link,
        author,
        content,
        summary,
        published_at,
        updated_at,
        thumbnail,
        categories,
    })
}

/// Tauri command: probe a WordPress site and report which mode works. Used by the
/// "Add WordPress site" dialog so the user knows whether a token is required.
#[tauri::command]
pub async fn detect_wordpress(base: String, token: Option<String>) -> Result<WordPressFetchResult, String> {
    let fetcher = WordPressFetcher::new()?;
    fetcher
        .fetch(
            &base,
            WordPressFetchOptions {
                token,
                per_page: Some(1),
            },
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_base_adds_scheme_and_strips_trailing_slash() {
        assert_eq!(WordPressFetcher::normalize_base("example.com/"), "https://example.com");
        assert_eq!(WordPressFetcher::normalize_base("http://example.com"), "http://example.com");
        assert_eq!(
            WordPressFetcher::normalize_base("  https://example.com//  "),
            "https://example.com"
        );
    }

    #[test]
    fn map_wp_post_parses_standard_shape() {
        let post = json!({
            "link": "https://example.com/hello",
            "title": { "rendered": "Hello World" },
            "content": { "rendered": "<p>正文内容</p>" },
            "excerpt": { "rendered": "摘要" },
            "date": "2024-01-02T03:04:05",
            "modified": "2024-01-03T03:04:05",
            "_embedded": {
                "author": [ { "name": "张三" } ],
                "wp:featuredmedia": [ { "source_url": "https://example.com/img.png" } ]
            }
        });
        let article = map_wp_post(&post).expect("should map");
        assert_eq!(article.title, "Hello World");
        assert_eq!(article.link, "https://example.com/hello");
        assert_eq!(article.author.as_deref(), Some("张三"));
        assert_eq!(article.thumbnail.as_deref(), Some("https://example.com/img.png"));
        assert_eq!(article.published_at.as_deref(), Some("2024-01-02T03:04:05"));
    }

    #[test]
    fn map_wp_post_returns_none_without_title() {
        let post = json!({ "link": "https://example.com/x", "title": { "rendered": "" } });
        assert!(map_wp_post(&post).is_none());
    }

    #[test]
    fn map_wp_post_extracts_categories_as_column_tags() {
        let post = json!({
            "link": "https://example.com/c",
            "title": { "rendered": "C" },
            "_embedded": {
                "wp:term": [
                    { "taxonomy": "category", "name": "A股" },
                    { "taxonomy": "post_tag", "name": "热门" },
                    { "taxonomy": "category", "name": "宏观" }
                ]
            }
        });
        let article = map_wp_post(&post).expect("should map");
        assert_eq!(article.categories, vec!["A股".to_string(), "宏观".to_string()]);
    }

    #[test]
    fn extract_posts_array_handles_wrappers() {
        let wrapped = json!({ "posts": [ json!({"link":"a","title":{"rendered":"A"}}) ] });
        assert_eq!(extract_posts_array(&wrapped).len(), 1);
        let bare = json!([ json!({"link":"a","title":{"rendered":"A"}}) ]);
        assert_eq!(extract_posts_array(&bare).len(), 1);
    }
}
