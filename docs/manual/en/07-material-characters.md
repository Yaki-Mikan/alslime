# 07-3 Materials: Characters

[Back to Contents](index.md) / [07 Materials](07-material.md)

Previous chapter: [07-2 Materials: Create with AI](07-material-ai-create.md) / Next chapter: [07-4 Materials: Voices](07-material-voice.md)

This chapter explains the image settings for each character, voice links, expression images, and "Test generation" on the "Characters" tab of Materials. The "Characters" tab is shown when the image generation or text-to-speech supporter feature is enabled.

## What This Chapter Covers

1. The character list
2. Image settings
3. Voice link
4. Expressions
5. Test generation

## 1. The Character List

The list of characters is shown on the left. Select a character to show its settings on the right.

- Use "Search by name" to filter by character name or work name. Use the selectors below it to filter by work ("All works", "No work", or each work) and by state ("All states", "No image settings", "Missing expressions", or "No voice"). "No voice" is shown when the text-to-speech supporter feature is enabled.
- The list is ordered as "In this chat" (characters taking part in the current conversation), "Recently used" (the last 10 characters you selected), and "All".
- To the right of each character, colored dots show the state of the image settings, expression images, and voice. Green means "Set", yellow means "Partly set", and red means "Not set".
- To set LoRA for several characters at once, select "Select multiple", choose the characters, and select "Set LoRA".

At the top of the right side are the switches for "Image settings", "Voice link", "Expressions", and "Test generation", and "Open settings file". "Voice link" is shown when the text-to-speech supporter feature is enabled, and the others when image generation is enabled. Select "Open settings file" to show that character's settings file on the "Settings files" tab.

If you choose another character without saving the image settings, a confirmation appears where you choose "Save and move", "Discard and move", or "Back".

## 2. Image Settings

In "Image settings", make the settings for drawing the character with image generation.

![Image settings](../images/ja/07-3-01-image-settings.png)

| Item | Description |
| --- | --- |
| Danbooru tag search | Searches for tags used for image generation, including searches in Japanese. Select a result to copy the tag. Turn on "Character/work only" to search only tags for character names and work names |
| Character name / work name | The character name and work name used in image generation prompts. They are shared by ComfyUI and the API service, and the output format for each is shown below. This work name is a separate item from the work used for filtering in the Setup panel (the "Info" of the settings file) |
| Aliases | If the speaker name in the conversation differs from the settings file name, specify aliases separated by commas |
| For ComfyUI / For API service | Make the following prompts separately for each image generation backend |
| Character prompt / Physical features | Write tags that describe the character's appearance. Select "Generate appearance prompt with AI" to have the AI create appearance tags by category from the text of the settings file |
| LoRA | Search for and choose LoRA used with ComfyUI, and specify the strength. Use "Fetch trigger words" to get the trigger words of a LoRA |
| Outfit settings | Register several outfits, each with a name, prompt, and outfit LoRA |
| Extra positive / Extra negative | Write prompts that are always added |
| Reference images | Register up to four reference images used with the API service. With supported models, each image incurs a cost (Anlas) |

Save changes to the image settings with "Save" on the bar at the bottom of the screen.

## 3. Voice Link

In "Voice link", link the voice used for text-to-speech to the character.

![Voice link](../images/ja/07-3-02-voice-link.png)

- **Voice**: Select it to show a searchable popup, and choose a registered voice or "(none)". Use "Preview with this character" to play the voice with the saved settings.
- **VoiceDesign caption**: Describe the voice quality in text (for example, calm, low female voice).
- **Per-character cfg override**: Select the heading to show the cfg_scale_caption and cfg_scale_speaker fields. When they are empty, the global defaults are used.

Select "Save" to save the link. This setting is saved in the character itself and applies to all conversations. How to register voices is explained in [07-4 Materials: Voices](07-material-voice.md).

## 4. Expressions

In "Expressions", register character images for each expression.

![Expressions](../images/ja/07-3-03-faces.png)

Choosing an emotion, uploading, cropping, and deleting work the same as Character image management in [04 Setup: Characters](04-prepare-characters.md).

Select "Generate expression image" to show the popup for generating expression images.

1. On the left, check the character's image generation settings and the prompts for each expression (expression settings). In the expression settings, you can save several prompts for each expression.
2. On the right, specify the workflow (ComfyUI) or generation preset (API service) and the count (up to 8 images), and select "Generate".
3. Select a generated image, select "Use selected image as expression image", and confirm to show the cropping dialog.

Use "Get sample prompt pack" in the expression settings to get sample prompts for each expression. Getting them requires signing in as a supporter.

## 5. Test Generation

In "Test generation", check the generation results of the character's image settings.

![Test generation](../images/ja/07-3-04-test-generate.png)

1. Choose the "Workflow" (ComfyUI) or generation preset (API service). This choice is not saved.
2. When "Use this character's image settings" is on, images are generated with the saved image settings. Edits that have not been saved are not used. When it is off, you switch to choosing another character or specifying with "Direct text".
3. Under "Tag selection", choose tags for each category. Turn on "Direct" to enter text instead of tags.
4. Select "Generate".

- The generated result is shown at the bottom. Select "Regenerate" to change the seed and generate again.
- In "Resolved prompt", check the positive and negative prompts actually used and the applied LoRA.
- In "Placeholder replacement", choose the settings that add fixed wording to match the scene. ~~The details are explained on the AlSlime website.~~ (currently in preparation)

---

Previous chapter: [07-2 Materials: Create with AI](07-material-ai-create.md) / Next chapter: [07-4 Materials: Voices](07-material-voice.md)

[Back to Contents](index.md)
