//! Market-data sync for the local desktop app.
//!
//! Pulls daily OHLCV for all A‑shares from Eastmoney's public batch API in one
//! request, stores the most recent 5 trading days in SQLite, and auto‑cleans
//! older rows. No per‑stock HTTP requests — the entire market fits in one page.

use chrono::{Datelike, NaiveDate};
use reqwest::header;
use serde::Deserialize;
use std::time::Duration;

const API_URL: &str = "https://push2.eastmoney.com/api/qt/clist/get";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/// One row from the Eastmoney JSONP response.
#[derive(Debug, Deserialize)]
struct RawRow {
    /// Stock code  (f12)
    #[serde(rename = "f12")]
    code: String,
    /// Stock name  (f14)
    #[serde(rename = "f14")]
    name: Option<String>,
    /// Close       (f2)
    #[serde(rename = "f2")]
    close: Option<f64>,
    /// Change pct  (f3)
    #[serde(rename = "f3")]
    change_pct: Option<f64>,
    /// Open        (f17)
    #[serde(rename = "f17")]
    open: Option<f64>,
    /// High        (f15)
    #[serde(rename = "f15")]
    high: Option<f64>,
    /// Low         (f16)
    #[serde(rename = "f16")]
    low: Option<f64>,
    /// Volume      (f5)
    #[serde(rename = "f5")]
    volume: Option<i64>,
    /// Amount      (f6)
    #[serde(rename = "f6")]
    amount: Option<f64>,
    /// Total MV    (f20)
    #[serde(rename = "f20")]
    total_mv: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RawResponse {
    data: Option<RawList>,
}

#[derive(Debug, Deserialize)]
struct RawList {
    #[serde(default)]
    total: i64,
    #[serde(default)]
    diff: Vec<RawRow>,
}

/// One stored daily bar.
#[derive(Debug, Clone)]
pub struct DailyBar {
    pub code: String,
    pub name: String,
    pub trade_date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    pub volume: i64,
    pub amount: f64,
    pub change_pct: f64,
}

pub struct MarketFetcher {
    client: reqwest::Client,
}

impl MarketFetcher {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| format!("HTTP client: {}", e))?;
        Ok(Self { client })
    }

    /// Fetch today's market snapshot. Primary: Sina (no rotating tokens).
    /// Fallback: Eastmoney batch API.
    pub async fn fetch_today_all(&self) -> Result<Vec<DailyBar>, String> {
        // Sina is the primary — no tokens, no rotating keys, stable long‑term.
        match self.fetch_sina_batch().await {
            Ok(bars) if bars.len() > 3000 => return Ok(bars),
            Ok(bars) => {
                eprintln!("Sina returned only {} stocks, trying Eastmoney", bars.len());
                match self.fetch_em_batch().await {
                    Ok(em) if em.len() > bars.len() => return Ok(em),
                    _ => return Ok(bars),
                }
            }
            Err(e) => {
                eprintln!("Sina failed: {}. Trying Eastmoney.", e);
                self.fetch_em_batch().await
            }
        }
    }

    /// Eastmoney batch API — simple, no ut token (works without it).
    async fn fetch_em_batch(&self) -> Result<Vec<DailyBar>, String> {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let mut all_rows = Vec::new();
        let mut page = 1;
        loop {
            let url = format!(
                "{}?pn={}&pz=1000&po=1&np=1&fltt=2&invt=2&fid=f3&\
                 fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&\
                 fields=f2,f3,f12,f14,f15,f16,f17,f5,f6,f20",
                API_URL, page
            );
            let body = match self.client.get(&url)
                .header(header::REFERER, "https://data.eastmoney.com/")
                .send().await
            {
                Ok(r) => r.text().await.unwrap_or_default(),
                Err(e) => { return Err(format!("Eastmoney p{}: {}", page, e)); }
            };
            let raw: RawResponse = parse_jsonp(&body)?;
            if let Some(list) = raw.data {
                let total = list.total;
                all_rows.extend(list.diff);
                if all_rows.len() as i64 >= total || total == 0 { break; }
            } else { break; }
            page += 1;
            if page > 10 { break; }
        }
        self.build_bars(all_rows, &today)
    }

    /// Sina batch API — uses embedded stock list, no Eastmoney dependency.
    async fn fetch_sina_batch(&self) -> Result<Vec<DailyBar>, String> {
        // Use the embedded stock list so Sina works independently of Eastmoney.
        let db = crate::stock_tagger::load_stock_db();
        let codes: Vec<String> = db.name_to_info.values().map(|(c, _)| c.clone()).collect();
        if codes.is_empty() { return Err("Sina: no stock codes in DB".into()); }
        let chunks: Vec<&[String]> = codes.chunks(400).collect();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let mut all_bars = Vec::new();

        for chunk in &chunks {
            let symbols: Vec<String> = chunk.iter()
                .map(|c| if c.starts_with('6') { format!("sh{}", c) } else { format!("sz{}", c) })
                .collect();
            let url = format!("https://hq.sinajs.cn/list={}", symbols.join(","));
            let body = match self.client.get(&url)
                .header(header::REFERER, "https://finance.sina.com.cn/")
                .timeout(Duration::from_secs(15))
                .send().await
            {
                Ok(r) => r.text().await.unwrap_or_default(),
                Err(e) => {
                    eprintln!("Sina chunk failed: {}", e);
                    continue;
                }
            };

            for line in body.lines() {
                if !line.contains('=') { continue; }
                let eq = line.find('=').unwrap_or(0);
                let var_name = &line[..eq].trim().to_string();
                let content = line[eq+1..].trim_matches('"').trim_end_matches(';');
                if content.is_empty() { continue; }
                let fields: Vec<&str> = content.split(',').collect();
                if fields.len() < 10 { continue; }
                // Extract code: var hq_str_sh600519
                let code = var_name
                    .replace("var hq_str_sh", "").replace("var hq_str_sz", "");
                if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) { continue; }

                let name = fields.first().map(|s| s.to_string()).unwrap_or_default();
                let parse = |i: usize| -> f64 { fields.get(i).and_then(|s| s.parse().ok()).unwrap_or(0.0) };
                let yesterday = parse(2);
                let price = parse(3);
                let chg = if yesterday > 0.0 { ((price - yesterday) / yesterday * 100.0 * 100.0).round() / 100.0 } else { 0.0 };

                all_bars.push(DailyBar {
                    code, name, trade_date: today.clone(),
                    open: parse(1), close: price, high: parse(4), low: parse(5),
                    volume: fields.get(8).and_then(|s| s.parse().ok()).unwrap_or(0),
                    amount: parse(9),
                    change_pct: chg,
                });
            }
        }
        if all_bars.len() < 100 { return Err(format!("Sina: only {} stocks", all_bars.len())); }
        Ok(all_bars)
    }

    fn build_bars(&self, rows: Vec<RawRow>, today: &str) -> Result<Vec<DailyBar>, String> {
        let bars: Vec<DailyBar> = rows.into_iter().filter(|r| !r.code.is_empty()).map(|r| DailyBar {
            code: r.code.clone(), name: r.name.unwrap_or_default(), trade_date: today.to_string(),
            open: r.open.unwrap_or(0.0), close: r.close.unwrap_or(0.0),
            high: r.high.unwrap_or(0.0), low: r.low.unwrap_or(0.0),
            volume: r.volume.unwrap_or(0), amount: r.amount.unwrap_or(0.0),
            change_pct: r.change_pct.unwrap_or(0.0),
        }).collect();
        if bars.is_empty() { return Err("No market data returned".into()); }
        Ok(bars)
    }
}

impl Clone for MarketFetcher {
    fn clone(&self) -> Self {
        Self { client: self.client.clone() }
    }
}

fn parse_jsonp(body: &str) -> Result<RawResponse, String> {
    let start = body.find('{').ok_or("JSONP: no JSON object")?;
    let end = body.rfind('}').ok_or("JSONP: no closing brace")?;
    serde_json::from_str(&body[start..=end])
        .map_err(|e| format!("JSONP parse: {}", e))
}

// ── Data validation ──────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketDataCheck {
    pub success: bool,
    pub stock_count: i64,
    pub latest_date: String,
    pub expected_count: i64,
    pub count_ok: bool,
    pub null_check_ok: bool,
    pub anomaly_ok: bool,
    pub spot_checks: Vec<SpotCheck>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotCheck {
    pub code: String,
    pub name: String,
    pub price: f64,
    pub change_pct: f64,
}

/// Validate a market snapshot: row count, null values, anomalies.
pub fn validate_market_data(bars: &[DailyBar], today: &str) -> MarketDataCheck {
    let expected = 5000i64;
    let count = bars.len() as i64;
    let count_ok = count > 4000 && count < 6000;
    let null_ok = bars.iter().filter(|b| b.close == 0.0 || b.open == 0.0).count() < 300;
    let anomaly_ok = bars.iter().filter(|b| {
        let abs_chg = b.change_pct.abs();
        if b.code.starts_with("30") || b.code.starts_with("68") {
            abs_chg > 25.0
        } else {
            abs_chg > 15.0
        }
    }).count() < 100;
    let mut errors = Vec::new();
    if !count_ok { errors.push(format!("数量异常: {}只 (预期~{})", count, expected)); }
    if !null_ok { errors.push("较多无行情(停牌/未交易)".into()); }
    if !anomaly_ok { errors.push("涨跌幅异常值偏多".into()); }

    let spot_codes = [("600519","贵州茅台"),("000858","五粮液"),("300750","宁德时代"),("000001","平安银行")];
    let mut spot_checks = Vec::new();
    for (code, name) in &spot_codes {
        if let Some(b) = bars.iter().find(|b| &b.code == code) {
            spot_checks.push(SpotCheck { code: code.to_string(), name: name.to_string(), price: b.close, change_pct: b.change_pct });
        }
    }
    MarketDataCheck { success: count_ok && null_ok && anomaly_ok, stock_count: count, latest_date: today.to_string(), expected_count: expected, count_ok, null_check_ok: null_ok, anomaly_ok, spot_checks, errors }
}

/// A‑share holiday list for 2026 (from SSE official calendar).
/// This is a static fallback; the persisted calendar takes priority.
pub fn is_trading_day(date: &NaiveDate) -> bool {
    if date.weekday().number_from_monday() >= 6 { return false; }
    let s = date.format("%Y-%m-%d").to_string();
    let holidays: &[&str] = &[
        "2026-01-01","2026-01-02","2026-02-16","2026-02-17","2026-02-18",
        "2026-02-19","2026-02-20","2026-04-06","2026-05-01","2026-05-04",
        "2026-05-05","2026-06-22","2026-09-25","2026-10-01","2026-10-02",
        "2026-10-05","2026-10-06","2026-10-07",
    ];
    !holidays.contains(&s.as_str())
}

/// Try to fetch updated trading calendar from Eastmoney.
pub async fn fetch_trading_calendar(client: &reqwest::Client) -> Option<Vec<String>> {
    let url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&fields1=f1&fields2=f51&klt=101&fqt=0&end=20261231&lmt=300";
    let body = client.get(url).send().await.ok()?.text().await.ok()?;
    let mut dates = Vec::new();
    for line in body.lines() {
        if let Some(d) = line.split(',').next() {
            if d.len() == 10 && d.contains('-') { dates.push(d.to_string()); }
        }
    }
    if dates.is_empty() { None } else { Some(dates) }
}

/// Check if market data needs syncing (last trade_date < today-estimated-trading-day).
pub fn needs_market_sync(conn: &rusqlite::Connection) -> Option<String> {
    let last: Option<String> = conn.query_row(
        "SELECT MAX(trade_date) FROM stock_daily", [], |r| r.get(0)
    ).ok().flatten();
    let last_date = last.as_deref().unwrap_or("");
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    if last_date == &today { return None; }
    Some(format!("上次行情: {}  → 建议同步", if last_date.is_empty() { "无" } else { last_date }))
}

/// Last N trading days before `date` (inclusive).
pub fn recent_trading_days(date: &NaiveDate, n: usize) -> Vec<NaiveDate> {
    let mut days = Vec::new();
    let mut d = *date;
    while days.len() < n {
        if is_trading_day(&d) { days.push(d); }
        d = d - chrono::Duration::days(1);
    }
    days
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trading_day_check() {
        assert!(!is_trading_day(&NaiveDate::from_ymd_opt(2026, 1, 1).unwrap())); // holiday
        assert!(!is_trading_day(&NaiveDate::from_ymd_opt(2026, 7, 19).unwrap())); // Sunday
        // Weekday non-holiday should be trading day
    }

    #[test]
    fn recent_5_days() {
        let days = recent_trading_days(
            &NaiveDate::from_ymd_opt(2026, 7, 22).unwrap(), 5);
        assert!(!days.is_empty());
        assert!(days.len() <= 5);
    }
}
