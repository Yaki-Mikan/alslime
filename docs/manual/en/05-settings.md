# 05 Settings Reference

This chapter is a reference guide to every screen you can open from the settings menu.

For startup settings (port and CLI paths), see [01 Setup and Installation](01-setup.md). For text replacement and character parameter fields, see [04 Roleplay Settings](04-roleplay.md).

## 1. Settings Menu

This is the hub screen opened with the gear icon (Settings) in the header.

![Settings menu](../images/ja/05-01-settings-hub.png)

| Button | What it does | Covered in |
| --- | --- | --- |
| Supporter features | Supporter sign-in and status check | [07](07-sponsor.md) |
| Settings pack | Import / export settings | [06](06-settings-pack.md) |
| AI model settings | Default conversation preset, provider, and models | Section 2 of this chapter |
| Image generation settings | ComfyUI connection settings (**shown only when supporter features are active**) | [08](08-comfyui.md) |
| Display language | Switch the UI language (dropdown, saved immediately) | Section 1 of this chapter |
| Basic chat settings | Font, display, temperature, and more | Section 4 of this chapter |
| Update character tag master | Rebuild the filter list from all characters' tag data | Section 1 of this chapter |
| Startup settings | Port, bind address, and CLI paths | [01](01-setup.md) |
| Concurrency limits | Maximum number of concurrent AI processes | Section 6 of this chapter |
| Debug settings | Developer-oriented settings such as session backups | — |
| System diagnostics | Environment self-diagnostics (read-only) | Section 7 of this chapter |

- **Display language**: Japanese / English. Changes are saved immediately. When the language is set to anything other than Japanese, the holiday calendar feature is disabled automatically.
- **Update character tag master**: Rebuilds the source data for the character-selection filters (work and tags) by scanning every character. Press this when the filters no longer match the actual characters.

## 2. AI Model Settings

This screen determines the initial state of new sessions. Changes are saved when you press "Apply".

![AI model settings](../images/ja/05-02-ai-model-settings.png)

- **Default conversation preset**: Choose the conversation preset ([Chapter 04](04-roleplay.md)) applied automatically when a new session starts. If none is set, you select one manually each time.
- **Default provider**: The AI selected first in the chat box at startup (Antigravity / Claude / Gemini). Defaults to Gemini when not set.
- **Per-provider default models**: Choose, for each provider, the model used when a message is sent or regenerated without an explicit model. If none is set, each CLI's default model is used.

## 3. Editing the Model List

Open this from "Edit model list" inside AI model settings. **When a new model is released, you can add its model ID yourself without waiting for an app update.**

![Edit model list](../images/ja/05-03-model-list-editor.png)

- **List**: Built-in models and models you added yourself (marked with an "Added" badge) are listed per provider. Deleting a built-in model only hides it, and you can "Restore" it at any time.
- **Connectivity check**: Use the signal icon on each row to test whether that model ID actually responds (the response time and the beginning of the output are shown).
- **Add a model**: Enter a model ID to add it. The provider is detected automatically from the ID, and you can also specify it manually.
  - For Antigravity, enter the ID in the form `antigravity:<model display name in the CLI>`.
  - For Gemini-family models, the "Thinking settings" let you create alias models that apply a Thinking Level (High / Medium / Low) to a base model.
- Changes are confirmed with "Save". If you run a connectivity check with unsaved changes, they are saved automatically first.

## 4. Basic Chat Settings

Settings for the chat appearance and basic behavior.

![Basic chat settings](../images/ja/05-04-chat-basic.png)

| Item | Description |
| --- | --- |
| Default user name | The default name used for you in conversations (falls back to "User" when empty) |
| Font / Font size / Line height / Empty line height | Text appearance in the chat display |
| Temperature | Lower values produce more consistent replies; higher values produce more varied replies (0.0–2.0) |
| Collapse consecutive blank lines | Condense blank lines in the display |
| Use holiday information | Add Japanese holidays to the date/time prompt (shown only when the UI language is Japanese) |
| Character display | Size of the character image next to messages (40–500px) |

For "Manage character parameter fields" and "Text replacement settings" at the bottom, see [Chapter 04](04-roleplay.md).

## 5. Configuration File Editor

This is the editing screen for configuration files (Markdown), opened with the note icon in the header.

![Configuration file editor](../images/ja/05-05-config-editor.png)

- **Categories**: Character / Situation / Individual personality / Individual outfit and hairstyle / Individual background / World / Stage / User settings / Occupation settings / Writing style, plus "AI provider instructions".
- **Basic workflow**: Pick a category, then either edit via "Open an existing file", or write a title and body and press "Save as new". Existing files use "Overwrite"; if you change the title, you can also choose "Save as a different file".
- **AI provider instructions**: A dedicated category for editing the base instruction files each AI CLI reads (creating and deleting are not possible).
- You can also import `.md` files by dropping them onto the editor.
- For the "Simple settings" mode of the Character category, see [Chapter 03](03-character.md); for "Manage templates", see [Chapter 04](04-roleplay.md).

## 6. Concurrency Limits

Set the maximum number of concurrent AI processes.

- **Global concurrency limit**: The combined limit across all AI types.
- **Per-type concurrency limits**: Individual limits for Gemini / Claude / Antigravity. Lowering the global value automatically lowers the per-type values to match.

Adjust these when you are concerned about PC load or want to run multiple generations in parallel.

## 7. System Diagnostics

A read-only screen that shows the environment self-diagnostics. When something misbehaves, check here first ([09 Troubleshooting](09-troubleshooting.md)).

![System diagnostics](../images/ja/05-06-diagnostics.png)

- **Build information**: Version, entitlement, platform, bind address and port, and the location of the data folder.
- **CLI status**: Detection results and authentication status for each AI CLI. A CLI can be found but not yet signed in.
- **Configuration files**: Checks for corruption and similar issues. Press "Rescan" to run the check again.
- **Cache / Backups**: Status and used space.

## Note: Background Image Settings

The "Session background image" feature, which shows images from image-bearing responses as the background, is configured **inside Image generation settings (a supporter feature)**. See [08 ComfyUI Integration](08-comfyui.md).

---

Previous: [04 Roleplay Settings](04-roleplay.md) | Next: [06 Importing & Exporting Settings](06-settings-pack.md)
