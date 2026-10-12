# 07-5 Materials: Tags and Image Generation

[Back to Contents](index.md) / [07 Materials](07-material.md)

Previous chapter: [07-4 Materials: Voices](07-material-voice.md) / Next chapter: [08 Settings](08-settings.md)

This chapter explains how to manage tags, workflows, and generation presets on the "Tags" and "Image generation" tabs of Materials. Both tabs are shown when the image generation supporter feature is enabled.

## What This Chapter Covers

1. Tags
2. Image generation: ComfyUI
3. Image generation: API service

## 1. Tags

In image generation, the AI analyzes the conversation scene, chooses matching tags, and builds a prompt. On the "Tags" tab, register the candidate tags for each category.

![The Tags tab](../images/ja/07-5-01-tags.png)

### Categories and the tag table

- On the left, categories such as expression, pose, and composition are listed with the number of tags in each. Select a category to show its tag table in the center. Use "Add category" to add a category by entering an ID (letters, digits, _ and -) and a name.
- The table shows the match key, the Danbooru term, LoRA, trigger words, where the tag is used (ComfyUI, API), and whether it is enabled. The LoRA and trigger word columns are shown when ComfyUI is used.
- Use "Search tags" to filter by match key, Danbooru term, or description for the AI.
- When there are no unsaved changes, switching "Enabled" is saved immediately.
- Add a tag row with "Add new", and save the contents of the table together with "Save".
- In "LoRA directory for this category", specify the location within the ComfyUI LoRA folder that is used as candidates when choosing LoRA.

### Edit selected tag

Select a row in the table to show "Edit selected tag" on the right.

| Item | Description |
| --- | --- |
| Match key | The name used by the AI analyzing the scene when it chooses tags |
| Description for AI | A description that tells the AI in what kind of scene to use this tag |
| Danbooru prompt | The wording added to the prompt |
| Negative prompt | The wording added to the negative prompt when this tag is used |
| Used for | Choose the image generation backends (ComfyUI, API) that use this tag |
| LoRA | Choose the LoRA applied when this tag is used, and specify the strength. Shown when ComfyUI is used |

Use "Danbooru tag search" at the top of the right side to search for tags, including searches in Japanese. Select a result to copy the tag. If you try to move to another tag or category while there are unsaved changes, a confirmation appears where you choose "Save and move", "Discard and move", or "Back".

## 2. Image Generation: ComfyUI

Use "ComfyUI" and "API service" at the top of the "Image generation" tab to switch the backend to edit. You can edit both regardless of which backend you are currently using.

![Managing workflows](../images/ja/07-5-02-workflow.png)

### Saved workflows

On the left, the imported workflows are listed. Below each workflow, the uses it is assigned to are shown as badges.

- **Import a workflow**: Drag and drop a JSON file saved with ComfyUI's "Save (API Format)" onto the frame, or select the frame to choose it. Enter a name and select "Add" to import it.
- **Export / Delete**: Saves the selected workflow as a JSON file, or deletes it. When you delete a workflow that is assigned to a use, that is indicated.
- **Use as default for chat images**: Makes it the default workflow used for image generation in conversations.
- **Use for expressions**: Makes it the workflow used for generating expression images.

### Workflow for each instruction format

Assign the workflow to use for each instruction format used when analyzing the scene (first-person view, third-person view, and so on). Formats set to "Common" use the default workflow for chat images.

### Replacements

In "Replacements", choose the settings (placeholder preset) that add fixed wording to the prompt to match the scene. Choose "None" to perform no replacements. Edit the contents of the settings with "Edit replacements". ~~How replacements work and how to set them are explained on the AlSlime website.~~ (currently in preparation)

## 3. Image Generation: API Service

In "API service", manage the generation presets used when generating images with an API service such as NovelAI.

![The generation presets of the API service](../images/ja/07-5-03-api-presets.png)

- **Preset for each instruction format**: Assign the generation preset to use for each instruction format. Formats set to "Common" use the common preset.
- **Common preset / Preset for expressions**: Choose the generation presets used for chat images and expression images.
- **Editing generation presets**: Choose the generation preset to edit in "Preset", and set the resolution, prompt layout, number of steps, and more. Use the icons next to it to create, duplicate, rename, and delete presets.

Depending on the settings, generation may exceed the free range of the API service and incur costs. In that case, a warning is shown on the screen. ~~The meaning of each item is explained in detail on the AlSlime website.~~ (currently in preparation)

Image generation settings and how to use image generation in conversations are explained in [10 Image Generation](10-image-generation.md).

---

Previous chapter: [07-4 Materials: Voices](07-material-voice.md) / Next chapter: [08 Settings](08-settings.md)

[Back to Contents](index.md)
