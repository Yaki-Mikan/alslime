# 04 Setup: Characters

[Back to Contents](index.md)

Previous chapter: [03 Your First Conversation](03-first-chat.md) / Next chapter: [05 Setup: Scene, Style, and Presets](05-prepare-scene.md)

This chapter explains how to choose characters and make detailed settings on the "Characters" tab of the "Setup" panel.

## What This Chapter Covers

1. The layout of the Characters tab
2. Adding and swapping characters
3. Character details
4. Importing characters from a conversation
5. Temporary characters
6. User settings

## 1. The Layout of the Characters Tab

On the "Characters" tab of the "Setup" panel, the characters taking part in the conversation are shown as cards.

![The Characters tab](../images/ja/04-01-characters-tab.png)

- Each card shows the character's name and main status (the first two items of the individual parameters). If an image is registered for the "default" expression, that image is used as the background of the card.
- At the left edge of each card is "Swap". Selecting any other part of the card shows that character's details.
- Next to the "Characters" heading, the number of characters taking part is shown.

## 2. Adding and Swapping Characters

### Adding a character

Select "Add character" to show the "Select character..." dialog. How to use the dialog is explained in [03 Your First Conversation](03-first-chat.md). Up to five characters can take part in one conversation; when there are five, "Add character" is no longer shown.

### Swapping a character

Select the "Swap" area at the left edge of a card to show the "Select character..." dialog with the current character selected. Choose another character to swap them on the spot.

- When you swap, the individual parameters, relationships, and other settings of the previous character carry over to the new character.
- If you swap while the character details are shown, the details switch to those of the new character.

### Automatic application of linked settings

If individual personality, outfit, or background files are linked to a character, those files are applied to the individual settings automatically when you add or swap in that character. They are not applied automatically when you load a conversation preset or restore a session.

How to link files is explained in [07-1 Materials: Settings Files](07-material-files.md).

## 3. Character Details

Select a card to show that character's details. The character details are shown over the area above the buttons at the bottom of the panel, so you can still select buttons such as "Start conversation" while the details are shown.

### Header and operations

Select the arrow at the left edge of the header to return to the list of characters. Select "Reset" on the right side of the header to restore the character's individual settings, relationships, and individual parameters to their defaults and turn off the additional settings.

Below the header are the following operations.

| Operation | Description | When it is shown |
| --- | --- | --- |
| Replace | Shows the "Select character..." dialog and swaps the character. This is the same as "Swap" on the card | Always |
| Settings file | Shows this character's settings file on the "Settings files" tab of Materials | For regular characters |
| Image settings | Shows this character's image settings on the "Characters" tab of Materials | When the image generation supporter feature is enabled |
| Voice settings | Shows this character's voice link on the "Characters" tab of Materials | When the text-to-speech supporter feature is enabled |
| Remove | Removes the character from the conversation. For a temporary character, its text is also deleted | Always |
| Edit text | Edits and saves the text of a temporary character | For temporary characters |
| Register as character | Registers a temporary character as a regular character with its own settings file | During a conversation, for temporary characters that are not yet registered |

Below that, switch between "Status", "Individual", "Relationships", and "Image & voice" to choose what to show.

### Status

![The Status view of the character details](../images/ja/04-02-detail-status.png)

With the **Detail preset**, you can save the character's status as a set and load it later.

- Choose a saved preset from "Load preset..." to apply its contents. The user name saved in the preset is also restored.
- When there are saved presets, the "Delete..." field is also shown. Choose a preset in this field to delete it.
- Enter a preset name in the name field and select "Save" or press the Enter key to save the current status.

The **Individual parameters** show the items defined in the parameter schema, grouped together.

- Use each group's heading to show its contents and to choose whether to use the group in the conversation. Groups that are always used in the conversation are marked "Always enabled".
- The item types are a slider, choices, a single line of text, multiple lines of text, an on/off switch, and a date. Date items have a "Quick settings" option for choosing a period from "First meeting" to "2 years".
- Some items change their display depending on their value.

How to change the parameter schema is explained in [05 Setup: Scene, Style, and Presets](05-prepare-scene.md), and how to manage the item definitions in [08 Settings](08-settings.md).

### Individual

![The Individual view of the character details](../images/ja/04-03-detail-individual.png)

In "Individual personality", "Individual outfit and hairstyle", and "Individual background", you can choose up to five files each. Among the choices, [Local] marks files specific to that character, and [Shared] marks files shared by all characters.

Turn on "Additional personality settings", "Additional outfit and hairstyle settings", or "Additional background settings" below each item to show a free-text field. If additional settings are registered on the character side, a "Character: append" or "Character: replace" badge is shown. Hover the mouse over the badge to see the beginning of the registered text.

### Relationships

![The Relationships view of the character details](../images/ja/04-04-detail-correlation.png)

For the user and for each of the other characters taking part in the conversation, set their relationship with this character.

- **User name**: In the field for the relationship with the user, enter the user's name. The name you enter is applied to the relationships of all characters and to what is passed to the AI.
- **Relation**: Select it to show the "Select relationship" dialog, and choose a relationship from the list. Choose "Not selected" to clear the setting.
- **Details**: Describe the relationship freely.
- **Favorability**: Set it in the range from −100 to 100.

### Image & voice

![The Image & voice view of the character details](../images/ja/04-05-detail-media.png)

| Item | Description | When it is shown |
| --- | --- | --- |
| Open in Materials | Shows this character on the "Characters" tab of Materials | When the image generation or text-to-speech supporter feature is enabled |
| Include in automatic image generation | When turned off, automatic image generation on reply does not generate images for this character's lines | When the image generation supporter feature is enabled |
| Voice settings | Set the voice selection and preview, the VoiceDesign caption, and the per-character cfg override. These settings are saved in the character itself and apply to all conversations. In "Preset-side VoiceDesign" below, describe voice directions that apply only to this conversation preset, either appended or as a replacement | When the text-to-speech supporter feature is enabled |
| Character image management | Registers and deletes images for each expression | Always |

"Voice settings" and "Character image management" show their contents when you select their headings. Image generation and text-to-speech are explained in detail in [10 Image Generation](10-image-generation.md), [11 Text-to-Speech](11-tts.md), and [07-3 Materials: Characters](07-material-characters.md).

#### Registering an image for each expression

In "Character image management", register character images for each expression.

1. In the emotion selector, choose the expression to register an image for.
2. Select "Upload" and choose an image file. You can also drag an image onto the preview frame to register it. Supported formats are JPEG, PNG, and WebP, and files can be up to 5 MB.
3. In the cropping dialog that appears after you choose an image, crop the area to use as a square. Drag to adjust the position, use the slider or mouse wheel to adjust the zoom (1 to 3 times), and select "Save".

You can readjust the area of a registered image with "Crop" or delete it with "Delete". Select the icon next to the emotion selector to show the "Emotion type management" dialog, where you manage the types of expressions ([08 Settings](08-settings.md)). ~~"Delete all images for undefined emotions" at the bottom is explained on the AlSlime website.~~ (currently in preparation)

## 4. Importing Characters from a Conversation

You can analyze people who appeared in a conversation and add them to the conversation as temporary characters. Select the person icon to the right of the "Characters" heading on the Characters tab to show the "Import characters from this session" popup. This icon becomes available during a conversation once the AI has responded at least once.

![The Import characters from this session popup](../images/ja/04-06-temp-import.png)

1. In "Speakers in the conversation", select the check boxes of the speakers to import. Each speaker's number of appearances and registration status are shown; only unregistered speakers can be selected.
2. Choose the AI provider, model, and timeout (1 to 60 minutes; the default is 20 minutes) used for the analysis. For Claude, also choose Effort; for supported Antigravity models, also choose Thinking. Select "Set this model as default" to save these as the defaults for next time.
3. In "Settings template", choose the template that defines the format of the temporary characters' text.
4. Select "Run", check the details in the "Confirm import" message that appears, and select "Yes".

Speakers are analyzed one at a time, and each speaker whose analysis is complete is registered in the conversation settings as a temporary character.

- The analysis continues even if you close the popup.
- While the analysis is running, sending messages is paused.
- During the analysis, "Cancel" is shown; for speakers whose analysis failed, "Retry" is shown; and for registered speakers, "Re-analyze" is shown.
- On wide screens, you can drag the popup to move it.

## 5. Temporary Characters

A temporary character is a character that has no settings file and keeps its text inside the conversation settings. Temporary characters are created by importing from a conversation.

- They are distinguished from regular characters by the color of the card frame and the "Temp" badge.
- Showing them as a settings file, image settings, and voice settings are not available for them.
- When you save a conversation preset, temporary characters are saved together with their text.
- Edit their text with "Edit text" in the character details.
- Select "Register as character" in the character details and confirm to register the character as a regular character with its own settings file.

## 6. User Settings

In "User settings" at the bottom of the Characters tab, choose up to five files that describe who you are within the conversation. Turn on "Additional user settings" to show a free-text field.

When the image generation supporter feature is enabled, "Image generation in this conversation" is shown below it. It is explained in [10 Image Generation](10-image-generation.md).

---

Previous chapter: [03 Your First Conversation](03-first-chat.md) / Next chapter: [05 Setup: Scene, Style, and Presets](05-prepare-scene.md)

[Back to Contents](index.md)
