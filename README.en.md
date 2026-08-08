# AlSlime

**A local app for building characters and worlds, then bringing them to life with the AI you choose**

[日本語](README.md) · [Japanese Manual](docs/manual/index.md) · [English Manual](docs/manual/en/index.md) · [GitHub Sponsors](https://github.com/sponsors/Yaki-Mikan)

AlSlime is an AI CLI frontend for conversations with characters you create. Beyond the character profile, you can combine a worldview, stage, situation, writing style, and in-conversation time to continue the conversation as a living world.

It brings Gemini CLI, Claude Code, and Antigravity—installed and authenticated by you—into a browser-based conversation screen. Conversation history and settings are stored on your own PC.

![A conversation using a generated scene as its background](docs/manual/images/ja/09-03-chat-pocket-watch.png)

*This screen uses a generated image as the conversation background. Image generation is part of the supporter-only ComfyUI integration.*

## What You Can Do with AlSlime

### Build Characters and Their World

Define a character's personality, appearance, outfit, speech style, and background, and bring up to five characters into the same conversation. Combine them with worldviews, stages, situations, user profiles, and writing styles to enjoy different stories with the same characters.

During a conversation, you can review character states and relationships. You can also set the date and time within the conversation, keep it fixed, or advance it as messages are sent.

![Character and conversation settings](docs/manual/images/ja/03-01-conversation-settings.png)

### Choose the AI You Want to Talk To

AlSlime supports Gemini CLI, Claude Code, and Antigravity. It uses the authentication already completed in each CLI, letting you choose an AI and model suited to the character or purpose.

Conversations are saved automatically as sessions, so you can reopen a past conversation and continue where you left off. Favorite combinations of characters and world settings can be saved as conversation presets.

### Keep Your Data Close

The AlSlime server runs on your own PC. Character profiles, worldviews, stages, and other settings can be managed as Markdown files and edited with a text editor.

Settings can be exported as packs for backup or transfer to another PC. Conversation history and configuration files are stored under `roleplay/` in the directory where AlSlime is launched.

### Turn a Moment from the Conversation into an Image

The supporter-only ComfyUI integration lets an AI read the conversation and generate an image suited to the character and scene. The completed image can remain attached to a message or become the background of the conversation screen.

This feature requires a separate ComfyUI installation, an image-generation model, and suitable GPU hardware. See the [ComfyUI integration manual](docs/manual/en/09-comfyui.md) for details.

## Main Features

| Category | Features |
| --- | --- |
| Characters | Simple creation form, Markdown editing, character images and expressions, multiple characters |
| Roleplay | Worldviews, stages, situations, user profiles, writing styles, date and time, states and relationships |
| Conversations | AI CLI and model selection, session history, regeneration, conversation presets |
| Data management | Configuration file editor, settings packs, backup and transfer |
| Image generation | ComfyUI integration, generation from conversations, message attachments, background display |
| Languages | Japanese and English UI and manuals |

## Requirements

- **OS**: Windows / Linux
- **Browser**: A modern browser such as Chrome, Edge, or Firefox
- **AI CLI**: At least one of the following, installed and authenticated
  - Antigravity
  - Gemini CLI
  - Claude Code
- **Age**: 18 or older

The age requirement does not mean that AlSlime is intended for adult content. It is a precautionary measure reflecting that connected external AI services may produce inaccurate or inappropriate content, and that the developer cannot control or guarantee that content or its effects on the user.

Each AI CLI may require a separate plan or subscription with its provider. Plans and pricing can change, so please check the provider's latest information. The current combinations are listed in [Installation & Setup](docs/manual/en/01-setup.md).

## Quick Start

### Prebuilt Release

Download the file for your OS from [GitHub Releases](https://github.com/Yaki-Mikan/alslime/releases) and extract it. **The prebuilt release is the full-featured edition.**

- **Windows**: extract `alslime-X.Y.Z-windows-amd64.zip` and double-click `alslime.exe`
- **Linux**: extract `alslime-X.Y.Z-linux-amd64.tar.gz` (`tar xzf alslime-X.Y.Z-linux-amd64.tar.gz`) and run `./alslime` (the binary is already executable)

### Build from Source

A source build does not include the implementation of the core features such as AI conversation execution (those features return a "not implemented" error). Use it for inspecting or modifying the UI and code; for the full feature set, use the prebuilt release.

The prebuilt frontend is included, so Go alone is enough to build AlSlime. Go 1.26 or later is required.

```sh
go build -tags purepublic -o alslime ./cmd/app
```

Launching AlSlime starts a local server.

```sh
./alslime
# Open http://127.0.0.1:3000 in your browser
```

On first launch, review the terms of use, then choose the AI CLI to use from the settings screen. See the [operation manual](docs/manual/en/index.md) for detailed instructions.

### Build with UI Changes

```sh
cd frontend
npm ci
npm run build -- --outDir "../internal/frontend/dist"
cd ..
go build -tags purepublic -o alslime ./cmd/app
```

## Operation Manual

The manual can be opened from the AlSlime settings screen and is also available on GitHub.

- [Japanese Manual](docs/manual/index.md)
- [English Manual](docs/manual/en/index.md)

It covers installation, your first conversation, character creation, roleplay settings, settings packs, supporter features, ComfyUI integration, and troubleshooting.

## GitHub Sponsors

AlSlime is free to use. You can support its continued development through [GitHub Sponsors](https://github.com/sponsors/Yaki-Mikan).

Supporter features and their setup are described in the [Supporter Features manual](docs/manual/en/08-sponsor.md).

## Data and Privacy

AlSlime stores conversation history, generated content, and character settings on your PC. It does not send this content to the developer.

When requesting an AI response, the conversation is sent through the selected AI CLI to its provider's AI service. When supporter features are used, the GitHub account identifier and sponsorship status are handled by the authentication server.

## License and Terms

This repository is **source-available**. It is not open source under the OSI definition.

- [PolyForm Noncommercial License 1.0.0](LICENSE.md)
  - Viewing, use, modification, and redistribution are permitted for noncommercial purposes
  - The license terms and Required Notice must accompany redistributed copies
  - Commercial use is not permitted
- [AlSlime Terms of Use](EULA.en.md)
  - Users must be 18 years of age or older
  - Users are responsible for complying with the terms of the external AI services they connect
  - The software is provided without warranty
- [Third-party license notices](THIRD-PARTY-NOTICES.md)

> Required Notice: Copyright (c) YakiMikan

## Issues and Contributions

Please use [Issues](https://github.com/Yaki-Mikan/alslime/issues) for bug reports and feature requests. Pull Requests are not accepted at this time.

## Disclaimer

This software is provided AS IS, without warranty of any kind. AI output is generated by the external AI service connected by the user. See the [AlSlime Terms of Use](EULA.en.md) for details.
