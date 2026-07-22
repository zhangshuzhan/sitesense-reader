//! Article PDF downloader — scans content for .pdf links, downloads to local
//! storage, and replaces URLs with local file paths.

use reqwest::header;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

pub struct PdfDownloader {
    client: reqwest::Client,
    pdf_dir: PathBuf,
}

impl PdfDownloader {
    pub fn new(pdf_dir: PathBuf) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| format!("PDF client: {}", e))?;
        Ok(Self { client, pdf_dir })
    }

    /// Scan HTML content for PDF links, download each, return (original_url, local_path) pairs.
    pub async fn download_embedded_pdfs(&self, html: &str) -> Vec<(String, String)> {
        let re = regex::Regex::new(r#"href=["']([^"']+\.pdf)["']"#).unwrap();
        let mut results = Vec::new();
        for cap in re.captures_iter(html) {
            let url = cap[1].to_string();
            if let Ok(path) = self.download_one(&url).await {
                results.push((url, path));
            }
        }
        results
    }

    async fn download_one(&self, url: &str) -> Result<String, String> {
        std::fs::create_dir_all(&self.pdf_dir).map_err(|e| e.to_string())?;
        // Keep original filename from URL; fall back to short hash if missing.
        let base_name = original_pdf_name(url).unwrap_or_else(|| {
            hex::encode(&Sha256::digest(url.as_bytes())[..8])
        });
        let path = self.pdf_dir.join(&base_name);
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
        let bytes = self.client.get(url)
            .header(header::REFERER, "https://www.google.com/")
            .send().await.map_err(|e| format!("PDF GET: {}", e))?
            .bytes().await.map_err(|e| format!("PDF read: {}", e))?;
        std::fs::write(&path, &bytes).map_err(|e| format!("PDF write: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    }
}

/// Extract the original filename from a PDF URL (last path segment, sanitized).
fn original_pdf_name(url: &str) -> Option<String> {
    let no_q = url.split('?').next().unwrap_or(url).split('#').next().unwrap_or(url);
    let seg = no_q.rsplit('/').next()?;
    if seg.is_empty() || !seg.to_lowercase().ends_with(".pdf") { return None; }
    // Sanitize Windows-unsafe characters but keep Chinese and normal chars
    let clean: String = seg.chars().filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();
    if clean.is_empty() { None } else { Some(clean) }
}

/// Replace PDF URLs in HTML with local paths.
pub fn replace_pdf_links(html: &str, replacements: &[(String, String)]) -> String {
    let mut result = html.to_string();
    for (url, local) in replacements {
        result = result.replace(url, local);
    }
    result
}
