//! Predictive Storage Depletion Engine.
//!
//! Analyzes historical storage snapshots using time-series regression and anomaly
//! filtering to forecast when storage capacity will reach critical thresholds.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub timestamp: u64,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DepletionStatus {
    Stable,
    GradualBurn,
    CriticalBurn,
    FreeingSpace,
    InsufficientData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepletionForecast {
    pub current_free_bytes: u64,
    pub current_total_bytes: u64,
    pub daily_burn_bytes: i64,
    pub estimated_days_remaining: Option<u32>,
    pub exhaustion_date_iso: Option<String>,
    pub status: DepletionStatus,
    pub recommendation_ar: String,
    pub recommendation_en: String,
    pub confidence_score: f32,
    pub burn_velocity_mb_per_day: f64,
}

/// Converts a Unix timestamp in seconds to a "YYYY-MM-DD" ISO date string.
pub fn unix_to_iso_date(ts: u64) -> String {
    let days = (ts / 86400) as i64;
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1024 + doe / 1461 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Forecasts storage depletion trajectory based on historical snapshots.
pub fn predict_depletion(
    snapshots: &[StorageSnapshot],
    current_free: u64,
    current_total: u64,
    now_unix: u64,
) -> DepletionForecast {
    let free_ratio = if current_total > 0 {
        current_free as f64 / current_total as f64
    } else {
        1.0
    };

    // If fewer than 2 snapshots, provide an initial baseline assessment
    if snapshots.len() < 2 {
        let (status, rec_ar, rec_en, days) = if free_ratio < 0.05 {
            (
                DepletionStatus::CriticalBurn,
                "المساحة الحرة أقل من 5%! يُنصح بتنظيف الملفات فوراً لتجنب توقف النظام.".to_string(),
                "Free space is under 5%! Immediate cleanup recommended to avoid system degradation.".to_string(),
                Some(3),
            )
        } else if free_ratio < 0.15 {
            (
                DepletionStatus::GradualBurn,
                "المساحة الحرة تقترب من الحد الأدنى (أقل من 15%). يُفضل تفريغ سلة المحذوفات ومخلفات المشاريع.".to_string(),
                "Free space is low (under 15%). Consider emptying trash and developer bloat.".to_string(),
                Some(45),
            )
        } else {
            (
                DepletionStatus::Stable,
                "المساحة الحرة وفيرة ومستقرة. يجري جمع بيانات الفحص اليومية لتوليد توقعات دقيقة.".to_string(),
                "Storage is healthy and stable. Collecting historical snapshots for precise trend forecasting.".to_string(),
                None,
            )
        };

        let exhaustion_date = days.map(|d| unix_to_iso_date(now_unix + (d as u64) * 86400));

        return DepletionForecast {
            current_free_bytes: current_free,
            current_total_bytes: current_total,
            daily_burn_bytes: 0,
            estimated_days_remaining: days,
            exhaustion_date_iso: exhaustion_date,
            status,
            recommendation_ar: rec_ar,
            recommendation_en: rec_en,
            confidence_score: 0.35,
            burn_velocity_mb_per_day: 0.0,
        };
    }

    // Sort snapshots chronologically
    let mut sorted = snapshots.to_vec();
    sorted.sort_by_key(|s| s.timestamp);

    let first = &sorted[0];
    let last = &sorted[sorted.len() - 1];

    let time_span_seconds = last.timestamp.saturating_sub(first.timestamp).max(1);
    let time_span_days = (time_span_seconds as f64) / 86400.0;

    // Detect anomalies / single massive spikes
    let mut valid_deltas: Vec<f64> = Vec::new();
    for window in sorted.windows(2) {
        let dt = (window[1].timestamp.saturating_sub(window[0].timestamp) as f64) / 86400.0;
        if dt > 0.01 {
            let df = (window[0].free_bytes as f64) - (window[1].free_bytes as f64);
            let rate = df / dt;
            // Filter extreme single-day spikes > 30% total disk as transient
            let max_nominal_jump = (current_total as f64) * 0.30;
            if df.abs() < max_nominal_jump {
                valid_deltas.push(rate);
            }
        }
    }

    let daily_burn_f64: f64 = if !valid_deltas.is_empty() {
        valid_deltas.iter().sum::<f64>() / (valid_deltas.len() as f64)
    } else {
        ((first.free_bytes as f64) - (last.free_bytes as f64)) / time_span_days.max(0.1)
    };

    let daily_burn_bytes = daily_burn_f64 as i64;
    let velocity_mb = daily_burn_f64 / (1024.0 * 1024.0);

    // Reserve 5% buffer for critical OS operations
    let reserve_buffer = ((current_total as f64) * 0.05) as u64;
    let usable_free = current_free.saturating_sub(reserve_buffer);

    let threshold_burn_mb = 50.0; // 50 MB / day is considered normal baseline

    let (status, days, rec_ar, rec_en) = if daily_burn_f64 < -threshold_burn_mb * 1024.0 * 1024.0 {
        // Space is increasing (freeing up space)
        (
            DepletionStatus::FreeingSpace,
            None,
            format!("مساحتك الحرة تتزايد بمعدل (+{:.1} MB يومياً) نتيجة حذف الملفات وتنظيف الجهاز.", velocity_mb.abs()),
            format!("Free space is expanding by (+{:.1} MB/day) from recent deletions and cleanup.", velocity_mb.abs()),
        )
    } else if daily_burn_f64 < threshold_burn_mb * 1024.0 * 1024.0 {
        // Stable
        (
            DepletionStatus::Stable,
            None,
            "استهلاكك للمساحة مستقر ومنتظم، لا يوجد خطر نفاد في المدى القريب.".to_string(),
            "Storage consumption is stable. No exhaustion risk in the near future.".to_string(),
        )
    } else {
        // Space is depleting
        let d = (usable_free as f64 / daily_burn_f64).max(1.0) as u32;
        let exhaustion_date = unix_to_iso_date(now_unix + (d as u64) * 86400);

        if d <= 21 || free_ratio < 0.10 {
            (
                DepletionStatus::CriticalBurn,
                Some(d),
                format!(
                    "⚠️ وتيرة استهلاك سريعة: القرص يتقلص بمعدل (+{:.1} MB يومياً). التقدير: ستنفد المساحة خلال {} يوماً (بتاريخ {}).",
                    velocity_mb, d, exhaustion_date
                ),
                format!(
                    "⚠️ High burn rate: space shrinking by (+{:.1} MB/day). Estimated exhaustion in {} days (by {}).",
                    velocity_mb, d, exhaustion_date
                ),
            )
        } else {
            (
                DepletionStatus::GradualBurn,
                Some(d),
                format!(
                    "معدل استهلاك تدريجي (+{:.1} MB يومياً). المساحة الحالية تكفي لنحو {} يوماً (حتى تاريخ {}).",
                    velocity_mb, d, exhaustion_date
                ),
                format!(
                    "Gradual burn rate (+{:.1} MB/day). Space is projected to last ~{} days (until {}).",
                    velocity_mb, d, exhaustion_date
                ),
            )
        }
    };

    let confidence: f32 = ((sorted.len() as f32 * 0.15) + (time_span_days as f32 * 0.05)).clamp(0.40, 0.95);
    let exhaustion_date_iso = days.map(|d| unix_to_iso_date(now_unix + (d as u64) * 86400));

    DepletionForecast {
        current_free_bytes: current_free,
        current_total_bytes: current_total,
        daily_burn_bytes,
        estimated_days_remaining: days,
        exhaustion_date_iso,
        status,
        recommendation_ar: rec_ar,
        recommendation_en: rec_en,
        confidence_score: confidence,
        burn_velocity_mb_per_day: velocity_mb,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_iso_dates_accurately() {
        // 2026-11-10 is ~ 1794300000
        assert_eq!(unix_to_iso_date(0), "1970-01-01");
        assert_eq!(unix_to_iso_date(86400), "1970-01-02");
        assert_eq!(unix_to_iso_date(1700000000), "2023-11-14");
    }

    #[test]
    fn handles_empty_snapshots_safely() {
        let forecast = predict_depletion(&[], 50 * 1024 * 1024 * 1024, 100 * 1024 * 1024 * 1024, 1700000000);
        assert_eq!(forecast.status, DepletionStatus::Stable);
        assert_eq!(forecast.estimated_days_remaining, None);
    }

    #[test]
    fn forecasts_depletion_with_burn_rate() {
        let now = 1700000000;
        let day = 86400;
        let total = 100 * 1024 * 1024 * 1024; // 100 GB
        let snapshots = vec![
            StorageSnapshot { timestamp: now - 3 * day, free_bytes: 30 * 1024 * 1024 * 1024, total_bytes: total },
            StorageSnapshot { timestamp: now - 2 * day, free_bytes: 28 * 1024 * 1024 * 1024, total_bytes: total },
            StorageSnapshot { timestamp: now - 1 * day, free_bytes: 26 * 1024 * 1024 * 1024, total_bytes: total },
        ];
        // 2 GB burn per day. Current free: 24 GB. Usable (minus 5% of 100GB = 5GB) = 19 GB -> ~9-10 days
        let forecast = predict_depletion(&snapshots, 24 * 1024 * 1024 * 1024, total, now);
        assert_eq!(forecast.status, DepletionStatus::CriticalBurn);
        assert!(forecast.estimated_days_remaining.unwrap() <= 12);
        assert!(forecast.burn_velocity_mb_per_day > 1800.0);
    }
}
