# 10 Text-to-Speech: Creating Voices

[Back to Contents](index.md) | [Back to 10 Text-to-Speech](10-tts.md)

This page covers creating a voice from reference audio and assigning it to a character. Note that the generated speech is Japanese; see the language notice in [10 Text-to-Speech](10-tts.md).

> **Notice**
>
> For reference audio, use audio that you own the rights to or are licensed to use. Voice cloning without the person's consent, impersonation, and deepfakes are prohibited.

## Two Ways to Prepare a Voice

- **From reference audio**: create a "latent" that captures the voice quality from an audio file of yours, and register it as a voice.
- **VoiceDesign**: without registering a voice, set a "VoiceDesign caption" on the character and describe the voice quality in words.

The two can be combined: decide the base voice with reference audio, and add the way of speaking with a caption.

## Preparing Reference Audio

- Supported formats: wav / flac / mp3 / m4a / ogg / opus / aac / webm
- Reference audio is limited to 120 seconds in total on v4-Small
- Clean, voice-only audio with little noise gives the most stable results

## Registering via Latent Generation

How to open: "TTS Settings" → "Voice registration & management" → "Latent generation".

![Latent generation](../images/ja/10-07-tts-latent.png)

1. Enter a "Voice ID". With the fork server, non-ASCII IDs can be used as well.
2. Enter a display name.
3. Choose the reference audio with the file picker. Drag & drop also works.
4. Choose "Generate latent and register".

Generation takes a little while. When it completes, the voice is added to "Registered voices" and can be previewed.

![Voice registration & management](../images/ja/10-06-tts-voices.png)

Use the other fields as needed.

| Item | Description |
| --- | --- |
| Start (s) / End (s) | The range of the reference audio to use. A blank end means to the end of the file. The selected total duration is shown |
| Device / Precision | The computing environment used for latent conversion. The defaults are usually fine |
| Normalize dB | Levels the volume of the reference audio. Blank disables it |
| Generate latent and download | Saves the latent file (.pt) without registering it, for keeping a copy |

Latent conversion accepts wav input only. For reference audio in other formats, use the direct upload below.

## Uploading Reference Audio / Latents Directly

How to open: "TTS Settings" → "Voice registration & management" → "Upload reference audio / latent".

Reference audio (all supported formats) and pre-generated latent files (.pt / .pth) can be registered as-is with a voice ID. Direct latent registration is available with the fork server.

## Writing VoiceDesign Captions

You can describe the voice quality for a character in words. Examples:

- a calm, low female voice
- a bright, energetic girl's voice, speaking rather fast
- a gentle, elderly male voice, speaking slowly

When combined with a reference-audio voice, the caption's direction is added on top of the voice quality.

## Assigning to a Character

How to open: "TTS Settings" → "Character assignment". It can also be opened from the voice settings icon in the character frame of the conversation settings sidebar.

![Character assignment](../images/ja/10-08-tts-char-assign.png)

| Item | Description |
| --- | --- |
| Character | The character to assign to |
| Voice | Choose from the registered voices |
| Preview with this character | Previews a short line with the current assignment |
| VoiceDesign caption | Adds a voice-quality description in words |
| Per-character cfg override | Open this to change the generation parameters for this character only. Blank uses the global defaults |

Choose "Save" after making changes.

## Previewing and Deleting

In "Registered voices", each voice can be previewed and deleted. When deleting, the characters currently using the voice are shown — check them before deleting.

---

[Back to 10 Text-to-Speech](10-tts.md) | [Back to Contents](index.md)
