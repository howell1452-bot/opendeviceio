# @opendeviceio/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server over the
OpenDeviceIO registry. It gives an AI agent (Claude and other MCP clients) **ground
truth** for AV/IT system design — real device I/O instead of hallucinated back panels —
and a way to **verify** a proposed design.

## Tools

| Tool | What it does |
| --- | --- |
| `search_devices` | Search the registry by text / manufacturer / category / kind / connector. |
| `get_device` | Fetch the full `.odio` document for an id (e.g. `crestron/dm-nvx-360`). |
| `get_io_table` | The standardized I/O table for a device — grouped, render-ready summary. |
| `validate_design` | Validate a proposed `.odio` document (schema + modular-chassis slot fit) — the *generate → validate → repair* loop. |

Search/fetch use the public REST API; validation runs locally via `@opendeviceio/sdk`.

## Build

```
npm install
npm --prefix packages/mcp run build
```

## Configure in an MCP client

Claude Desktop (`claude_desktop_config.json`) or any stdio MCP client:

```jsonc
{
  "mcpServers": {
    "opendeviceio": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"],
      "env": { "ODIO_API_BASE": "https://opendeviceio.org" }
    }
  }
}
```

`ODIO_API_BASE` defaults to `https://opendeviceio.org`; point it at a local dev server
(`http://localhost:3000`) if needed. Transport is stdio.

## Example agent flow

> "Find a Crestron 4K HDMI matrix, and check whether this card fits this frame."

The agent calls `search_devices` → `get_io_table`/`get_device` for the candidates, then
builds a bundle and calls `validate_design`, which reports slot/compatibility errors to
fix — so the answer is grounded and checked, not guessed.
