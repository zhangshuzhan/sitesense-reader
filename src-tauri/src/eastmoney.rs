//! Eastmoney (东方财富) research report collector.
//!
//! Pulls four categories from `reportapi.eastmoney.com`:
//! - 上市公司研报  (stock)      – qType=0
//! - 行业分析研报  (industry)   – qType=1
//! - 宏观策略研报  (macro)      – qType=2, column prefixed 002001
//! - 券商晨会     (morning)    – qType=2, column prefixed 002003
//!
//! Deduplication is based on the unique `infoCode` assigned by Eastmoney.

use regex::Regex;
use reqwest::header;
use serde::Deserialize;
use std::time::Duration;

use crate::models::NewEastmoneyReport;

const API_URL: &str = "https://reportapi.eastmoney.com/report/list";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Simple JSONP wrapper returned by the Eastmoney API.
#[derive(Debug, Deserialize)]
struct RawResponse {
    #[serde(default)]
    data: Vec<RawReport>,
    #[serde(default)]
    #[serde(rename = "TotalPage")]
    total_page: i64,
}

#[derive(Debug, Deserialize)]
struct RawReport {
    #[serde(rename = "infoCode")]
    info_code: Option<String>,
    title: Option<String>,
    #[serde(rename = "orgName")]
    org_name: Option<String>,
    #[serde(rename = "orgSName")]
    org_sname: Option<String>,
    #[serde(rename = "stockName")]
    stock_name: Option<String>,
    #[serde(rename = "stockCode")]
    stock_code: Option<String>,
    #[serde(rename = "indvInduName")]
    indv_indu_name: Option<String>,
    #[serde(rename = "publishDate")]
    publish_date: Option<String>,
    column: Option<String>,
}

/// Category definition: qType, label, optional column prefix filter.
#[derive(Clone)]
struct ReportCategory {
    qtype: i32,
    /// Optional column prefix filter (e.g. `002001` for macro, `002003` for morning).
    column_prefix: Option<&'static str>,
    label: &'static str,
}

const CATEGORIES: [ReportCategory; 4] = [
    ReportCategory { qtype: 0, column_prefix: None, label: "stock" },
    ReportCategory { qtype: 1, column_prefix: None, label: "industry" },
    ReportCategory { qtype: 2, column_prefix: Some("002001"), label: "macro" },
    ReportCategory { qtype: 2, column_prefix: Some("002003"), label: "morning" },
];

pub struct EastmoneyFetcher {
    client: reqwest::Client,
}

impl EastmoneyFetcher {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| format!("Failed to build Eastmoney HTTP client: {}", e))?;
        Ok(Self { client })
    }

    /// Fetch all four categories. `known_info_codes` allows skipping records we already have.
    pub async fn fetch_all(
        &self,
        known_info_codes: &[String],
        begin: &str,
        end: &str,
    ) -> Result<Vec<NewEastmoneyReport>, String> {
        let mut reports = Vec::new();
        for cat in &CATEGORIES {
            match self.fetch_category(cat, known_info_codes, begin, end).await {
                Ok(mut items) => reports.append(&mut items),
                Err(e) => eprintln!("Eastmoney fetch {}: {}", cat.label, e),
            }
        }
        Ok(reports)
    }

    async fn fetch_category(
        &self,
        cat: &ReportCategory,
        known: &[String],
        begin: &str,
        end: &str,
    ) -> Result<Vec<NewEastmoneyReport>, String> {
        let mut reports = Vec::new();
        let mut page = 1;
        loop {
            let url = format!(
                "{}?cb=jQuery&pageNo={}&pageSize=50&beginTime={}&endTime={}&qType={}&fields=title,infoCode,orgName,orgSName,stockName,stockCode,indvInduName,publishDate,column",
                API_URL, page, begin, end, cat.qtype
            );
            let body = self
                .client
                .get(&url)
                .header(header::REFERER, "https://data.eastmoney.com/")
                .send()
                .await
                .map_err(|e| format!("Eastmoney request: {}", e))?
                .text()
                .await
                .map_err(|e| format!("Eastmoney response: {}", e))?;

            let raw: RawResponse = parse_jsonp(&body)?;
            if raw.data.is_empty() {
                break;
            }

            for r in &raw.data {
                if let Some(col) = &r.column {
                    if let Some(prefix) = cat.column_prefix {
                        if !col.starts_with(prefix) {
                            continue;
                        }
                    }
                }
                let info_code = match &r.info_code {
                    Some(c) if !c.is_empty() => c.clone(),
                    _ => continue,
                };
                if known.iter().any(|k| k == &info_code) {
                    continue;
                }
                let publish_date = r
                    .publish_date
                    .as_deref()
                    .unwrap_or("")
                    .chars()
                    .take(10)
                    .collect::<String>();
                reports.push(NewEastmoneyReport {
                    category: cat.label.to_string(),
                    title: r.title.as_deref().unwrap_or("").to_string(),
                    org_name: r.org_name.as_deref().unwrap_or("").to_string(),
                    org_sname: r.org_sname.as_deref().unwrap_or("").to_string(),
                    stock_name: r.stock_name.clone(),
                    stock_code: r.stock_code.clone(),
                    industry_name: r.indv_indu_name.clone().filter(|s| !s.is_empty()),
                    publish_date,
                    info_code,
                    summary: None,
                });
            }

            let total = raw.total_page.max(1) as i32;
            if page >= total {
                break;
            }
            page += 1;
        }
        Ok(reports)
    }

    // ── PDF download ──

    /// Fetch the report detail page and extract the PDF attach_url from `var zwinfo`.
    pub async fn fetch_pdf_url(&self, info_code: &str) -> Option<String> {
        let url = format!("https://data.eastmoney.com/report/info/{}.html", info_code);
        let body = self
            .client
            .get(&url)
            .header(header::REFERER, "https://data.eastmoney.com/")
            .send()
            .await
            .ok()?
            .text()
            .await
            .ok()?;
        let re = Regex::new(r#"(?s)var zwinfo\s*=\s*(\{.*?\});"#).unwrap();
        let json_str = re.captures(&body)?.get(1)?.as_str();
        let v: serde_json::Value = serde_json::from_str(json_str).ok()?;
        v.get("attach_url")?.as_str().map(|s| s.to_string())
    }

    /// Download a PDF from `url` and save it to `path`. Creates parent dirs.
    pub async fn download_pdf(&self, url: &str, path: &std::path::Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
        }
        if path.exists() {
            return Ok(());
        }
        let bytes = self
            .client
            .get(url)
            .header(header::REFERER, "https://data.eastmoney.com/")
            .send()
            .await
            .map_err(|e| format!("PDF request: {}", e))?
            .bytes()
            .await
            .map_err(|e| format!("PDF body: {}", e))?;
        std::fs::write(path, &bytes).map_err(|e| format!("write PDF: {}", e))?;
        Ok(())
    }

    /// Full pipeline: fetch the PDF URL from the detail page, then download to disk.
    pub async fn download_report_pdf(
        &self,
        info_code: &str,
        category: &str,
        reports_dir: &std::path::Path,
    ) -> Result<String, String> {
        let pdf_url = self
            .fetch_pdf_url(info_code)
            .await
            .ok_or_else(|| format!("No PDF URL found for {}", info_code))?;
        let file_path = reports_dir.join(category).join(format!("{}.pdf", info_code));
        self.download_pdf(&pdf_url, &file_path).await?;
        Ok(file_path.to_string_lossy().to_string())
    }

    /// Download report PDF directly to a full destination path.
    pub async fn download_pdf_to(
        &self,
        info_code: &str,
        dest: &std::path::Path,
    ) -> Result<String, String> {
        let pdf_url = self
            .fetch_pdf_url(info_code)
            .await
            .ok_or_else(|| format!("No PDF URL found for {}", info_code))?;
        self.download_pdf(&pdf_url, dest).await?;
        Ok(dest.to_string_lossy().to_string())
    }
}

impl Clone for EastmoneyFetcher {
    fn clone(&self) -> Self {
        Self { client: self.client.clone() }
    }
}

/// Peel the jQuery(…) / callback wrapping from a JSONP response.
fn parse_jsonp(body: &str) -> Result<RawResponse, String> {
    let re = Regex::new(r#"(?s)^\w+\((.*)\)$"#).unwrap();
    let json_str = re
        .captures(body)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str())
        .ok_or_else(|| "JSONP not wrapped as expected".to_string())?;
    serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))
}

/// Helper: date range for "from install date" — roughly 6 months ago (used for stock/industry/macro).
pub fn six_months_ago() -> String {
    (chrono::Utc::now() - chrono::Duration::days(180))
        .format("%Y-%m-%d")
        .to_string()
}

pub fn today_str() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn parse_jsonp_handles_jquery_wrapper() {
        let body = r#"jQuery({"hits":3,"TotalPage":1,"data":[{"title":"Test","infoCode":"AP123"}]})"#;
        let r = parse_jsonp(body).expect("should parse");
        assert_eq!(r.data.len(), 1);
        assert_eq!(r.data[0].info_code.as_deref(), Some("AP123"));
    }

    #[test]
    fn parse_jsonp_handles_malformed() {
        assert!(parse_jsonp("not valid").is_err());
    }

    #[test]
    fn six_months_ago_is_valid_date() {
        let s = six_months_ago();
        assert!(NaiveDate::parse_from_str(&s, "%Y-%m-%d").is_ok());
    }
}
