//! A‑share stock tagger — ported from paomiji.com's Knowledge‑Planet collector.
//!
//! Rules (mirror `/home/zsz/zsxq-poster/stock_db.py`):
//! 1. Scan article text for company **full names** (from `stock_company_info`).
//! 2. Generate a **short label** per company via `auto_short_name()`:
//!    - Manual overrides take priority (e.g. "宁德时代" → "宁德").
//!    - 4‑char names keep all 4 chars (e.g. "博众精工").
//!    - 5+ char names: truncate known suffixes, then take first 3 chars.
//! 3. Scan for **short labels** independently (reverse match).
//! 4. Filter common words, institution keywords, broker‑prefix mentions.
//! 5. Attach matched stocks as WordPress‑style tags (stock_code + short_name).

use std::collections::{HashMap, HashSet};

// ── Config ─────────────────────────────────────────────────────────────
const MAX_STOCK_NAME_LEN: usize = 5;

// ── Embedded stock data (exported from paomiji.com `stock_company_info`) ──
static STOCK_TSV: &str = include_str!("../assets/a_stocks.tsv");

// ── Hand‑curated short‑name overrides ──────────────────────────────────
fn manual_short_names() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("宁德时代","宁德"),("腾讯控股","腾讯"),("阿里巴巴-W","阿里"),("美团-W","美团"),
        ("小米集团-W","小米"),("网易-S","网易"),("京东集团-SW","京东"),("百度集团-SW","百度"),
        ("快手-W","快手"),("哔哩哔哩-W","B站"),("中国移动","移动"),("中国海洋石油","中海油"),
        ("中国银行","中行"),("工商银行","工行"),("建设银行","建行"),("香港交易所","港交所"),
        ("友邦保险","友邦"),("汇丰控股","汇丰"),("比亚迪股份","比亚迪"),("中芯国际","中芯"),
        ("理想汽车-W","理想"),("蔚来-SW","蔚来"),("小鹏汽车-W","小鹏"),("华虹半导体","华虹"),
        ("联想集团","联想"),("舜宇光学科技","舜宇"),("瑞声科技","瑞声"),("药明生物","药明"),
        ("百济神州","百济"),("苹果","苹果"),("微软","微软"),("谷歌","谷歌"),("亚马逊","亚马逊"),
        ("英伟达","英伟达"),("特斯拉","特斯拉"),("Meta","Meta"),("台积电","台积电"),
        ("比亚迪","比亚迪"),("贵州茅台","茅台"),("中际旭创","旭创"),("海光信息","海光"),
        ("中芯国际","中芯"),("中国平安","平安"),("招商银行","招行"),("万华化学","万华"),
        ("隆基绿能","隆基"),("阳光电源","阳光"),("三一重工","三一"),("中航沈飞","沈飞"),
        ("中航光电","中航"),("昆仑万维","昆仑"),("寒武纪","寒武"),("药明康德","药明"),
        ("恒瑞医药","恒瑞"),("迈瑞医疗","迈瑞"),("片仔癀","片仔癀"),("罗博特科","罗博特"),
        ("凯格精机","凯格精"),("博众精工","博众精工"),("快克智能","快克智"),("科瑞技术","科瑞技"),
        ("晶盛机电","晶盛机"),("华海清科","华海清"),("长川科技","长川"),("天通股份","天通"),
        ("联讯仪器","联讯仪"),("西子洁能","西子洁"),("先导智能","先导智能"),
        ("天华新能","天华新能"),("天齐锂业","天齐锂业"),("富临精工","富临精工"),
        ("国联民生","国联民生"),("天孚通信","天孚"),("光迅科技","光迅"),("剑桥科技","剑桥"),
        ("华懋科技","华懋"),("华工科技","华工"),("东山精密","东山"),("连城数控","连城"),
        ("高测股份","高测"),("捷佳伟创","捷佳"),("帝尔激光","帝尔"),("晶科科技","晶科"),
        ("聚和材料","聚和"),("迈为股份","迈为"),("韦尔股份","韦尔"),("万科A","万科"),
        ("五粮液","五粮"),("长电科技","长电"),("华天科技","华天"),("通富微电","通富"),
        ("北方华创","北方"),("中微公司","中微"),("沪硅产业","沪硅"),("澜起科技","澜起"),
        ("兆易创新","兆易"),("卓胜微","卓胜"),("闻泰科技","闻泰"),("三���光电","三安"),
        ("科大讯飞","讯飞"),("中兴通讯","中兴"),("工业富联","富联"),("海康威视","海康"),
        ("长城汽车","长城"),("上汽集团","上汽"),("福耀玻璃","福耀"),("美的集团","美的"),
        ("格力电器","格力"),("海尔智家","海尔"),("长春高新","长春"),("智飞生物","智飞"),
        ("云南白药","白药"),("兴业银行","兴业"),("平安银行","平安"),("宁波银行","宁波"),
        ("中信证券","中信"),("华泰证券","华泰"),("东方财富","东财"),("中国太保","太保"),
        ("保利发展","保利"),("中国建筑","中建"),("中国中铁","中铁"),("中国交建","中交"),
        ("中国电信","电信"),("中国联通","联通"),("宝钢股份","宝钢"),("海螺水泥","海螺"),
        ("中国中免","中免"),("紫金矿业","紫金"),("江西铜业","江铜"),("山东黄金","山金"),
        ("中金黄金","中金"),("洛阳钼业","洛钼"),("泸州老窖","老窖"),("山西汾酒","汾酒"),
        ("洋河股份","洋河"),("伊利股份","伊利"),("海天味业","海天"),("金龙鱼","金龙鱼"),
        ("亨通光电","亨通"),("中天科技","中天"),("长飞光纤","长飞"),("永鼎股份","永鼎"),
        ("烽火通信","烽火"),("福晶科技","福晶"),("炬光科技","炬光"),("光库科技","光库"),
        ("联特科技","联特"),("德科立","德科立"),("腾景科技","腾景"),("太辰光","太辰光"),
        ("博创科技","博创"),("苹果光","苹果光"),("仕佳光子","仕佳"),("汇绿生态","汇绿"),
        ("世嘉科技","世嘉"),("博通","博通"),
    ])
}

fn truncate_suffixes() -> &'static [&'static str] {
    &["股份有限公司","股份有限公司","集团股份","有限公司","股份有限公司","实业股份",
      "科技股份","集团","股份","科技","光电","新材","材料","装备","实业","电子","机械",
      "医药","医疗","化工","能源","电力","电缆","液压","智控","智联","微透","激光",
      "电气","仪器","航运","港口","旅游","食品","农业","矿业","环保"]
}

fn common_words() -> HashSet<&'static str> {
    HashSet::from(["中国","不同","推荐","看好","观点","关注","机会","建议","行业","我们",
        "认为","公司","今日","本周","强势","涨停","下跌","市场","行情","动态","快讯",
        "研报","报告","深度","点评","要闻","简报","日报","周报","月报","mi","通用",
        "石化","太阳","新华","生物","同为","超越","稳健","智慧","中泰","招商","创业",
        "科创","第一","国投","龙头","机器人","衍生","时代","创新","标准","高铁","西部",
        "航天","光电","完美","理想汽","开发","联合","新锐","统一","中原","电信","东风",
        "中国有","中国黄","三星","东方","建设","江南","移动","阳光","上海","云南","宁波",
        "昆仑","浙江","深圳","中天","中信","中金","国际","国泰","国泰海通"])
}

fn institution_keywords() -> &'static [&'static str] {
    &["证券","研究所","团队","券商","投行","基金","银行","保险","资产管理","投资"]
}

// ── Stock DB ────────────────────────────────────────────────────────────
pub struct StockDb {
    /// full_name (normalized) → (code, short_label)
    pub name_to_info: HashMap<String, (String, String)>,
    /// All known full names.
    pub all_names: Vec<String>,
    /// short_label → full_name
    pub short_to_full: HashMap<String, String>,
}

/// Lazy‑load the stock DB from the embedded TSV + generation rules.
pub fn load_stock_db() -> StockDb {
    let manual = manual_short_names();
    let common = common_words();
    let suffixes = truncate_suffixes();

    let mut name_to_code: HashMap<String, String> = HashMap::new();
    let mut all_names: Vec<String> = Vec::new();
    // Also build: short_company_name → (code, full_name)  for matching
    let mut short_name_to_code: HashMap<String, (String, String)> = HashMap::new();

    for line in STOCK_TSV.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 { continue; }
        let code = parts[0].trim().to_string();
        let full = parts[1].trim().to_string();
        if full.is_empty() { continue; }
        let norm = full.to_lowercase();
        if !name_to_code.contains_key(&norm) {
            name_to_code.insert(norm.clone(), code.clone());
            all_names.push(full.clone());
            // Generate a "short company name" by stripping legal suffixes
            let mut short_cn = full.clone();
            for sfx in suffixes.iter() {
                if short_cn.ends_with(sfx) { short_cn = short_cn[..short_cn.len()-sfx.len()].to_string(); break; }
            }
            if !short_cn.is_empty() && short_cn != full {
                let norm_sc = short_cn.to_lowercase();
                short_name_to_code.entry(norm_sc).or_insert_with(|| (code.clone(), full.clone()));
            }
        }
    }

    let auto_short = |full: &str| -> String {
        if let Some(s) = manual.get(full) { return s.to_string(); }
        let mut sc = full.to_string();
        for sfx in suffixes.iter() {
            if sc.ends_with(sfx) { sc = sc[..sc.len()-sfx.len()].to_string(); break; }
        }
        if let Some(s) = manual.get(sc.as_str()) { return s.to_string(); }
        // Also check if any manual key is a prefix (longest first)
        let mut manual_keys: Vec<(&str, &str)> = manual.iter().map(|(k,v)| (*k, *v)).collect();
        manual_keys.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        for (k, v) in manual_keys.iter() {
            if k.len() >= 3 && sc.starts_with(k) { return v.to_string(); }
        }
        let c: Vec<char> = sc.chars().collect();
        if c.len() >= 3 { c[..3].iter().collect() } else { c[..2.min(c.len())].iter().collect() }
    };

    let mut name_to_info: HashMap<String, (String, String)> = HashMap::new();
    let mut short_to_full: HashMap<String, String> = HashMap::new();

    for (norm, code) in &name_to_code {
        let orig = all_names.iter().find(|n| n.to_lowercase() == *norm).cloned().unwrap_or(norm.clone());
        let short = auto_short(&orig);
        if short.chars().count() <= MAX_STOCK_NAME_LEN && !common.contains(short.as_str()) {
            name_to_info.insert(orig.clone(), (code.clone(), short.clone()));
            short_to_full.insert(short.clone(), orig.clone());
        }
    }

    StockDb { name_to_info, all_names, short_to_full }
}

// ── Text matching ───────────────────────────────────────────────────────
pub fn find_stocks_in_text(text: &str, db: &StockDb) -> Vec<(String, String, String)> {
    let mut found: HashMap<String, (String, String)> = HashMap::new();

    // Build character index from article text — only scan stocks whose first
    // character appears in the text. Reduces ~5188 to ~200-500 candidates.
    let text_chars: HashSet<char> = text.chars().collect();
    let candidates: Vec<&String> = db.all_names.iter().filter(|n| {
        n.chars().next().map(|c| text_chars.contains(&c)).unwrap_or(false)
    }).collect();

    // 0) Match bare 6‑digit stock codes
    let code_to_name: HashMap<&str, &str> = db.name_to_info.iter()
        .map(|(name, (code, _))| (code.as_str(), name.as_str())).collect();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i + 6 <= chars.len() {
        if chars[i..i+6].iter().all(|c| c.is_ascii_digit()) {
            let before = i == 0 || !chars[i-1].is_ascii_digit();
            let after = i+6 >= chars.len() || !chars[i+6].is_ascii_digit();
            if before && after {
                let code: String = chars[i..i+6].iter().collect();
                if let Some(&full) = code_to_name.get(code.as_str()) {
                    if let Some((c, short)) = db.name_to_info.get(full) {
                        found.entry(full.to_string()).or_insert((c.clone(), short.clone()));
                    }
                }
                i += 6; continue;
            }
        }
        i += 1;
    }

    // 1) Full‑text scan: match company full names (only first-char candidates)
    for name in &candidates {
        if name.chars().count() < 2 || name.chars().count() > MAX_STOCK_NAME_LEN + 2 { continue; }
        if text.contains(name.as_str()) {
            if let Some((code, short)) = db.name_to_info.get(name.as_str()) {
                found.insert(name.to_string(), (code.clone(), short.clone()));
            }
        }
    }

    // 2) Short‑label reverse scan
    for (short, full) in &db.short_to_full {
        if short.chars().count() < 2 || common_words().contains(short.as_str()) { continue; }
        if let Some(pos) = text.find(short.as_str()) {
            let mut overlapped = false;
            for matched in found.keys() {
                if let Some(mpos) = text.find(matched.as_str()) {
                    if mpos <= pos && pos < mpos + matched.len() { overlapped = true; break; }
                }
            }
            if !overlapped {
                if let Some((code, _)) = db.name_to_info.get(full.as_str()) {
                    found.insert(full.clone(), (code.clone(), short.clone()));
                }
            }
        }
    }

    // 3) 4‑char stocks: auto‑shorten first 2 chars (only first-char candidates)
    for name in &candidates {
        if name.chars().count() == 4 && !found.contains_key(name.as_str()) {
            let chars: Vec<char> = name.chars().collect();
            let suffix: String = chars[2..].iter().collect();
            if truncate_suffixes().contains(&suffix.as_str()) {
                let short2: String = chars[..2].iter().collect();
                if short2.chars().count() >= 2 && !common_words().contains(short2.as_str()) {
                    if let Some(_) = text.find(&short2) {
                        if let Some((code, _)) = db.name_to_info.get(name.as_str()) {
                            found.insert(name.to_string(), (code.clone(), short2));
                        }
                    }
                }
            }
        }
    }

    found.into_iter().map(|(full, (code, short))| (code, short, full)).collect()
}

// ── Boundary helper (used by db tag_article_with_stocks) ─────────────────
pub fn is_text_boundary(text: &str, pos: usize, len: usize) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let end = pos + len;
    let before = pos == 0 || is_separator(chars[pos - 1]);
    let after = end >= chars.len() || is_separator(chars[end]);
    before && after
}

fn is_separator(ch: char) -> bool {
    matches!(ch,
        '\u{0020}'..='\u{002F}' | '\u{003A}'..='\u{0040}' | '\u{005B}'..='\u{0060}'
        | '\u{007B}'..='\u{007E}' | '\u{2018}'..='\u{201D}' | '\u{2026}'..='\u{2027}'
        | '\u{3000}'..='\u{3002}' | '\u{3008}'..='\u{3011}' | '\u{3014}'..='\u{301B}'
        | '\u{FF01}'..='\u{FF0F}' | '\u{FF1A}'..='\u{FF20}' | '\u{FF3B}'..='\u{FF40}'
        | '\u{FF5B}'..='\u{FF5E}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stock_db_loads() {
        let db = load_stock_db();
        assert!(db.all_names.len() > 4000);
        assert!(db.name_to_info.contains_key("平安银行股份有限公司"));
    }

    #[test]
    fn manual_short_overrides() {
        let db = load_stock_db();
        let (_, short) = db.name_to_info.get("宁德时代新能源科技股份有限公司").unwrap();
        assert_eq!(short, "宁德");
    }

    #[test]
    fn tags_byd() {
        let db = load_stock_db();
        let result = find_stocks_in_text("比亚迪汽车发布公告", &db);
        assert!(result.iter().any(|(c, _, _)| c == "002594"));
    }

    #[test]
    fn tags_code() {
        let db = load_stock_db();
        let result = find_stocks_in_text("600519今日大涨", &db);
        assert!(result.iter().any(|(c, _, _)| c == "600519"));
    }
}
