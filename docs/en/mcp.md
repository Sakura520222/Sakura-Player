# MCP Interface

Sakura Player includes a [Model Context Protocol](https://modelcontextprotocol.io/) service that lets MCP clients inspect playback, search the local library, and control the player.

## Connection

MCP is disabled by default. Enable **Settings → AI Integration → MCP**, then use the port and connection key shown in Settings.

- **Transport:** Streamable HTTP
- **URL:** `http://127.0.0.1:<port>/mcp`
- **Default port:** `14569`, configurable; saved ports are preserved, so use distinct ports and keys alongside upstream
- **Session mode:** Stateful JSON responses; idle sessions are released automatically

```json
{
  "mcpServers": {
    "sakura-player": {
      "type": "http",
      "url": "http://127.0.0.1:14569/mcp",
      "headers": {
        "X-MCP-Key": "connection key shown in Settings"
      }
    }
  }
}
```

Client configuration fields vary. Keep Sakura Player running while the client is connected.

## Tools

| Tool                            | Parameters                             | Description                                                       |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `get_playback_status`           | —                                      | Playback state, queue index, position, volume, and modes          |
| `get_now_playing`               | —                                      | Lightweight current-track snapshot without full lyrics            |
| `get_queue`                     | `offset?`, `limit?`                    | Read the current playback queue; defaults to 50 tracks, up to 100 |
| `play` / `pause` / `stop`       | —                                      | Playback control                                                  |
| `next_track` / `previous_track` | —                                      | Change track                                                      |
| `seek`                          | `positionMs`                           | Seek to a millisecond position                                    |
| `set_volume`                    | `volume`                               | Set volume from `0` to `1`                                        |
| `set_play_mode`                 | `repeat?`, `shuffle?`                  | Configure repeat and shuffle                                      |
| `play_track`                    | `track`                                | Request playback with a complete Track from search results        |
| `add_to_queue`                  | `tracks`, `position?`                  | Add 1–50 complete Tracks at `next` or `end`                       |
| `search_library`                | `query`, `limit?`                      | Search the local library; default 20, max 100                     |
| `search_online_songs`           | `platform`, `query`, `page?`, `limit?` | Search online sources; max 50 per page                            |
| `get_random_tracks`             | `limit?`                               | Random tracks; default 10, max 50                                 |
| `list_albums`                   | `limit?`                               | Album summaries; default 50, max 100                              |
| `list_artists`                  | `limit?`                               | Artist summaries; default 50, max 100                             |

## Playback status

`get_playback_status` returns the playback state, position, duration, volume, modes, and `currentIndex`. The index is zero-based within the entire queue, or -1 when no queue item is selected. Use it as the reference offset when calling `get_queue` to read nearby tracks.

## Playback queue

Call `get_queue` with optional `offset` (default `0`) and `limit` (default `50`, from 1 to 100). The response contains `tracks`, `total`, `currentIndex`, and `offset`. `currentIndex` is the zero-based index of the current track in the entire queue, or `-1` when no queue item is selected. Results follow the player queue order; an offset beyond the queue returns an empty `tracks` array.

```json
{ "offset": 0, "limit": 20 }
```

The tool returns an error if the main window is unavailable or does not respond.

## Resources

| URI                               | Description                        |
| --------------------------------- | ---------------------------------- |
| `sakura-player://now-playing`     | Lightweight current-track snapshot |
| `sakura-player://library/summary` | Track, album, and artist counts    |
| `splayer://now-playing`           | Legacy alias for current playback  |
| `splayer://library/summary`       | Legacy alias for library counts    |

Legacy URIs continue to return the same current data, so existing resource addresses need no migration. These are MCP resource identifiers, not registered operating-system URL schemes; they do not change `orpheus://`. The `sakura-player` client configuration entry is separate from upstream. Manual entry names are arbitrary, and automatic configuration does not overwrite upstream's `splayer-next` entry.

## Debugging with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Choose Streamable HTTP and enter `http://127.0.0.1:14569/mcp`. If it cannot connect, check the MCP switch, port, and connection key in Settings.
