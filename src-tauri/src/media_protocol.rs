use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use reqwest::Client;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use uuid::Uuid;

const MEDIA_CACHE_DIR: &str = "media_cache";
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_FULL_MEDIA_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_MEDIA_RANGE_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static DOWNLOAD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn media_http_client() -> Result<&'static Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent(USER_AGENT)
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn hash_url(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(hasher.finalize())
}

fn media_cache_path(app: &AppHandle, url: &str) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(MEDIA_CACHE_DIR);

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    Ok(cache_dir.join(hash_url(url)))
}

async fn download_to_cache(url: &str, file_path: &Path) -> Result<(), String> {
    if file_path.exists() {
        return Ok(());
    }

    let _download_guard = DOWNLOAD_LOCK.lock().await;
    if file_path.exists() {
        return Ok(());
    }

    let client = media_http_client()?;
    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Failed to download: HTTP {}", response.status()));
    }

    if response
        .content_length()
        .is_some_and(|length| length > MAX_FULL_MEDIA_RESPONSE_BYTES)
    {
        return Err(media_too_large_error());
    }

    let tmp_path = temp_download_path(file_path);
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| e.to_string())?;

    let write_result = async {
        let mut downloaded = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            downloaded += chunk.len() as u64;
            if downloaded > MAX_FULL_MEDIA_RESPONSE_BYTES {
                return cleanup_oversized_download(&tmp_path).await;
            }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        file.flush().await.map_err(|e| e.to_string())
    }
    .await;

    if let Err(error) = write_result {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(error);
    }

    tokio::fs::rename(&tmp_path, file_path)
        .await
        .map_err(|e| e.to_string())
}

fn temp_download_path(file_path: &Path) -> PathBuf {
    file_path.with_extension(format!("download-{}", Uuid::new_v4()))
}

fn media_too_large_error() -> String {
    format!(
        "Media response exceeds {} bytes",
        MAX_FULL_MEDIA_RESPONSE_BYTES
    )
}

async fn cleanup_oversized_download(tmp_path: &Path) -> Result<(), String> {
    let _ = tokio::fs::remove_file(tmp_path).await;
    Err(media_too_large_error())
}

/// Parse HTTP Range header (e.g. "bytes=0-1024") into (start, end) tuple.
fn parse_range_header(range: &str, total_size: u64) -> Option<(u64, u64)> {
    if total_size == 0 {
        return None;
    }

    let range = range.trim();
    if !range.starts_with("bytes=") {
        return None;
    }

    let range_spec = &range[6..];
    let parts: Vec<&str> = range_spec.splitn(2, '-').collect();
    if parts.len() != 2 {
        return None;
    }

    if parts[0].is_empty() {
        let suffix_len: u64 = parts[1].parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let capped_suffix_len = suffix_len.min(MAX_MEDIA_RANGE_RESPONSE_BYTES);
        let start = total_size.saturating_sub(capped_suffix_len);
        return Some((start, total_size - 1));
    }

    let start: u64 = parts[0].parse().ok()?;
    let requested_end = if parts[1].is_empty() {
        total_size - 1
    } else {
        let end_val: u64 = parts[1].parse().ok()?;
        std::cmp::min(end_val, total_size - 1)
    };

    if start >= total_size || start > requested_end {
        return None;
    }

    let capped_end = start.saturating_add(MAX_MEDIA_RANGE_RESPONSE_BYTES - 1);
    let end = requested_end.min(capped_end);
    Some((start, end))
}

async fn read_file_range(
    file_path: &Path,
    start: u64,
    end: u64,
) -> Result<Vec<u8>, std::io::Error> {
    let mut file = tokio::fs::File::open(file_path).await?;
    file.seek(std::io::SeekFrom::Start(start)).await?;

    let len = (end - start + 1) as usize;
    let mut chunk = vec![0; len];
    file.read_exact(&mut chunk).await?;

    Ok(chunk)
}

fn guess_mime_type(url: &str) -> String {
    let clean_path = if let Some(q) = url.find('?') {
        &url[..q]
    } else if let Some(f) = url.find('#') {
        &url[..f]
    } else {
        url
    };
    let mut mime_type = mime_guess::from_path(clean_path)
        .first_or_octet_stream()
        .as_ref()
        .to_string();

    if mime_type == "application/octet-stream" {
        let lower_url = url.to_lowercase();
        if lower_url.contains(".mp4") {
            mime_type = "video/mp4".to_string();
        } else if lower_url.contains(".webm") {
            mime_type = "video/webm".to_string();
        } else if lower_url.contains(".m3u8") {
            mime_type = "application/vnd.apple.mpegurl".to_string();
        } else if lower_url.contains(".ogg") || lower_url.contains(".ogv") {
            mime_type = "video/ogg".to_string();
        }
    }
    mime_type
}

fn full_response_too_large(total_size: u64) -> bool {
    total_size > MAX_FULL_MEDIA_RESPONSE_BYTES
}

#[tauri::command]
pub async fn cache_media(url: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let file_path = media_cache_path(&app_handle, &url)?;
    download_to_cache(&url, &file_path).await?;
    Ok(file_path.to_string_lossy().to_string())
}

fn extract_encoded_url(uri: &tauri::http::Uri) -> String {
    let path = uri.path().to_string();
    let encoded_url_from_path = if let Some(stripped) = path.strip_prefix('/') {
        stripped.to_string()
    } else {
        path.clone()
    };

    if !encoded_url_from_path.is_empty() {
        return encoded_url_from_path;
    }

    let uri_string = uri.to_string();
    uri_string
        .strip_prefix("rss-media://localhost/")
        .or_else(|| uri_string.strip_prefix("rss-media://localhost"))
        .or_else(|| uri_string.strip_prefix("rss-media://"))
        .unwrap_or(&uri_string)
        .to_string()
}

async fn media_response(
    app: AppHandle,
    encoded_url: String,
    range_header: Option<String>,
) -> Result<tauri::http::Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let decoded_url = urlencoding::decode(&encoded_url)?.into_owned();
    let mime_type = guess_mime_type(&decoded_url);
    let file_path = media_cache_path(&app, &decoded_url)?;

    download_to_cache(&decoded_url, &file_path).await?;

    let total_size = tokio::fs::metadata(&file_path).await?.len();
    if total_size == 0 {
        return Ok(tauri::http::Response::builder()
            .header("Content-Type", &mime_type)
            .header("Content-Length", "0")
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())?);
    }

    if let Some(range_str) = &range_header {
        if let Some((start, end)) = parse_range_header(range_str, total_size) {
            let chunk = read_file_range(&file_path, start, end).await?;
            let content_range = format!("bytes {}-{}/{}", start, end, total_size);
            return Ok(tauri::http::Response::builder()
                .status(206)
                .header("Content-Type", &mime_type)
                .header("Content-Length", chunk.len().to_string())
                .header("Content-Range", content_range)
                .header("Accept-Ranges", "bytes")
                .header("Access-Control-Allow-Origin", "*")
                .body(chunk)?);
        }
    }

    if full_response_too_large(total_size) {
        return Ok(tauri::http::Response::builder()
            .status(413)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Content-Length", "0")
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())?);
    }

    let content = read_file_range(&file_path, 0, total_size.saturating_sub(1)).await?;
    Ok(tauri::http::Response::builder()
        .header("Content-Type", &mime_type)
        .header("Content-Length", total_size.to_string())
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .body(content)?)
}

pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(
        "rss-media",
        move |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let encoded_url = extract_encoded_url(request.uri());
            let range_header = request
                .headers()
                .get("Range")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);

            tauri::async_runtime::spawn(async move {
                let response = media_response(app, encoded_url, range_header)
                    .await
                    .unwrap_or_else(|e| {
                        eprintln!("[rss-media] ERROR: {}", e);
                        tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .expect("building HTTP 500 response should never fail")
                    });
                responder.respond(response);
            });
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parse_range_header_rejects_empty_files() {
        assert_eq!(parse_range_header("bytes=0-10", 0), None);
    }

    #[test]
    fn parse_range_header_caps_open_ended_ranges() {
        assert_eq!(
            parse_range_header("bytes=0-", MAX_MEDIA_RANGE_RESPONSE_BYTES * 4),
            Some((0, MAX_MEDIA_RANGE_RESPONSE_BYTES - 1))
        );
    }

    #[test]
    fn parse_range_header_rejects_zero_length_suffix() {
        assert_eq!(parse_range_header("bytes=-0", 10), None);
    }

    #[tokio::test]
    async fn read_file_range_reads_only_requested_bytes() {
        let file_path =
            std::env::temp_dir().join(format!("rss-reader-range-test-{}.bin", std::process::id()));
        fs::write(&file_path, b"0123456789").unwrap();

        let chunk = read_file_range(&file_path, 2, 5).await.unwrap();
        assert_eq!(chunk, b"2345");

        fs::remove_file(&file_path).unwrap();
    }

    #[tokio::test]
    async fn read_file_range_rejects_empty_file_reads() {
        let file_path = std::env::temp_dir().join(format!(
            "rss-reader-empty-range-test-{}.bin",
            std::process::id()
        ));
        fs::write(&file_path, b"").unwrap();

        assert!(read_file_range(&file_path, 0, 0).await.is_err());

        fs::remove_file(&file_path).unwrap();
    }

    #[test]
    fn full_response_too_large_caps_non_range_reads() {
        assert!(!full_response_too_large(MAX_FULL_MEDIA_RESPONSE_BYTES));
        assert!(full_response_too_large(MAX_FULL_MEDIA_RESPONSE_BYTES + 1));
    }

    #[tokio::test]
    async fn download_limit_rejects_oversized_streams_and_removes_temp_file() {
        let file_path = std::env::temp_dir().join(format!(
            "rss-reader-download-limit-test-{}",
            std::process::id()
        ));
        let tmp_path = temp_download_path(&file_path);
        fs::write(&tmp_path, vec![0; 8]).unwrap();

        let result = cleanup_oversized_download(&tmp_path).await;

        assert!(result.is_err());
        assert!(!tmp_path.exists());
        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn temp_download_path_is_unique_for_concurrent_downloads() {
        let file_path = std::env::temp_dir().join("rss-reader-media-cache-key");
        let first = temp_download_path(&file_path);
        let second = temp_download_path(&file_path);

        assert_ne!(first, second);
        assert_eq!(first.parent(), file_path.parent());
        assert_eq!(second.parent(), file_path.parent());
    }
}
