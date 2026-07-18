# 02 Your First Chat

This chapter explains the layout of the main screen and how to send a message and receive a response.

## What This Chapter Covers

1. Learn the names and roles of each part of the screen
2. Choose the AI and model to use
3. Send a message and receive a response
4. Switch between sessions (units of conversation)

## 1. Screen Layout

![Overview of the main screen](../images/ja/02-01-main-layout.png)

### Header (top of the screen)

| Button | Name | Role |
| --- | --- | --- |
| + | New session | Start a new conversation |
| Clock | Session history | Open the list of past conversations and resume one |
| Waveform | Job progress | Check the progress of running processes |
| Note | Configuration file editor | Edit configuration files such as characters (Chapter 04) |
| Gear | Settings | Open the app-wide settings menu (Chapter 05) |
| Three lines | Conversation settings | Open the roleplay conversation settings (Chapters 03 and 04) |

During a conversation, a "Session status" button is added at the left end of the header. When the screen is narrow, some buttons wrap onto a second row.

### Other areas

- **Center**: The message display area. When there is no conversation yet, it shows "Send a message in chat to start the conversation."
- **Bottom**: The message input field. The AI and model selectors are here as well.
- **Right**: The sidebar that opens when you press "Conversation settings". Choose roleplay settings such as characters and stages here.

> **First-startup tip**: The "Conversation settings" sidebar on the right may open automatically the first time you start the app. Conversation settings for characters are covered in [03 Talking with Characters](03-character.md), so if you want to try a plain chat first, feel free to close it for now.

## 2. Choosing the AI and Model

![Provider and model selectors in the input area](../images/ja/02-02-input-model-select.png)

Two selectors sit side by side below the input field.

1. **Left selector**: Switches the AI to use (Antigravity / Claude / Gemini).
2. **Right selector**: Switches that AI's model.
3. The **gear icon** to its right (Open model settings) lets you edit the default models and the model list (see [05 Settings Reference](05-settings.md) for details).

Which AIs are available depends on the AI CLI setup you checked in [01 Setup and Installation](01-setup.md).

## 3. Sending a Message

1. Type a message in the input field.
2. **Press Shift+Enter to send** (the blue paper-plane "Send" button works too).

   > **Watch the key behavior**
   >
   > - **Pressing Enter alone inserts a line break.** Sending is **Shift+Enter**.
   > - Pressing Enter while composing Japanese text does not send the message (it only confirms the conversion).

3. Wait for the response. Responses are displayed **all at once when complete**, not bit by bit. Depending on the model and the content, this can take anywhere from tens of seconds to several minutes.
4. While you wait, the send button turns into a red "Stop" button. Press it to cancel response generation.
5. The regenerate button below the latest response generates a new response to the same content.

## 4. Sessions (Units of Conversation)

Conversations are saved automatically in units called "sessions".

- **Start a new conversation**: Press "New session" (+) in the header.
- **Return to a past conversation**: Press "Session history" in the header to open the list. Press an item to resume that conversation.

![Session history](../images/ja/02-04-session-history.png)

- **Rename a conversation**: During a conversation, press the pencil icon (Edit title) next to the title at the top of the screen.
- **Delete unneeded conversations**: Press the trash icon (Delete session) on an item in the session history to delete it after confirmation. To delete several at once, use "Bulk delete mode" at the top right of the history list to select them, then delete. **Deletion cannot be undone.**
- **Storage location**: Conversation data is saved under `roleplay/history/unified_sessions` in the startup folder.

---

Previous: [01 Setup and Installation](01-setup.md) | Next: [03 Talking with Characters](03-character.md)
