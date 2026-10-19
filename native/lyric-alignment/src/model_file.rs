use anyhow::{ensure, Result};
use candle_core::{DType, Device, Shape, Tensor};
use candle_nn::{var_builder::SimpleBackend, Init};
use serde::Deserialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    sync::Mutex,
};

#[derive(Deserialize)]
struct TensorInfo {
    dtype: String,
    shape: Vec<usize>,
    data_offsets: [u64; 2],
}

pub struct ModelFile {
    file: Mutex<File>,
    data_start: u64,
    tensors: HashMap<String, TensorInfo>,
}

impl ModelFile {
    /// 读取 safetensors 索引，权重直接写入最终张量，避免映射文件与张量同时占用内存
    /// @param path - 固定版本的本地权重文件
    pub fn open(path: &Path) -> Result<Self> {
        let mut file = File::open(path)?;
        let mut length = [0u8; 8];
        file.read_exact(&mut length)?;
        let length = u64::from_le_bytes(length);
        ensure!(length <= 1024 * 1024, "模型索引过长");
        let mut header = vec![0u8; length as usize];
        file.read_exact(&mut header)?;
        let mut header: serde_json::Map<String, serde_json::Value> =
            serde_json::from_slice(&header)?;
        header.remove("__metadata__");
        let tensors: HashMap<String, TensorInfo> =
            serde_json::from_value(serde_json::Value::Object(header))?;
        let data_start = length + 8;
        let file_length = file.metadata()?.len();
        for info in tensors.values() {
            let elements = info
                .shape
                .iter()
                .try_fold(1u64, |count, d| count.checked_mul(*d as u64));
            ensure!(
                info.dtype == "F32"
                    && info.data_offsets[1] >= info.data_offsets[0]
                    && info.data_offsets[1] <= file_length - data_start
                    && elements.and_then(|n| n.checked_mul(4))
                        == Some(info.data_offsets[1] - info.data_offsets[0]),
                "模型张量索引无效"
            );
        }
        Ok(Self {
            file: Mutex::new(file),
            data_start,
            tensors,
        })
    }
}

impl SimpleBackend for ModelFile {
    /// 按模型结构核对形状，再读取对应张量
    /// @param shape - BERT 层要求的张量形状
    /// @param name - 权重名称
    /// @param _hint - 本地完整权重不需要随机初始化
    /// @param dtype - 固定的 FP32 推理精度
    /// @param device - 本次 CPU 推理设备
    fn get(
        &self,
        shape: Shape,
        name: &str,
        _hint: Init,
        dtype: DType,
        device: &Device,
    ) -> candle_core::Result<Tensor> {
        let info = self
            .tensors
            .get(name)
            .ok_or_else(|| candle_core::Error::Msg(format!("模型缺少张量 {name}")))?;
        if info.shape != shape.dims() {
            candle_core::bail!("模型张量形状无效: {name}");
        }
        self.get_unchecked(name, dtype, device)
    }

    /// 将 FP32 权重直接读入 Candle 接管的连续数组，不创建整文件或中间张量副本
    /// @param name - 权重名称
    /// @param dtype - 请求精度
    /// @param device - 请求设备
    fn get_unchecked(
        &self,
        name: &str,
        dtype: DType,
        device: &Device,
    ) -> candle_core::Result<Tensor> {
        if dtype != DType::F32 || !device.is_cpu() {
            candle_core::bail!("对齐模型使用 CPU FP32 推理");
        }
        let info = self
            .tensors
            .get(name)
            .ok_or_else(|| candle_core::Error::Msg(format!("模型缺少张量 {name}")))?;
        let mut values = vec![0f32; ((info.data_offsets[1] - info.data_offsets[0]) / 4) as usize];
        let mut file = self
            .file
            .lock()
            .map_err(|_| candle_core::Error::Msg("模型读取锁已失效".into()))?;
        file.seek(SeekFrom::Start(self.data_start + info.data_offsets[0]))?;
        file.read_exact(bytemuck::cast_slice_mut(&mut values))?;
        #[cfg(target_endian = "big")]
        for value in &mut values {
            *value = f32::from_bits(value.to_bits().swap_bytes());
        }
        Tensor::from_vec(values, info.shape.as_slice(), device)
    }

    /// 检查加载器要求的权重名称是否存在
    /// @param name - 已完成名称映射的权重
    fn contains_tensor(&self, name: &str) -> bool {
        self.tensors.contains_key(name)
    }
}
