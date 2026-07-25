# Image Generation Settings in Detail

Refer to this guide after you can generate an image with the official samples and wish to refine the character's appearance or the result for different scenes.

## Choose the Tag Judge Format

Under "Image generation settings" → "Tag judge prompt settings", you can choose:

- **Danbooru tags only**: Suited to workflows that primarily accept tags.
- **Mixed natural language**: Suited to workflows that can describe positions and relationships between characters with short sentences.

The "Underscores" and "Spaces" choices under "Danbooru tag retrieval format" only change how copied search results are written. They can be selected independently of the tag judge prompt format.

## Refine the Character's Appearance

"Character image generation settings" lets you register:

- Character name and work name
- Alternate names used in conversation
- Physical features such as hairstyle and eye color
- Character LoRA
- Prompts and LoRA for each outfit
- Positive and negative prompts that should always be added

"Danbooru tag search" lets you search for tags in Japanese. If a LoRA newly added to ComfyUI does not appear in the list, try "Reload".

## Create Settings for Different Scenes

"Tag mapping settings" lets you change prompts and LoRA according to expressions, poses, compositions, locations, actions, and other scene elements.

- Enter a name that identifies the setting under **Match key**.
- Under **Description for AI**, describe the kind of scene in which the setting should be used.
- Under **Danbooru prompt**, enter the content to add to the image.
- You may also choose a negative prompt, LoRA, and priority workflow when needed.

When preparing several settings for similar scenes, distinct match keys make them easier to select correctly.

## Reuse Common Content

"Placeholder presets" let you collect quality, style, and other content that you want to reuse across multiple workflows.

1. Under "Source", enter the name of a placeholder written in the workflow.
2. Under "Replacement", enter the content to add to the image.
3. To use it only for certain scenes, add a "Description for AI".
4. Save the preset, then choose it under "Placeholder replacement" in "Image generation test".

For instructions on adding custom placeholders to a workflow, see [Preparing a Custom Workflow](09-comfyui-custom-workflow.md).

## Adjust the Tag Directive

The tag directive file tells the AI which parts of the conversation to read and what kind of content to reflect in the image.

When using the official samples, you can begin with the provided file unchanged. To adjust it yourself, open "Tag directive file" from "Image generation settings".

## Use the Integrated Settings

On a wide screen, "Image generation settings" lets you work with character settings, tag mappings, tag directives, and test generation in one view.

![Integrated image generation settings](../images/ja/09-02-integrated-settings.png)

Save the settings on the left before checking the result with "Image generation test" on the right.

---

[Return to 09 ComfyUI Integration](09-comfyui.md)
