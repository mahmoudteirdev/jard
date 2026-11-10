//! Natural Language Query Parser for local storage exploration.
//!
//! Converts free-form Arabic and English natural language prompts into structured
//! search filters ([`Query`]) with zero cloud calls and zero latency.

use serde::{Deserialize, Serialize};
use crate::kinds::{Kind, Query};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAiQuery {
    pub raw_prompt: String,
    pub recognized_intent: String,
    pub query: Query,
    pub target_folder: Option<String>,
    pub explanation_ar: String,
    pub explanation_en: String,
    pub limit: usize,
}

/// Normalizes Arabic text by unifying character variants and removing diacritics.
fn normalize_arabic(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            // Remove diacritics (tashkeel)
            '\u{064B}'..='\u{065F}' | '\u{0670}' => continue,
            // Unify alef variants
            'أ' | 'إ' | 'آ' | 'ٱ' => out.push('ا'),
            // Unify taa marbuta & haa
            'ة' => out.push('ه'),
            // Unify alif maqsura & yaa
            'ى' => out.push('ي'),
            // Unify Persian / Urdu kaf/gaf to Arabic kaf
            'ک' | 'گ' => out.push('ك'),
            // Unify Persian / Urdu yaa
            'ی' => out.push('ي'),
            _ => out.push(c.to_ascii_lowercase()),
        }
    }
    out
}

/// Parses an Arabic or English natural language prompt into a structured search query.
pub fn parse_natural_query(prompt: &str, now_unix: u64) -> ParsedAiQuery {
    let normalized = normalize_arabic(prompt);
    let words: Vec<&str> = normalized
        .split(|c: char| c.is_whitespace() || c == ',' || c == '،' || c == ':' || c == '"' || c == '\'')
        .filter(|w| !w.is_empty())
        .collect();

    let mut query = Query::default();
    let mut target_folder: Option<String> = None;
    let mut detected_kind: Option<Kind> = None;
    let mut min_size: u64 = 0;
    let mut older_than: Option<u64> = None;
    let mut empty_folders = false;
    let mut limit: usize = 50;
    let mut intent = "find_files".to_string();

    let mut kind_label_ar = String::new();
    let mut kind_label_en = String::new();
    let mut size_label_ar = String::new();
    let mut size_label_en = String::new();
    let mut age_label_ar = String::new();
    let mut age_label_en = String::new();
    let mut scope_label_ar = String::new();
    let mut scope_label_en = String::new();

    let full_text = normalized.as_str();

    // 1. Detect Empty Folders
    if full_text.contains("فارغ") || full_text.contains("فاضي") || full_text.contains("empty") {
        empty_folders = true;
        intent = "find_empty_folders".to_string();
    }

    // 2. Detect Kind
    if full_text.contains("فيديو") || full_text.contains("فيديوهات") || full_text.contains("مقطع") 
        || full_text.contains("مقاطع") || full_text.contains("مسلسل") || full_text.contains("فيلم") 
        || full_text.contains("افلام") || full_text.contains("video") || full_text.contains("movie") 
        || full_text.contains("clip") {
        detected_kind = Some(Kind::Video);
        kind_label_ar = "مقاطع الفيديو".to_string();
        kind_label_en = "videos".to_string();
    } else if full_text.contains("صور") || full_text.contains("صوره") || full_text.contains("لقط") 
        || full_text.contains("سكرين") || full_text.contains("خلفي") || full_text.contains("image") 
        || full_text.contains("photo") || full_text.contains("picture") || full_text.contains("screenshot") {
        detected_kind = Some(Kind::Image);
        kind_label_ar = "الصور".to_string();
        kind_label_en = "images".to_string();
    } else if full_text.contains("صوت") || full_text.contains("موسيقى") || full_text.contains("اغاني") 
        || full_text.contains("اغنيه") || full_text.contains("audio") || full_text.contains("music") 
        || full_text.contains("song") {
        detected_kind = Some(Kind::Audio);
        kind_label_ar = "الملفات الصوتية".to_string();
        kind_label_en = "audio files".to_string();
    } else if full_text.contains("مستند") || full_text.contains("بي دي اف") || full_text.contains("pdf") 
        || full_text.contains("وورد") || full_text.contains("اكسل") || full_text.contains("doc") 
        || full_text.contains("sheet") || full_text.contains("كتاب") || full_text.contains("كتب") {
        detected_kind = Some(Kind::Document);
        kind_label_ar = "المستندات".to_string();
        kind_label_en = "documents".to_string();
    } else if full_text.contains("ارشيف") || full_text.contains("مضغوط") || full_text.contains("zip") 
        || full_text.contains("rar") || full_text.contains("7z") || full_text.contains("tar") 
        || full_text.contains("archive") || full_text.contains("compressed") {
        detected_kind = Some(Kind::Archive);
        kind_label_ar = "الملفات المضغوطة".to_string();
        kind_label_en = "archives".to_string();
    } else if full_text.contains("ايزو") || full_text.contains("iso") || full_text.contains("وهمي") {
        detected_kind = Some(Kind::DiskImage);
        kind_label_ar = "صور الأقراص (ISO)".to_string();
        kind_label_en = "disk images (ISO)".to_string();
    } else if full_text.contains("برنامج") || full_text.contains("برامج") || full_text.contains("مثبت") 
        || full_text.contains("تطبيق") || full_text.contains("تنصيب") || full_text.contains("installer") 
        || full_text.contains("setup") || full_text.contains("exe") || full_text.contains("apk") 
        || full_text.contains("app") {
        detected_kind = Some(Kind::Installer);
        kind_label_ar = "البرامج والمثبتات".to_string();
        kind_label_en = "installers & apps".to_string();
    }

    // 3. Extract Scope / Target folder
    if full_text.contains("تنزيل") || full_text.contains("داونلود") || full_text.contains("download") {
        target_folder = Some("Downloads".to_string());
        scope_label_ar = "في مجلد التنزيلات".to_string();
        scope_label_en = "in Downloads".to_string();
    } else if full_text.contains("سطح المكتب") || full_text.contains("دسك توب") || full_text.contains("desktop") {
        target_folder = Some("Desktop".to_string());
        scope_label_ar = "على سطح المكتب".to_string();
        scope_label_en = "on Desktop".to_string();
    } else if full_text.contains("في السي") || full_text.contains("قرص c") || full_text.contains("c drive") || full_text.contains("c:") {
        target_folder = Some("C:\\".to_string());
        scope_label_ar = "في القرص C".to_string();
        scope_label_en = "in Drive C".to_string();
    } else if full_text.contains("في الدي") || full_text.contains("قرص d") || full_text.contains("d drive") || full_text.contains("d:") {
        target_folder = Some("D:\\".to_string());
        scope_label_ar = "في القرص D".to_string();
        scope_label_en = "in Drive D".to_string();
    }

    // 4. Extract Size constraints
    let has_size_keyword = full_text.contains("اكبر") || full_text.contains("اكثر") 
        || full_text.contains("فوق") || full_text.contains("حجم") || full_text.contains("ضخم") 
        || full_text.contains("كبير") || full_text.contains("larger") || full_text.contains("greater") 
        || full_text.contains("more than") || full_text.contains("over") || full_text.contains("big") 
        || full_text.contains("huge") || full_text.contains("size");

    // Scan for number + unit
    for i in 0..words.len() {
        let w = words[i];
        
        // Handle standalone compound words like "1gb", "500mb", "2gb"
        if let Some((num_str, unit)) = split_num_and_unit(w) {
            if let Ok(num) = num_str.parse::<f64>() {
                if unit == "gb" || unit == "g" || unit.contains("جيجا") || unit.contains("غيغا") {
                    min_size = (num * 1024.0 * 1024.0 * 1024.0) as u64;
                    size_label_ar = format!("أكبر من {} جيجابايت", num);
                    size_label_en = format!("larger than {} GB", num);
                    break;
                } else if unit == "mb" || unit == "m" || unit.contains("ميجا") || unit.contains("ميغا") {
                    min_size = (num * 1024.0 * 1024.0) as u64;
                    size_label_ar = format!("أكبر من {} ميجابايت", num);
                    size_label_en = format!("larger than {} MB", num);
                    break;
                }
            }
        }

        // Handle adjacent word pairs: e.g. "500" "ميجا" or "2" "gb"
        if let Ok(num) = w.parse::<f64>() {
            if i + 1 < words.len() {
                let next = words[i + 1];
                if next.contains("جيجا") || next.contains("غيغا") || next == "gb" || next == "g" || next == "gig" || next == "gigs" {
                    min_size = (num * 1024.0 * 1024.0 * 1024.0) as u64;
                    size_label_ar = format!("أكبر من {} جيجابايت", num);
                    size_label_en = format!("larger than {} GB", num);
                    break;
                } else if next.contains("ميجا") || next.contains("ميغا") || next == "mb" || next == "m" || next == "meg" || next == "megs" {
                    min_size = (num * 1024.0 * 1024.0) as u64;
                    size_label_ar = format!("أكبر من {} ميجابايت", num);
                    size_label_en = format!("larger than {} MB", num);
                    break;
                }
            }
        }
    }

    // Handle generic word concepts if no explicit number was matched
    if min_size == 0 {
        if full_text.contains("نص جيجا") || full_text.contains("نصف جيجا") || full_text.contains("half gig") {
            min_size = 512 * 1024 * 1024;
            size_label_ar = "أكبر من 500 ميجابايت".to_string();
            size_label_en = "larger than 500 MB".to_string();
        } else if full_text.contains("جيجا") || full_text.contains("غيغا") || full_text.contains("1gb") || full_text.contains("1 gb") {
            min_size = 1024 * 1024 * 1024;
            size_label_ar = "أكبر من 1 جيجابايت".to_string();
            size_label_en = "larger than 1 GB".to_string();
        } else if has_size_keyword {
            // General "huge / large" query defaults to 100 MB threshold
            min_size = 100 * 1024 * 1024;
            size_label_ar = "الملفات الكبيرة (> 100 MB)".to_string();
            size_label_en = "large files (> 100 MB)".to_string();
        }
    }

    // 5. Extract Age / Staleness constraints
    let has_age_keyword = full_text.contains("اقدم") || full_text.contains("قديم") 
        || full_text.contains("مهجور") || full_text.contains("متروك") || full_text.contains("ما فتحت") 
        || full_text.contains("ما لمست") || full_text.contains("قبل") || full_text.contains("older") 
        || full_text.contains("stale") || full_text.contains("abandoned") || full_text.contains("old") 
        || full_text.contains("unused");

    let mut age_seconds: Option<u64> = None;

    if full_text.contains("سنتين") || full_text.contains("2 years") {
        age_seconds = Some(2 * 365 * 86400);
        age_label_ar = "أقدم من سنتين".to_string();
        age_label_en = "older than 2 years".to_string();
    } else if full_text.contains("سنه") || full_text.contains("عام") || full_text.contains("1 year") || full_text.contains("year") {
        age_seconds = Some(365 * 86400);
        age_label_ar = "أقدم من سنة".to_string();
        age_label_en = "older than 1 year".to_string();
    } else if full_text.contains("6 شهور") || full_text.contains("نص سنه") || full_text.contains("6 months") {
        age_seconds = Some(180 * 86400);
        age_label_ar = "أقدم من 6 أشهر".to_string();
        age_label_en = "older than 6 months".to_string();
    } else if full_text.contains("شهرين") || full_text.contains("2 months") {
        age_seconds = Some(60 * 86400);
        age_label_ar = "أقدم من شهرين".to_string();
        age_label_en = "older than 2 months".to_string();
    } else if full_text.contains("شهر") || full_text.contains("1 month") || full_text.contains("30 يوم") || full_text.contains("30 days") {
        age_seconds = Some(30 * 86400);
        age_label_ar = "أقدم من 30 يوماً".to_string();
        age_label_en = "older than 30 days".to_string();
    } else if full_text.contains("اسبوعين") || full_text.contains("2 weeks") {
        age_seconds = Some(14 * 86400);
        age_label_ar = "أقدم من أسبوعين".to_string();
        age_label_en = "older than 2 weeks".to_string();
    } else if full_text.contains("اسبوع") || full_text.contains("week") {
        age_seconds = Some(7 * 86400);
        age_label_ar = "أقدم من أسبوع".to_string();
        age_label_en = "older than 1 week".to_string();
    } else if has_age_keyword {
        // Default stale threshold is 90 days
        age_seconds = Some(90 * 86400);
        age_label_ar = "المتروكة منذ 90 يوماً فما فوق".to_string();
        age_label_en = "stale for 90+ days".to_string();
    }

    if let Some(sec) = age_seconds {
        older_than = Some(now_unix.saturating_sub(sec));
    }

    // 6. Detect Limit (e.g. "أكبر 10", "top 20")
    for i in 0..words.len() {
        if (words[i] == "top" || words[i] == "اول" || words[i] == "اكبر") && i + 1 < words.len() {
            if let Ok(n) = words[i + 1].parse::<usize>() {
                if n > 0 && n <= 500 {
                    limit = n;
                }
            }
        }
    }

    // 7. Compose Natural Explanations
    let mut parts_ar: Vec<String> = Vec::new();
    let mut parts_en: Vec<String> = Vec::new();

    if empty_folders {
        parts_ar.push("المجلدات الفارغة".to_string());
        parts_en.push("Empty folders".to_string());
    } else {
        if !kind_label_ar.is_empty() {
            parts_ar.push(kind_label_ar);
            parts_en.push(kind_label_en);
        } else {
            parts_ar.push("الملفات".to_string());
            parts_en.push("Files".to_string());
        }

        if !size_label_ar.is_empty() {
            parts_ar.push(size_label_ar);
            parts_en.push(size_label_en);
        }

        if !age_label_ar.is_empty() {
            parts_ar.push(age_label_ar);
            parts_en.push(age_label_en);
        }
    }

    if !scope_label_ar.is_empty() {
        parts_ar.push(scope_label_ar);
        parts_en.push(scope_label_en);
    }

    let explanation_ar = parts_ar.join(" · ");
    let explanation_en = parts_en.join(" · ");

    query.kind = detected_kind;
    query.min_size = min_size;
    query.older_than = older_than;
    query.empty_folders = empty_folders;

    ParsedAiQuery {
        raw_prompt: prompt.to_string(),
        recognized_intent: intent,
        query,
        target_folder,
        explanation_ar,
        explanation_en,
        limit,
    }
}

fn split_num_and_unit(token: &str) -> Option<(&str, &str)> {
    let first_alpha = token.find(|c: char| c.is_alphabetic() || c >= '\u{0600}')?;
    if first_alpha == 0 {
        return None;
    }
    let (num_part, unit_part) = token.split_at(first_alpha);
    Some((num_part, unit_part))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_arabic_video_query() {
        let now = 1700000000;
        let res = parse_natural_query("الفيديوهات الأكبر من 500 ميغا في التنزيلات", now);
        assert_eq!(res.query.kind, Some(Kind::Video));
        assert_eq!(res.query.min_size, 500 * 1024 * 1024);
        assert_eq!(res.target_folder.as_deref(), Some("Downloads"));
        assert!(res.explanation_ar.contains("مقاطع الفيديو"));
        assert!(res.explanation_ar.contains("500 ميجابايت"));
    }

    #[test]
    fn parses_stale_documents() {
        let now = 1700000000;
        let res = parse_natural_query("المستندات القديمة المهجورة من 6 شهور", now);
        assert_eq!(res.query.kind, Some(Kind::Document));
        assert_eq!(res.query.older_than, Some(now - 180 * 86400));
        assert!(res.explanation_ar.contains("المستندات"));
        assert!(res.explanation_ar.contains("6 أشهر"));
    }

    #[test]
    fn parses_english_queries() {
        let now = 1700000000;
        let res = parse_natural_query("videos larger than 1gb in downloads", now);
        assert_eq!(res.query.kind, Some(Kind::Video));
        assert_eq!(res.query.min_size, 1024 * 1024 * 1024);
        assert_eq!(res.target_folder.as_deref(), Some("Downloads"));
        assert!(res.explanation_en.contains("videos"));
        assert!(res.explanation_en.contains("1 GB"));
    }

    #[test]
    fn parses_empty_folders() {
        let res = parse_natural_query("المجلدات الفارغة في سطح المكتب", 1700000000);
        assert!(res.query.empty_folders);
        assert_eq!(res.target_folder.as_deref(), Some("Desktop"));
        assert_eq!(res.recognized_intent, "find_empty_folders");
    }
}
