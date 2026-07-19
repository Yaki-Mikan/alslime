# AlSlime

A locally-hosted AI CLI frontend / character creation & conversation support tool

*日本語版 README は [README.md](README.md) をご覧ください。*

<!-- TODO: Add screenshot
![AlSlime screenshot](docs/images/screenshot-main.png)
-->

## Overview

AlSlime is a local application that runs entirely on your own PC, letting you use AI CLIs you have installed yourself (Gemini CLI / Claude Code / Antigravity) through a browser UI.

- **Fully local** — The server runs on your own PC. Your conversations, generated content, and character settings are never sent to the developer (note that conversation content is sent to the respective AI services through the AI CLI you connect, and the app communicates with the authentication server only when you use supporter features)
- **Character creation & conversation support** — Manage character profiles, roleplay-oriented conversation flows, and presets for prompts and parameters
- **Multiple AI CLI support** — Switch between Gemini CLI / Claude Code / Antigravity (installing and subscribing to each CLI is your own responsibility)
- **ComfyUI integration** — Generate images from conversations (ComfyUI must be installed separately by you)
- **Settings import / export** — Portable as a settings pack
- **Japanese / English UI**

## Requirements

- Windows / Linux
- At least one AI CLI (Gemini CLI / Claude Code / Antigravity) installed and authenticated
  - Using each AI CLI may require a separate paid plan or subscription with its provider; check the provider's latest guidance for what is required
  - For a table of which AI requires which subscription and which CLI, see [Manual, Chapter 01](docs/manual/en/01-setup.md)
- To build from source: Go 1.26+ (plus Node.js if you want to modify the UI)

## Quick Start

### Building from source

A prebuilt frontend is bundled, so Go alone is enough to build.

```sh
go build -tags purepublic -o alslime ./cmd/app
```

Launching the binary starts a local server; open it in your browser.

```sh
./alslime
# → Open http://127.0.0.1:3000 in your browser
```

On first launch, a terms-of-use consent screen is shown. After accepting, configure the executable path of the AI CLI you want to use in the settings screen.

### Building with UI changes

```sh
cd frontend
npm ci
npm run build -- --outDir "../internal/frontend/dist"
cd ..
go build -tags purepublic -o alslime ./cmd/app
```

### Prebuilt releases (GitHub Releases)

In preparation.

## Support the project

AlSlime is free to use. Additional features for supporters are in preparation (GitHub Sponsors — coming soon).

## License

This repository is **source-available**. It is not open source (per the OSI definition).

- Source code license: [PolyForm Noncommercial License 1.0.0](LICENSE.md)
  - You are free to view, study, modify, and use/redistribute it for **noncommercial** purposes
  - **Commercial use is not permitted**
- Terms of use (EULA): [EULA.en.md](EULA.en.md) — Using this software requires your agreement (18+ only, no warranty). *In the event of any discrepancy, the Japanese version ([EULA.md](EULA.md)) prevails.*

> Required Notice: Copyright (c) YakiMikan

### Third-party licenses

License notices for third-party libraries used by this software will be bundled with distributions as THIRD-PARTY-NOTICES (when building from source, see `go.mod` / `frontend/package.json`).

## Contributing

Pull Requests are not accepted at this time. Please use Issues for bug reports and feature requests.

## Disclaimer

This software is provided AS IS, without warranty of any kind. AI-generated output comes from the external AI services you connect, and the developer has no control over it. See [EULA.en.md](EULA.en.md) for details.
