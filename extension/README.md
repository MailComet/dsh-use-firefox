# DSH Use FF — Firefox extension

This extension is the browser half of the `dsh-use-firefox` DSH plugin. It connects to a token-authenticated loopback WebSocket bridge opened by the DSH host plugin.

## Permissions

- `tabs`, `tabGroups`: list/create tabs and create/reuse the native **DSH** tab group.
- `scripting`: inject the page driver and annotation UI on demand.
- `storage`: store the bridge port, token, client id, and label locally.
- `alarms`: keep the MV3 event page reconnecting to DSH.
- `activeTab` and `<all_urls>`: the user can ask DSH to read or operate an arbitrary page, and can annotate a personal tab.

## Data flow

- The extension connects only to `ws://127.0.0.1:<port>/ext/bridge` and sends the host token in the first `hello` frame.
- Page snapshots, actions, and annotation data go to the DSH host plugin on the same machine. There is no cloud service and no telemetry.
- The host plugin writes audit records and screenshots under `~/.dsh/browser/`. The extension does not upload page content anywhere else.
- The toolbar popup is an introduction panel. First-time connection fields appear there only while the extension is not connected; connection, mode, and annotation settings live in DSH → Plugins → dsh-use-firefox.
- The annotation shortcut is a Firefox extension command (Ctrl+Alt+A; MacCtrl+Alt+A on macOS), so it works without injecting a page hotkey script and can be rebound in about:addons.
- Confirming an annotation puts a chip into the DSH composer; the message is sent only when the user submits it. Sent historical cards are read-only.
