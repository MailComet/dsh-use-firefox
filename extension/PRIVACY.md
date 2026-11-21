# Privacy Policy — DSH Use FF

DSH Use FF is a local browser bridge.

- The extension reads page content only when the user asks DeepSeek Harness to operate or annotate that page, or when the user starts an annotation.
- Page text, DOM snippets, selectors, and annotation notes are sent only to the local DSH host plugin over `ws://127.0.0.1`.
- The bridge is protected by a locally generated token stored in `~/.dsh/browser/ext-token`.
- The extension does not collect telemetry, analytics, browsing history, or personal information, and does not send data to any remote server.
- The host plugin writes audit records and screenshots under `~/.dsh/browser/` on the user's machine.
- No remote code is loaded or executed by the extension.

Contact: the repository owner of the DSH Use FF project.
