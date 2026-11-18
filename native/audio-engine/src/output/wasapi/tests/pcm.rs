use super::*;

#[test]
fn pcm16_roundtrip_preserves_every_sample_at_unity_gain() {
    for sample in i16::MIN..=i16::MAX {
        assert_eq!(
            convert_sample(f32::from(sample) / 32_768.0, 1.0, 16),
            i32::from(sample)
        );
    }
}

#[test]
fn pcm24_roundtrip_preserves_every_sample_at_unity_gain() {
    for sample in -8_388_608..=8_388_607 {
        assert_eq!(
            convert_sample(sample as f32 / 8_388_608.0, 1.0, 24),
            sample << 8
        );
    }
}

#[test]
fn pcm_conversion_clips_without_wrapping_and_applies_gain() {
    for (bits, min, max) in [
        (16, -32_768, 32_767),
        (24, i32::MIN, 0x7FFFFF00),
        (32, i32::MIN, i32::MAX),
    ] {
        assert_eq!(convert_sample(-2.0, 1.0, bits), min);
        assert_eq!(convert_sample(2.0, 1.0, bits), max);
        assert_eq!(convert_sample(1.0, 0.0, bits), 0);
    }
    assert_eq!(convert_sample(0.5, 0.5, 16), 8192);
    assert_eq!(convert_sample(-0.5, 0.5, 24), -2_097_152 << 8);
}

#[test]
fn decoded_integer_wav_reaches_device_packing_without_precision_or_gain_loss() {
    use crate::decoder::buffer::Shared;
    use crate::decoder::{prepare_decode, start_prepared_decode};
    use crate::dsp::{equalizer::Equalizer, fft::FftAnalyzer, tempo::StretchProcessor};
    use ffmpeg_audio::HttpCancelHandle;
    use parking_lot::Mutex;

    let dir = std::env::temp_dir().join(format!("sakura-pcm-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("direct.wav");
    let rate: u32 = 48_000;
    let channel_count: u16 = 2;
    for (bits, container) in [(16u16, 16u16), (24, 24), (24, 32), (32, 32)] {
        // 包含最小、最大及最低有效位相邻的正负值
        let shift = 32 - u32::from(bits);
        let max = i32::MAX >> shift;
        let values = [-max - 1, max, -1, 1, -17, 131, 0, 3];
        let samples: Vec<i32> = values
            .into_iter()
            .cycle()
            .take(480)
            .map(|sample| sample << shift)
            .collect();
        let data_size = (samples.len() * usize::from(bits / 8)) as u32;
        let mut wave = b"RIFF".to_vec();
        wave.extend((36 + data_size).to_le_bytes());
        wave.extend(b"WAVEfmt ");
        wave.extend(16u32.to_le_bytes());
        wave.extend(1u16.to_le_bytes());
        wave.extend(channel_count.to_le_bytes());
        wave.extend(rate.to_le_bytes());
        let block_align = channel_count * bits / 8;
        wave.extend((rate * u32::from(block_align)).to_le_bytes());
        wave.extend(block_align.to_le_bytes());
        wave.extend(bits.to_le_bytes());
        wave.extend(b"data");
        wave.extend(data_size.to_le_bytes());
        for &sample in &samples {
            wave.extend(&sample.to_le_bytes()[usize::from(4 - bits / 8)..]);
        }
        std::fs::write(&input, wave).unwrap();
        let prepared =
            prepare_decode(input.to_str().unwrap(), None, HttpCancelHandle::new()).unwrap();
        assert_eq!(prepared.integer_spec().unwrap().bits, u32::from(bits));
        let shared = Shared::with_integer_bits(rate, channel_count, Some(u32::from(bits)));
        shared.set_normalization_enabled(true);
        let (_, thread, _) = start_prepared_decode(
            prepared,
            Arc::clone(&shared),
            Arc::new(Mutex::new(Equalizer::new(rate, channel_count))),
            Arc::new(Mutex::new(StretchProcessor::new(channel_count, rate))),
        )
        .unwrap();
        drop(thread.join().unwrap());
        let mut source = DecoderSource::new(shared, Arc::new(FftAnalyzer::new()));
        let bytes = usize::from(container / 8);
        let mut dest = vec![0u8; samples.len() * bytes];
        let format = ExclusiveFormat {
            sample_rate: rate,
            channels: channel_count,
            container_bits: container,
            valid_bits: bits,
            basic_pcm: false,
        };
        let verified =
            fill_buffer(&mut dest, &mut source, &mut None, 0.01, false, &format).unwrap();
        let expected: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes()[4 - bytes..].to_vec())
            .collect();
        assert_eq!(verified, samples.len() as u64);
        assert_eq!(dest, expected);
    }
    std::fs::remove_file(input).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
