# 10 Text-to-Speech Settings Reference

[Back to Contents](index.md) | [Back to 10 Text-to-Speech](10-tts.md)

This page covers each item in "TTS Settings" and the text-to-speech panel in the left menu of the chat screen.

How to open: Config File Editor → "TTS Settings" tab. It can also be opened from Settings (gear) → "TTS settings".

## Connection

The connection to Irodori-TTS-Server.

| Item | Description |
| --- | --- |
| Endpoint URL | The Irodori-TTS-Server endpoint. The default is `http://127.0.0.1:8088`. A server on another PC can also be specified |
| API key (remote connections only) | Enter this when connecting to a server on another PC with an API key. When configured, "Configured (enter only to change)" is shown, and you only enter it again to change it |
| Connection timeout (seconds) | The wait time for connection checks. Usually no change is needed |

"Test connection" checks the following three items in order.

- **Server response**: whether the server responds
- **Model list**: whether model information can be retrieved
- **Voice list**: whether the list of registered voices can be retrieved

The model name, model state (not loaded / loading / loaded), and the number of registered voices are shown as well. "Model state: not loaded" is not an error — the model is loaded automatically at the first generation.

## Engine Management

Operates the model and runtime mode of Irodori-TTS-Server from AlSlime. **Available only while connected to the fork server.**

![Engine management](../images/ja/10-03-tts-engine.png)

| Item | Description |
| --- | --- |
| Model | Choose the model to use. "Load selected model" loads it in advance; "Offload" releases it from memory |
| Runtime mode | Switches between the normal mode and the low-memory mode. "Apply" applies it, and the current state is shown as "Active" |
| Restart server | Restarts Irodori-TTS-Server. Audio generation in progress is interrupted, so confirm before running |

The low-memory mode helps in environments with little VRAM or when using image generation at the same time. Changing the runtime mode may require a server restart to take effect; follow the on-screen guidance.

While connected to the official server, "The connected server does not support the engine management (runtime) API." is shown.

## Reading Scope & Narrator

The reading targets and how playback behaves. Changes are saved immediately.

![Reading scope & narrator](../images/ja/10-05-tts-read-behavior.png)

| Item | Description |
| --- | --- |
| Reading scope | Choose "Dialogue only" or "Dialogue + narration" |
| Audio format | wav (default) or mp3. mp3 requires an mp3 encoder (FFmpeg) on the Irodori-TTS-Server side. The change applies to subsequent generations |
| Silence between chunks (sec) | The silence at the seams when a long sentence is generated in parts. Used both for the silence inserted into merged audio and for the interval of sequential playback |
| Gap between turns / responses (sec) | The pause between audio files during continuous playback. Applies from the next playback |
| Narrator reads narration | Whether narration is read with the narrator voice when the reading scope is "Dialogue + narration" |
| Narrator voice | The voice that reads narration. When unset, narration is read with the character's voice for that block |
| Auto-play next audio | During continuous playback, continues playing the next generated audio beyond the response boundary |
| Playback volume | The playback volume of the generated speech |

## Style Directive (Emotion via Emojis)

Enable "Irodori-TTS style directive", and the AI adds supported emojis to sentences so emotions are carried into the generated speech. The emojis are always removed from the display and image generation, and are used only for speech synthesis. Changes are saved immediately.

### How it works

- Emojis act as performance directions for the speech synthesizer. The emojis themselves are not pronounced.
- An emoji affects the emotion and tone of the sentence that follows it.

### Supported emojis

The meanings below describe the effect on the Japanese speech.

| Category | Emojis and meanings |
| --- | --- |
| Breath & voice quality | 👂 whisper / 😮‍💨 sigh, breath / 😮 gasp / 🌬️ heavy breathing / 🥱 yawn |
| Acoustic effects | ⏸️ pause, silence / 📢 echo, reverb / 📞 voice over the phone |
| Laughter & joy | 🤭 laughter / 😆 joyfully / 😊 cheerfully, happily |
| Sadness & pain | 😭 sobbing, crying voice / 😱 scream / 😠 angrily, discontented / 😖 in pain |
| Emotion & attitude | 😏 teasingly, sweetly / 🥺 trembling, unconfident / 🥵 moaning, groaning / 🫶 gently / 😪 sleepily / 😴 sleep talk, snoring / 😰 flustered, nervous / 😲 surprised, amazed / 🫣 shyly / 🙄 exasperated / 😎 proudly, confidently / 😌 relieved, satisfied / 🤔 questioning voice / 😟 worriedly |
| Speaking speed | ⏩ fast, hurried / 🐢 slowly |
| Mouth sounds | 👅 licking, chewing, wet sounds / 💋 lip noise / 🥤 swallowing / 😒 tongue click / 🤧 coughing, sniffing, sneezing |
| Others | 👌 nodding sound / 💥 forcefully / 🙏 pleadingly / 🥴 drunk / 🎵 humming / 🤐 muffled / 💪 with strength / 👃 sniffing / 📖 narration, monologue |

## Text-to-Speech Panel in the Left Menu

A panel opened from the menu at the top left of the chat screen. It appears while the display language is Japanese, and lets you adjust the frequently used items while you chat.

![Text-to-speech panel in the left menu](../images/ja/10-13-tts-drawer.png)

| Item | Description |
| --- | --- |
| Reading scope / Audio format / Silence between chunks | Reads and writes the same values as "TTS Settings" |
| Auto read-aloud | Generates audio automatically for each new response |
| Also play audio when a response arrives | Plays the automatically generated audio right away |
| Show playback stop button | Shows a button to stop playback on the screen |
| Auto-play next audio / Playback volume | Reads and writes the same values as "TTS Settings" |
| Narrator reads narration / Narrator voice | Reads and writes the same values as "TTS Settings" |
| Irodori-TTS style directive | Reads and writes the same value as "TTS Settings" |

## Fork vs. Official Server

| Feature | Fork | Official |
| --- | --- | --- |
| Speech generation & playback | ○ | ○ |
| Non-ASCII voice IDs | ○ | × (ASCII letters, numbers, hyphens, and underscores only) |
| Direct registration of latent files | ○ | × ("Generate and download" still works) |
| Engine management (model switching, low-memory mode, restart) | ○ | × |

AlSlime detects which server you are connected to and shows guidance on the screen for unavailable features.

---

[Back to 10 Text-to-Speech](10-tts.md) | [Back to Contents](index.md)
