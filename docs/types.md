# 类型参考

插件在事件回调和处理器入参里收到的数据类型，完整字段集中列在这里。带 `?` 的字段为可选。

## 曲目

### Track

一首歌曲的轻量元信息，不包含完整歌词和按需读取的 `TrackDetail`。插件的 [`trackChange`](/plugins/control#events) 事件载荷与菜单点击（[`menuClick`](/plugins/api#menus)）入参的 `track` 均为此对象。

| 字段             | 类型                               | 说明                                  |
| ---------------- | ---------------------------------- | ------------------------------------- |
| `id`             | `string`                           | 曲目 ID                               |
| `extId`          | `string?`                          | 二级 ID                               |
| `mediaId`        | `string?`                          | 平台媒体文件 ID                       |
| `favorite`       | `boolean?`                         | 服务器权威收藏状态，缺失表示尚未读取  |
| `source`         | [`TrackSource`](#tracksource)      | 歌曲来源                              |
| `plugin`         | [插件来源](#plugin-source)`?`      | 独立插件歌曲的来源信息，API 5 新增    |
| `path`           | `string?`                          | 本地文件路径（仅本地歌曲）            |
| `cuePath`        | `string?`                          | CUE 文件路径                          |
| `cueAudioPath`   | `string?`                          | CUE 指向的音频文件路径                |
| `cueStartMs`     | `number?`                          | CUE 分轨起始时间（毫秒）              |
| `cueEndMs`       | `number?`                          | CUE 分轨结束时间（毫秒）              |
| `serverId`       | `string?`                          | 流媒体服务器实例 ID（仅 `streaming`） |
| `originalId`     | `string?`                          | 流媒体服务器原生 ID（仅 `streaming`） |
| `serverRevision` | `number?`                          | 服务器账号或地址变化后的媒体身份代次  |
| `title`          | `string`                           | 标题                                  |
| `comment`        | `string?`                          | 注释 / 副标题                         |
| `artists`        | [`Artist[]`](#artist)              | 歌手                                  |
| `album`          | [`Album`](#album)`?`               | 专辑                                  |
| `track`          | `number?`                          | 曲目编号                              |
| `duration`       | `number`                           | 时长（毫秒）                          |
| `cover`          | `string?`                          | 封面地址                              |
| `coverOriginal`  | `string?`                          | 原始封面地址                          |
| `fileSize`       | `number?`                          | 文件大小（字节）                      |
| `mtime`          | `number?`                          | 修改时间（Unix 毫秒）                 |
| `ctime`          | `number?`                          | 创建时间（Unix 毫秒）                 |
| `quality`        | [`AudioQuality`](#audioquality)`?` | 音质信息                              |
| `fee`            | [`TrackFee`](#trackfee)`?`         | 付费标记                              |
| `cloud`          | `boolean?`                         | 是否云盘歌曲                          |

### TrackSource

歌曲来源：`"local"`（本地文件）、`"streaming"`（流媒体服务器）、`"plugin"`（独立插件来源），或内置在线平台 `"netease"`、`"qqmusic"`、`"kugou"`。

### 插件来源 {#plugin-source}

`source` 为 `"plugin"` 时，`plugin` 必填，由宿主根据[搜索候选](/plugins/source#musicsearch)生成。

| 字段        | 类型        | 说明                                             |
| ----------- | ----------- | ------------------------------------------------ |
| `pluginId`  | `string`    | 所属插件的 `@id`                                 |
| `source`    | `string`    | 插件注册的 source key                            |
| `musicInfo` | `Candidate` | 原始搜索候选，包含源内歌曲 ID 和后续取数所需字段 |

宿主生成唯一的 `Track.id`，原始歌曲 ID 保存在 `plugin.musicInfo.id`。播放或加入队列时传递完整 `Track` 并保留 `plugin` 字段，队列恢复和后续解析依赖这些信息。

### TrackFee

付费标记：`0` 免费、`1` VIP、`4` 需购买（数字专辑等）、`8` 受限音质。

### Artist

| 字段         | 类型      | 说明                             |
| ------------ | --------- | -------------------------------- |
| `id`         | `string?` | 歌手 ID                          |
| `serverId`   | `string?` | 所属媒体服务器，跨页面导航时保留 |
| `name`       | `string`  | 歌手名                           |
| `avatar`     | `string?` | 头像地址                         |
| `albumCount` | `number?` | 名下专辑数                       |

### Album

| 字段         | 类型      | 说明                             |
| ------------ | --------- | -------------------------------- |
| `id`         | `string?` | 专辑 ID                          |
| `serverId`   | `string?` | 所属媒体服务器，跨页面导航时保留 |
| `name`       | `string`  | 专辑名                           |
| `cover`      | `string?` | 封面地址                         |
| `artist`     | `string?` | 专辑歌手（字符串）               |
| `trackCount` | `number?` | 曲目数                           |
| `year`       | `number?` | 发行年份                         |

### Playlist

| 字段          | 类型      | 说明           |
| ------------- | --------- | -------------- |
| `id`          | `string?` | 歌单 ID        |
| `serverId`    | `string?` | 所属媒体服务器 |
| `name`        | `string`  | 歌单名称       |
| `cover`       | `string?` | 封面           |
| `description` | `string?` | 描述           |
| `trackCount`  | `number?` | 曲目数量       |
| `owner`       | `string?` | 创建者         |

### AudioQuality

| 字段            | 类型     | 说明          |
| --------------- | -------- | ------------- |
| `sampleRate`    | `number` | 采样率（Hz）  |
| `channels`      | `number` | 声道数        |
| `bitsPerSample` | `number` | 位深          |
| `bitRate`       | `number` | 比特率（bps） |
| `codec`         | `string` | 编码格式      |

## 歌词

### LyricLine

一行歌词。插件的 [`lyricChange`](/plugins/control#events) 事件载荷 `lines` 即 `LyricLine[]`。

| 字段                | 类型                                         | 说明                                           |
| ------------------- | -------------------------------------------- | ---------------------------------------------- |
| `words`             | [`LyricWord[]`](#lyricword)                  | 该行逐字内容；逐行（LRC 类）格式时只有一个元素 |
| `translatedLyric`   | `string`                                     | 翻译，无则为空串                               |
| `romanLyric`        | `string`                                     | 音译 / 罗马音，无则为空串                      |
| `translationWords`  | [`LyricSpan[]`](#lyricspan)`?`               | 与主歌词共用毫秒时间轴的逐字译文               |
| `romanizationWords` | [`RomanizationSpan[]`](#romanizationspan)`?` | 可跨多个主歌词字词的逐字音译                   |
| `startTime`         | `number`                                     | 行起始时间（毫秒）                             |
| `endTime`           | `number`                                     | 行结束时间（毫秒）                             |
| `isBG`              | `boolean`                                    | 是否为背景和声行                               |
| `isDuet`            | `boolean`                                    | 是否为对唱行（通常右对齐显示）                 |
| `language`          | `"ja" \| "ko" \| "zh-CN" \| "und-Latn"?`     | 主歌词语言，用于字形选择与 HTML `lang`         |

整行纯文本：`line.words.map((word) => word.word).join("")`。逐行歌词的逐字时间通常与行时间一致，不必关心 `words` 内部时间。

### RomanizationSpan

继承 [`LyricSpan`](#lyricspan)，另有可选 `from` / `to`（`number`），表示主歌词 `words` 的起止下标，均从 0 开始且包含端点。一个完整音译可覆盖多个原词；不要按原词逐个拼接而重复输出同一片段。

### LyricWord

逐字内容，继承 [`LyricSpan`](#lyricspan) 的全部字段，并附加：

| 字段        | 类型                           | 说明                               |
| ----------- | ------------------------------ | ---------------------------------- |
| `romanWord` | `string?`                      | 该字音译                           |
| `obscene`   | `boolean?`                     | 是否敏感词                         |
| `ruby`      | [`LyricSpan[]`](#lyricspan)`?` | 注音（如日语假名标注），通常用不到 |

### LyricSpan

| 字段        | 类型     | 说明             |
| ----------- | -------- | ---------------- |
| `startTime` | `number` | 起始时间（毫秒） |
| `endTime`   | `number` | 结束时间（毫秒） |
| `word`      | `string` | 内容文本         |
