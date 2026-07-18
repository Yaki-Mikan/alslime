# 09 Troubleshooting

This chapter covers how to investigate and resolve common problems.

## 1. Start with System Diagnostics

Open Settings (gear) → "System diagnostics" to see the environment self-diagnostics ([Chapter 05, Section 7](05-settings.md)).

- **CLI status**: See at a glance whether each AI CLI has been found and whether it is authenticated.
- **Configuration files**: Detects corrupted files. Press "Rescan" to check again.
- **Build information**: Check the port, the data folder location, and the entitlement.

## 2. The App Won't Start or Nothing Appears

- **The browser does not open**: Open the address shown in the console (usually `http://127.0.0.1:3000`) directly.
- **The app exits right after starting**: The port may be conflicting with another application. Try starting with a different port ([Chapter 01, Section 6](01-setup.md)).
- **The screen looks stale or broken**: Try reloading the browser (refresh button).

## 3. No Response After Sending a Message

Errors are shown in the chat as "Error: ...". Here are the typical ones and how to handle them.

| Error | What to do |
| --- | --- |
| CLI was not found. Install the CLI and sign in from a terminal if required. | Install the AI CLI you want to use. If it is already installed, specify the executable location as described in [Chapter 01, Section 5](01-setup.md) |
| The configured CLI path was not found. Check the environment variable or setting. | Check the CLI path in the startup settings for typos. Clearing it back to empty makes the app search PATH automatically |
| Gemini CLI is not authenticated. Run gemini in a terminal and sign in. | As the message says, run that CLI once in a terminal and complete the sign-in (Claude Code / Antigravity show similar messages) |
| Error: timed out after 10 minutes without a response | Your connection or the AI service may be congested. Send the message again, or try a different model |

- **Sending does not react**: Sending is **Shift+Enter** (Enter inserts a line break; see [Chapter 02](02-first-chat.md)).
- **Responses are slow**: Responses are displayed all at once when complete, so depending on the content they can take several minutes. While waiting, you can abort with the stop button.

## 4. Checking and Aborting Running Processes

The "Job progress" panel in the header (waveform icon, with a badge showing the number of running jobs) lists the running and pending processes.

![Job progress](../images/ja/09-01-job-progress.png)

- Running jobs can be stopped with "Stop"; pending jobs can be canceled with "Cancel".
- Recent errors are also shown at the bottom.
- The number of jobs that can run at once is adjusted in Settings (gear) → "Concurrency limits" ([Chapter 05, Section 6](05-settings.md)).

## 5. Image Generation Fails (for Supporters)

- "This feature is for supporters and is not available with the current entitlement.": Check your sponsorship status in [Chapter 07](07-sponsor.md).
- "Connection test failed" / "Connection URL is required.": Check that ComfyUI itself is running and that the connection URL is correct ([Chapter 08](08-comfyui.md)).
- "Image tag judging failed.": Check that the CLI for the tag judge AI (analysis AI) is usable, from the same angles as the CLI errors in Section 3 of this chapter.

## 6. Settings Don't Take Effect

- **Port, bind address, LAN access**: Changes apply on the next startup. Restart the app.
- **Changes to conversation settings (characters, environment, etc.)**: They are not applied automatically to a conversation in progress. Press "Apply to current session" at the bottom of the sidebar ([Chapter 03](03-character.md)).
- **A module is installed but the feature does not appear**: Modules take effect after **restarting the app** once installed ([Chapter 07](07-sponsor.md)).

## 7. Data Location and Backups

Conversation history, settings, and characters all live under `roleplay/` in the startup folder. Copying the whole folder makes a backup. To carry only your settings around, the [settings pack](06-settings-pack.md) is convenient.

## 8. Still Stuck?

Let us know via a [GitHub Issue](https://github.com/YakiMikan/alslime/issues). Attaching what System Diagnostics shows (to the extent it contains no personal information) helps the investigation a lot.

---

Previous: [08 ComfyUI Integration](08-comfyui.md) | Back to index: [index](index.md)
