# Security and privacy

X Video Toolkit is a local browser extension plus a macOS Native Messaging host.
It handles media URLs, temporary audio, transcript text, and local application
integration. Treat changes in these areas as security-sensitive.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow:

https://github.com/Lemelson/x-post-toolkit/security/advisories/new

Do not include passwords, tokens, private media URLs, private transcripts, or
personal browser data in a public issue.

## Security boundaries

- The content script runs only on declared X/Twitter and Google Drive origins.
- The Native Messaging host accepts only supported HTTPS media hosts.
- URLs with credentials and private/local media hosts are rejected.
- Spokenly communication is limited to the loopback endpoint at `127.0.0.1`.
- Temporary audio is created in a per-request temporary directory and removed.
- Transcripts and source metadata are stored in browser-local extension storage.
- The project has no telemetry SDK or project-operated cloud transcription API.

Using Local-only mode in Spokenly prevents its online features from operating.
The extension also verifies that file transcription used `parakeetTDT06` before
accepting the result.

## Public repository checklist

Before publishing a change:

- inspect `git status` and every diff;
- exclude browser profiles, extension state, history databases, logs, and media;
- exclude `.env`, API keys, access tokens, private certificates, and credentials;
- exclude personal absolute paths and machine-local email addresses;
- run `npm run check`;
- run a secret scanner against both the working tree and git history;
- test with non-sensitive media;
- confirm temporary audio is removed;
- confirm the selected ASR model and local-only behavior.

## AI-assisted development

AI can generate insecure host permissions, overly broad URL allowlists, unsafe
shell commands, or misleading privacy claims. AI-authored changes require human
review and runtime verification before release.
