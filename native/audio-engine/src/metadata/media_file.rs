use std::ffi::{CStr, CString};
use std::path::Path;
use std::ptr;

use anyhow::{ensure, Context, Result};
use ffmpeg_audio::{sys, FfErrorExt};

/// 本地 FFmpeg 格式上下文，限制为音频文件容器及本地文件 IO
struct MediaFile(*mut sys::AVFormatContext);

/// 音频书签的容器时间，单位为毫秒
#[derive(Debug, PartialEq)]
pub(crate) struct Chapter {
    pub start_ms: f64,
    pub end_ms: Option<f64>,
    pub title: Option<String>,
}

/// 文件级检查不使用文件大小或扩展名推断编码参数
pub(crate) struct ContainerDetails {
    pub format: String,
    pub audio_bit_rate: i64,
    pub container_bit_rate: i64,
    pub channel_layout: Option<String>,
    pub chapters: Vec<Chapter>,
}

impl MediaFile {
    /// 从文件内容打开容器，拒绝外部清单和网络协议
    /// @param path - 已知的本地文件路径
    fn open(path: &Path) -> Result<Self> {
        let path = CString::new(path.to_str().context("音频路径无法编码为 UTF-8")?)?;
        let mut ctx = ptr::null_mut();
        let mut options = ptr::null_mut();
        // FFmpeg 负责打开文件和释放解析缓冲，所有指针只在本上下文存活时使用
        unsafe {
            sys::av_dict_set(
                &mut options,
                c"protocol_whitelist".as_ptr(),
                c"file".as_ptr(),
                0,
            );
            sys::av_dict_set(
                &mut options,
                c"format_whitelist".as_ptr(),
                c"aac,aiff,ape,asf,caf,dsf,iff,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,mpc,mpc8,ogg,tta,wav,wv".as_ptr(),
                0,
            );
            let opened =
                sys::avformat_open_input(&mut ctx, path.as_ptr(), ptr::null(), &mut options);
            sys::av_dict_free(&mut options);
            opened.into_ff_result()?;
        }
        let file = Self(ctx);
        unsafe { sys::avformat_find_stream_info(file.0, ptr::null_mut()).into_ff_result()? };
        Ok(file)
    }

    /// 读取 FFmpeg 提供的容器章节
    fn chapters(&self) -> Vec<Chapter> {
        // FFmpeg 的章节时间基由每个章节单独声明，转换时保留亚毫秒精度
        unsafe {
            let ctx = &*self.0;
            (0..ctx.nb_chapters.min(4096) as usize)
                .filter_map(|index| {
                    let chapter = &**ctx.chapters.add(index);
                    let scale = 1000.0 * f64::from(chapter.time_base.num)
                        / f64::from(chapter.time_base.den);
                    let start_ms = (chapter.start as f64 * scale).max(0.0);
                    if !scale.is_finite() || scale <= 0.0 || chapter.start == sys::AV_NOPTS_VALUE {
                        return None;
                    }
                    let end_ms = chapter.end as f64 * scale;
                    let entry =
                        sys::av_dict_get(chapter.metadata, c"title".as_ptr(), ptr::null(), 0);
                    Some(Chapter {
                        start_ms,
                        end_ms: (end_ms > start_ms).then_some(end_ms),
                        title: (!entry.is_null()).then(|| {
                            CStr::from_ptr((*entry).value)
                                .to_string_lossy()
                                .into_owned()
                        }),
                    })
                })
                .collect()
        }
    }

    /// 读取当前容器中的全部流
    fn streams(&self) -> impl Iterator<Item = &sys::AVStream> {
        unsafe { (0..(*self.0).nb_streams as usize).map(|i| &**(*self.0).streams.add(i)) }
    }
}

impl Drop for MediaFile {
    /// 关闭容器及其文件句柄
    fn drop(&mut self) {
        unsafe { sys::avformat_close_input(&mut self.0) };
    }
}

/// 获取文件容器、声明的码率、声道布局和章节
/// @param path - 本地音频文件路径
pub(crate) fn inspect(path: &Path) -> Result<ContainerDetails> {
    let file = MediaFile::open(path)?;
    unsafe {
        let best = sys::av_find_best_stream(
            file.0,
            sys::AVMediaType_AVMEDIA_TYPE_AUDIO,
            -1,
            -1,
            ptr::null_mut(),
            0,
        );
        best.into_ff_result()?;
        let params = &*(*(*(*file.0).streams.add(best as usize))).codecpar;
        let mut name = [0; 128];
        let layout =
            sys::av_channel_layout_describe(&params.ch_layout, name.as_mut_ptr(), name.len());
        let channel_layout =
            (params.ch_layout.order != sys::AVChannelOrder_AV_CHANNEL_ORDER_UNSPEC && layout > 0)
                .then(|| CStr::from_ptr(name.as_ptr()).to_string_lossy().into_owned());
        Ok(ContainerDetails {
            format: CStr::from_ptr((*(*file.0).iformat).name)
                .to_string_lossy()
                .into_owned(),
            audio_bit_rate: params.bit_rate.max(0),
            container_bit_rate: (*file.0).bit_rate.max(0),
            channel_layout,
            chapters: file.chapters(),
        })
    }
}

/// 一次只持有一个编码包，兼容超大文件
struct Packet(*mut sys::AVPacket);

impl Packet {
    /// 在下一次读取前释放上一个包并忽略封面图片
    /// @param file - 当前容器
    /// @param stream_map - 非封面流索引映射
    fn next(
        &mut self,
        file: &MediaFile,
        stream_map: &[Option<usize>],
    ) -> Result<Option<(usize, &sys::AVPacket)>> {
        unsafe {
            loop {
                sys::av_packet_unref(self.0);
                let code = sys::av_read_frame(file.0, self.0);
                if code == sys::AVERROR_EOF {
                    return Ok(None);
                }
                code.into_ff_result()?;
                let packet = &*self.0;
                if let Some(index) = *stream_map
                    .get(packet.stream_index as usize)
                    .context("容器在读取时发现了新的媒体流")?
                {
                    return Ok(Some((index, packet)));
                }
            }
        }
    }
}

impl Drop for Packet {
    /// 释放当前编码包及缓冲
    fn drop(&mut self) {
        unsafe { sys::av_packet_free(&mut self.0) };
    }
}

/// 由 FFmpeg 对象借用一个数据区，零长时允许空指针
/// @param data - 由调用者持有的 FFmpeg 缓冲
/// @param size - FFmpeg 提供的字节数
unsafe fn bytes<'a>(data: *const u8, size: usize) -> &'a [u8] {
    if size == 0 {
        return &[];
    }
    unsafe { std::slice::from_raw_parts(data, size) }
}

/// Vorbis 额外数据中的注释头可编辑，保留标识头和解码配置头
/// @param data - 三个 Xiph lacing 头部组成的 extradata
fn vorbis_setup(data: &[u8]) -> Option<(&[u8], &[u8])> {
    if data.first() != Some(&2) {
        return None;
    }
    let mut offset = 1;
    let mut lengths = [0usize; 2];
    for length in &mut lengths {
        loop {
            let byte = *data.get(offset)?;
            offset += 1;
            *length += usize::from(byte);
            if byte != 255 {
                break;
            }
        }
    }
    let first_end = offset.checked_add(lengths[0])?;
    let setup_start = first_end.checked_add(lengths[1])?;
    Some((data.get(offset..first_end)?, data.get(setup_start..)?))
}

/// 比较非封面流的解码配置，允许标签改变容器总码率
/// @param a - 原始流
/// @param b - 临时文件中的对应流
fn same_stream(a: &sys::AVStream, b: &sys::AVStream) -> bool {
    unsafe {
        let (x, y) = (&*a.codecpar, &*b.codecpar);
        if x.codec_type != y.codec_type
            || x.codec_id != y.codec_id
            || x.sample_rate != y.sample_rate
            || x.format != y.format
            || x.bits_per_raw_sample != y.bits_per_raw_sample
            || x.bits_per_coded_sample != y.bits_per_coded_sample
            || x.initial_padding != y.initial_padding
            || x.trailing_padding != y.trailing_padding
            || a.time_base.num != b.time_base.num
            || a.time_base.den != b.time_base.den
            || sys::av_channel_layout_compare(&x.ch_layout, &y.ch_layout) != 0
        {
            return false;
        }
        let x_data = bytes(x.extradata, x.extradata_size.max(0) as usize);
        let y_data = bytes(y.extradata, y.extradata_size.max(0) as usize);
        x_data == y_data
            || (x.codec_id == sys::AVCodecID_AV_CODEC_ID_VORBIS
                && vorbis_setup(x_data).is_some_and(|setup| Some(setup) == vorbis_setup(y_data)))
    }
}

/// 确认音视频编码包、时间戳和裁剪侧数据相同
/// @param a - 原始包
/// @param b - 临时文件包
fn same_packet(a: &sys::AVPacket, b: &sys::AVPacket) -> bool {
    unsafe {
        let side = |packet: &sys::AVPacket| {
            let data = packet.side_data;
            (0..packet.side_data_elems as usize)
                .map(move |i| data.add(i))
                .filter(|entry| {
                    !matches!(
                        (**entry).type_,
                        sys::AVPacketSideDataType_AV_PKT_DATA_METADATA_UPDATE
                            | sys::AVPacketSideDataType_AV_PKT_DATA_STRINGS_METADATA
                    )
                })
        };
        a.pts == b.pts
            && a.dts == b.dts
            && a.duration == b.duration
            && bytes(a.data, a.size.max(0) as usize) == bytes(b.data, b.size.max(0) as usize)
            && side(a)
                .map(|entry| ((*entry).type_, bytes((*entry).data, (*entry).size)))
                .eq(side(b).map(|entry| ((*entry).type_, bytes((*entry).data, (*entry).size))))
    }
}

/// 写入前逐包核对全部非封面流，任何差异都保留原文件
/// @param original - 原音频文件
/// @param staged - 编辑后的临时副本
pub(super) fn verify_unchanged(original: &Path, staged: &Path) -> Result<()> {
    let before = MediaFile::open(original).context("无法验证原文件音频数据")?;
    let after = MediaFile::open(staged).context("无法读取写入后的音频数据")?;
    let index_streams = |file: &MediaFile| {
        let mut next = 0;
        file.streams()
            .map(|stream| {
                if stream.disposition & sys::AV_DISPOSITION_ATTACHED_PIC as i32 != 0 {
                    return None;
                }
                let index = next;
                next += 1;
                Some(index)
            })
            .collect::<Vec<_>>()
    };
    let before_map = index_streams(&before);
    let after_map = index_streams(&after);
    let before_streams: Vec<_> = before
        .streams()
        .zip(&before_map)
        .filter_map(|(s, i)| i.map(|_| s))
        .collect();
    let after_streams: Vec<_> = after
        .streams()
        .zip(&after_map)
        .filter_map(|(s, i)| i.map(|_| s))
        .collect();
    ensure!(
        before_streams.len() == after_streams.len()
            && before_streams
                .iter()
                .zip(after_streams)
                .all(|(a, b)| same_stream(a, b))
            && before.chapters() == after.chapters(),
        "写入后的媒体配置或章节发生变化"
    );
    let mut a = Packet(unsafe { sys::av_packet_alloc() });
    let mut b = Packet(unsafe { sys::av_packet_alloc() });
    ensure!(!a.0.is_null() && !b.0.is_null(), "无法分配音频校验缓冲");
    loop {
        match (a.next(&before, &before_map)?, b.next(&after, &after_map)?) {
            (None, None) => return Ok(()),
            (Some((x, a)), Some((y, b))) if x == y && same_packet(a, b) => {}
            (Some((x, a)), Some((y, b))) => anyhow::bail!(
                "写入后的媒体包内容发生变化，比对流 {x}/{y}，时间戳 {}/{}, 时长 {}/{}, 大小 {}/{}, 侧数据 {}/{}",
                a.pts, b.pts, a.duration, b.duration, a.size, b.size, a.side_data_elems, b.side_data_elems),
            _ => anyhow::bail!("写入后的媒体包数发生变化"),
        }
    }
}
