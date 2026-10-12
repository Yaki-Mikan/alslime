# 11 Text-to-Speech

[Back to Contents](index.md)

Previous chapter: [10 Image Generation](10-image-generation.md) / Next chapter: [12 Settings Packs and Updates](12-settings-pack-update.md)

This chapter explains text-to-speech, which plays the characters' lines with voices: the preparation flow, the settings, and how to use it in conversations. Text-to-speech is used when the text-to-speech supporter feature is enabled and the display language is Japanese ([09 Supporter Features](09-sponsor.md)).

## What This Chapter Covers

1. The flow to get started
2. Text-to-speech on the Settings screen
3. Quick settings
4. Reading a conversation aloud
5. Auto read-aloud

## 1. The Flow to Get Started

Text-to-speech creates audio with Irodori-TTS-Server, an external tool. The flow to get started is as follows.

1. Sign in to the supporter features and get the Irodori-TTS integration module ([09 Supporter Features](09-sponsor.md)).
2. Prepare and start Irodori-TTS-Server. ~~How to install it is explained on the AlSlime website.~~ (currently in preparation)
3. In "Connection" on the Settings screen, specify the address of Irodori-TTS-Server and check the connection ("2. Text-to-Speech on the Settings Screen" in this chapter).
4. Register voices on the "Voices" tab of Materials ([07-4 Materials: Voices](07-material-voice.md)).
5. Link voices to characters on the "Characters" tab of Materials ([07-3 Materials: Characters](07-material-characters.md)).
6. Select "Read aloud" on a chat bubble in the conversation.

Notes on GPU and VRAM capacity, use together with image generation, and the ethical constraints of the voice model are given in [09 Supporter Features](09-sponsor.md).

## 2. Text-to-Speech on the Settings Screen

Make the overall text-to-speech settings under "Read aloud" in "Image & voice" in Settings. When image generation is also enabled, switch the display with "Image generation" and "Read aloud" at the top. Each field shows its contents when you select its heading.

### Connection

![Connection](../images/ja/11-01-connection.png)

| Item | Description |
| --- | --- |
| Endpoint URL | Enter the address of Irodori-TTS-Server. A server running on another PC can also be specified. Select "Test connection" to show the results of getting the server response, the model list, and the voice list, along with the model, the model state, and the number of registered voices |
| API key | When connecting to a server on another PC, enter the API key set on the server side |
| Connection timeout (seconds) | Specify how long to wait for the server to respond |

Changes to the connection settings are saved with "Save" on the bar at the bottom of the screen. Changes in the other fields are saved immediately.

### Style directive and engine management

![Style directive and engine management](../images/ja/11-02-style-engine.png)

- **Style directive (emotion via emojis)**: When "Irodori-TTS style directive" is turned on, the AI adds supported emojis to its sentences in responses, and emotion is added to the audio. The emojis are removed from the screen display and from image generation, and are used only for creating audio.
- **Engine management**: Choose and reload the text-to-speech model, use "Load selected model" and "Offload", apply the runtime mode (Normal mode or Low-VRAM mode), and use "Restart server". This field is shown when a supported Irodori-TTS-Server is connected.

### Reading scope and narrator

![Reading scope & narrator](../images/ja/11-03-range-narrator.png)

| Item | Description |
| --- | --- |
| Reading scope | Choose "Dialogue only" or "Dialogue + narration" |
| Audio format | Choose wav or mp3. mp3 requires FFmpeg on the Irodori-TTS-Server side. Changes take effect for audio created afterward |
| Pause at breaks within a message (sec) | The length of the pause between the parts of a long message that was split when creating audio. Changes take effect for audio created afterward |
| Gap between turns / responses (sec) | The length of silence between audio clips in full-response reading and automatic playback. Changes take effect from the next playback |
| Narrator reads narration / Narrator voice | When the reading scope is "Dialogue + narration", specify the voice used for narration. When this is off or no narrator voice is set, the voice of the character of that line is used |
| Auto-play next audio | In full-response reading, continues playing the next audio already created, beyond the boundaries of responses |
| Playback volume | Specify the playback volume |

## 3. Quick Settings

Select "Text-to-speech" in "Quick settings" in the header of the conversation screen to show the text-to-speech settings. Changes are saved immediately.

![Text-to-speech in Quick settings](../images/ja/11-04-quick-settings.png)

In addition to the items shared with the Settings screen, the following items are only in Quick settings.

- **Auto read-aloud**: Creates audio for the whole response when it arrives ("5. Auto Read-Aloud" in this chapter).
- **Also play audio when a response arrives**: Plays the audio created by auto read-aloud right away. Shown when auto read-aloud is on.
- **Show playback stop button**: During playback, shows a button at the lower right of the text for stopping playback. This button stops only playback; audio creation continues.

"Gap between turns / responses" is only on the Settings screen.

## 4. Reading a Conversation Aloud

### Reading each line

Select "Read aloud" below a chat bubble to create audio for that line.

![Creating audio](../images/ja/11-05-generating.png)

- While it is being created, the button changes to "Cancel". Select "Cancel" to stop creating it.
- While other audio of the same response is being created, "Read aloud" is shown as disabled.

When the audio is created, "Play" and "Regenerate audio" are shown.

![Created audio](../images/ja/11-06-played.png)

- **Play**: Shown with the length of the audio. Select it to play. Select it during playback to stop.
- **Regenerate audio**: Creates the audio again.

### Reading the whole response

Below the "Generated by" display are "Read all" and "Delete audio".

![Read all and Delete audio](../images/ja/11-07-read-all.png)

- **Read all**: Creates audio for all lines of the response in order and plays them through. While creating, it changes to "Cancel". It is shown on every response, not only the latest one.
- **Delete audio**: Deletes all audio of that response after a confirmation. Shown when the response has audio.

During full playback, the other reading buttons are shown as disabled.

### If a line could not be read

For lines whose audio was not created, the reason is shown. The main reasons are as follows.

| Message | Description |
| --- | --- |
| No voice is assigned | No voice is linked to that character. Link a voice in "Voice link" on the "Characters" tab of Materials ([07-3 Materials: Characters](07-material-characters.md)) |
| Nothing to read | The line contains no text to be read |
| Could not create the audio. Check the voice assignment and the text-to-speech server | Creating the audio failed. Check the character's voice link and the connection with Irodori-TTS-Server. This is also shown when the linked voice is not registered on Irodori-TTS-Server |

## 5. Auto Read-Aloud

When "Auto read-aloud" is turned on in "Text-to-speech" of Quick settings, audio for the whole response is created when it arrives. When "Also play audio when a response arrives" is also turned on, the created audio is played in order.

---

Previous chapter: [10 Image Generation](10-image-generation.md) / Next chapter: [12 Settings Packs and Updates](12-settings-pack-update.md)

[Back to Contents](index.md)
