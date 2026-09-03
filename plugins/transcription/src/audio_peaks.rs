use std::path::{Path, PathBuf};

use anlg_audio_utils::Source;

#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioPeaks {
    /// Loudness per bucket, scaled so the loudest bucket is 1.
    pub peaks: Vec<f32>,
    pub duration_ms: u64,
}

/// Loudness outline of an audio file, for drawing a progress waveform.
/// Decodes the file once as a stream; callers cache the result per session.
#[tauri::command]
#[specta::specta]
pub(crate) async fn audio_peaks(audio_path: String, buckets: u32) -> Result<AudioPeaks, String> {
    let path = PathBuf::from(audio_path);
    tauri::async_runtime::spawn_blocking(move || compute_peaks(&path, buckets as usize))
        .await
        .map_err(|error| error.to_string())?
}

// Two-second RMS chunks are accumulated while decoding, so a long recording
// costs a few thousand floats instead of its full sample count in memory.
const CHUNK_SECONDS: u32 = 2;

fn compute_peaks(path: &Path, buckets: usize) -> Result<AudioPeaks, String> {
    let source = anlg_audio_utils::source_from_path(path).map_err(|error| error.to_string())?;
    let sample_rate = u32::from(source.sample_rate()).max(1);
    let channels = usize::from(u16::from(source.channels())).max(1);
    let frames_per_chunk = (sample_rate / CHUNK_SECONDS).max(1) as usize;

    let mut chunk_rms = Vec::new();
    let mut chunk_sum = 0f64;
    let mut chunk_frames = 0usize;
    let mut frame_sum = 0f32;
    let mut frame_channel = 0usize;
    let mut total_frames = 0u64;

    for sample in source {
        frame_sum += sample * sample;
        frame_channel += 1;
        if frame_channel < channels {
            continue;
        }
        chunk_sum += f64::from(frame_sum / channels as f32);
        chunk_frames += 1;
        total_frames += 1;
        frame_sum = 0.0;
        frame_channel = 0;
        if chunk_frames == frames_per_chunk {
            chunk_rms.push((chunk_sum / chunk_frames as f64).sqrt() as f32);
            chunk_sum = 0.0;
            chunk_frames = 0;
        }
    }
    if chunk_frames > 0 {
        chunk_rms.push((chunk_sum / chunk_frames as f64).sqrt() as f32);
    }

    Ok(AudioPeaks {
        peaks: bucket_peaks(&chunk_rms, buckets),
        duration_ms: total_frames * 1000 / u64::from(sample_rate),
    })
}

fn bucket_peaks(values: &[f32], buckets: usize) -> Vec<f32> {
    if buckets == 0 {
        return Vec::new();
    }
    if values.is_empty() {
        return vec![0.0; buckets];
    }
    let mut peaks: Vec<f32> = (0..buckets)
        .map(|bucket| {
            let start = bucket * values.len() / buckets;
            let end = ((bucket + 1) * values.len() / buckets).max(start + 1);
            let slice = &values[start..end.min(values.len())];
            slice.iter().sum::<f32>() / slice.len() as f32
        })
        .collect();
    let max = peaks.iter().cloned().fold(0f32, f32::max);
    if max > 0.0 {
        for peak in &mut peaks {
            *peak /= max;
        }
    }
    peaks
}

#[cfg(test)]
mod tests {
    use super::bucket_peaks;

    #[test]
    fn averages_into_buckets_and_scales_the_loudest_to_one() {
        let peaks = bucket_peaks(&[0.1, 0.3, 0.2, 0.2, 0.8, 0.0], 3);
        assert_eq!(peaks, vec![0.5, 0.5, 1.0]);
    }

    #[test]
    fn spreads_fewer_values_than_buckets_without_gaps() {
        let peaks = bucket_peaks(&[0.5, 1.0], 4);
        assert_eq!(peaks, vec![0.5, 0.5, 1.0, 1.0]);
    }

    #[test]
    fn silence_stays_zero() {
        assert_eq!(bucket_peaks(&[0.0, 0.0], 2), vec![0.0, 0.0]);
        assert_eq!(bucket_peaks(&[], 2), vec![0.0, 0.0]);
    }
}
