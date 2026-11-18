use super::*;

/// f32 → 整型样本转换（应用音量增益后写入）
pub(super) fn convert_sample(sample: f32, gain: f32, valid_bits: u16) -> i32 {
    let clamped = (sample * gain).clamp(-1.0, 1.0);
    match valid_bits {
        16 => (clamped * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i32,
        24 => {
            ((clamped * 8_388_608.0)
                .round()
                .clamp(-8_388_608.0, 8_388_607.0) as i32)
                << 8
        }
        _ => (clamped * 2_147_483_648.0).round() as i32,
    }
}

/// 将左对齐的整数样本写入 16、24 或 32 位设备容器
/// @param dest - 设备缓冲区中的单个样本
/// @param value - 源整数 PCM 左对齐至高位
fn pack(dest: &mut [u8], value: i32) {
    dest.copy_from_slice(&value.to_le_bytes()[4 - dest.len()..]);
}

/// 从实际设备缓冲读取样本并还原至统一位宽
/// @param src - 已填充的设备样本
fn unpack(src: &[u8]) -> i32 {
    let mut bytes = [0u8; 4];
    bytes[4 - src.len()..].copy_from_slice(src);
    i32::from_le_bytes(bytes)
}

/// 将渲染缓冲按有效位深填充（交错样本，静音时填零）
/// 增益在本次缓冲内从上一缓冲的目标值线性过渡到当前目标值，避免突变产生爆音
/// `gain` 为 None 表示没有可延续的增益（新流或刚从静音恢复），本缓冲直接采用目标值
pub(super) fn fill_buffer(
    buffer: &mut [u8],
    source: &mut DecoderSource,
    gain: &mut Option<f32>,
    target: f32,
    silent: bool,
    format: &ExclusiveFormat,
) -> Result<u64> {
    let bytes_per_sample = usize::from(format.container_bits / 8);
    source.begin_callback();
    if let Some(bits) = source.integer_bits() {
        if silent {
            buffer.fill(0);
            return Ok(0);
        }
        let padding_mask = u32::MAX.checked_shr(bits).unwrap_or(0);
        let mut compared = 0;
        let mut valid = true;
        for dest in buffer.chunks_exact_mut(bytes_per_sample) {
            if let Some(value) = source.next_integer() {
                pack(dest, value);
                valid &= value as u32 & padding_mask == 0 && unpack(dest) == value;
                compared += 1;
            } else {
                dest.fill(0);
            }
        }
        if !valid {
            // 失败的设备缓冲只提交静音，不能累计为通过验证的音频
            buffer.fill(0);
            anyhow::bail!("设备缓冲中的 PCM 与解码样本不一致");
        }
        return Ok(compared);
    }
    let samples = buffer.len() / bytes_per_sample;
    let from = gain.unwrap_or(target);
    let step = if samples == 0 {
        0.0
    } else {
        (target - from) / samples as f32
    };
    let mut current = from;
    for chunk in buffer.chunks_exact_mut(bytes_per_sample) {
        let value = if silent {
            0
        } else {
            current += step;
            convert_sample(source.next().unwrap_or(0.0), current, format.valid_bits)
        };
        let aligned = if format.valid_bits == 16 {
            value << 16
        } else {
            value
        };
        pack(chunk, aligned);
    }
    // 静音缓冲不推进增益状态，恢复时重新对齐当前音量，避免用旧值渐变造成突跳
    *gain = if silent { None } else { Some(target) };
    Ok(0)
}

#[cfg(test)]
#[path = "tests/pcm.rs"]
mod tests;
