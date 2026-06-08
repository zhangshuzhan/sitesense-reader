use crate::models::Feed;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<Connection>;

#[tauri::command]
pub fn export_opml(conn: State<DbState>) -> Result<String, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;

    let feeds: Vec<Feed> = conn
        .prepare("SELECT id, url, title, description, link, category, last_updated, created_at, updated_at, etag, last_modified, error_message, icon FROM feeds ORDER BY title")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(Feed {
                id: row.get(0)?,
                url: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                link: row.get(4)?,
                category: row.get(5)?,
                last_updated: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                etag: row.get(9)?,
                last_modified: row.get(10)?,
                error_message: row.get(11)?,
                icon: row.get(12)?,
                unread_count: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut opml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader Subscriptions</title>
  </head>
  <body>
"#,
    );

    for feed in feeds {
        let description = feed.description.as_deref().unwrap_or("");

        opml.push_str(&format!(
            r#"    <outline type="rss" text="{}" title="{}" xmlUrl="{}" description="{}"/>
"#,
            escape_xml(&feed.title),
            escape_xml(&feed.title),
            escape_xml(&feed.url),
            escape_xml(description)
        ));
    }

    opml.push_str(
        r#"  </body>
</opml>"#,
    );

    Ok(opml)
}

#[tauri::command]
pub async fn import_opml(
    conn: State<'_, DbState>,
    opml_content: String,
    rsshub_domain: Option<String>,
) -> Result<i32, String> {
    let feeds = parse_opml(&opml_content)?;
    let mut imported_count = 0;

    for feed_url in feeds {
        let fetcher = crate::feed::FeedFetcher::new()?;

        match fetcher
            .fetch_feed(
                &feed_url,
                crate::feed::FeedRequestOptions {
                    rsshub_domain: rsshub_domain.clone(),
                    etag: None,
                    last_modified: None,
                },
            )
            .await
        {
            Ok(fetch_result) => {
                if fetch_result.not_modified {
                    continue;
                }

                let Some(new_feed) = fetch_result.feed else {
                    continue;
                };
                let conn_lock = conn.lock().map_err(|e| e.to_string())?;

                let now = chrono::Utc::now().to_rfc3339();

                let result = conn_lock.execute(
                    "INSERT INTO feeds (url, title, description, link, category, icon, last_updated, created_at, updated_at, etag, last_modified)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        feed_url,
                        new_feed.title,
                        new_feed.description,
                        new_feed.link,
                        new_feed.category,
                        new_feed.icon,
                        now,
                        now,
                        now,
                        fetch_result.etag,
                        fetch_result.last_modified
                    ],
                );

                if result.is_ok() {
                    imported_count += 1;
                }
            }
            Err(_) => continue,
        }
    }

    Ok(imported_count)
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn parse_opml(opml_content: &str) -> Result<Vec<String>, String> {
    let mut feeds = Vec::new();

    for line in opml_content.lines() {
        if line.contains("<outline") && line.contains("xmlUrl=") {
            if let Some(start) = line.find("xmlUrl=\"") {
                let start = start + 8;
                if let Some(end) = line[start..].find('"') {
                    let url = &line[start..start + end];
                    let decoded = url
                        .replace("&amp;", "&")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&quot;", "\"")
                        .replace("&apos;", "'");
                    feeds.push(decoded);
                }
            }
        }
    }

    Ok(feeds)
}
