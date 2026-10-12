# 05 Setup: Scene, Style, and Presets

[Back to Contents](index.md)

Previous chapter: [04 Setup: Characters](04-prepare-characters.md) / Next chapter: [06 Continuing a Conversation](06-continue.md)

This chapter explains the conversation preset at the top of the "Setup" panel and the settings on the "Scene", "Style", and "Presets" tabs.

## What This Chapter Covers

1. Conversation presets
2. Choosing settings files and additional settings
3. The Scene tab
4. Date/time settings
5. The Style tab
6. The Presets tab
7. Types of presets

## 1. Conversation Presets

With "Conversation preset" at the top of the panel, you can give the whole set of panel settings a name, save it, and load it when needed. The conversation preset field is shown on every tab.

### Loading a preset

1. Select "Select preset...".
2. In the "Select conversation preset" dialog that appears, choose the preset to load.

![The Select conversation preset dialog](../images/ja/05-01-preset-select.png)

The panel settings switch all at once to the contents of the selected preset.

- Use the search field in the dialog to filter presets by name. Filtering runs one second after you type or when you press the Enter key.
- If you choose "Not selected", the panel settings stay as they are and only the selected preset name is cleared.

### Saving a preset

1. Select "New save" to show the name field.
2. Enter a preset name and select "Save" or press the Enter key.

- Almost all of the panel settings are saved, including the characters taking part and their character details, the scene and style settings, the additional settings text, the date/time settings, and the user name. Temporary characters are saved together with their text. ~~The list of saved items is available on the AlSlime website.~~ (currently in preparation)
- While a preset is selected, its name is already entered in the name field. If you save with the same name as an existing preset, its contents are overwritten without a confirmation.
- After saving, the saved preset is selected.

### Deleting a preset

While a preset is selected, a trash icon is shown to the right of the "Select preset..." field. Select the icon and then "OK" in the confirmation to delete the selected preset.

### During a conversation

The contents of a preset loaded during a conversation are applied to the conversation when you select "Apply changes" at the bottom of the panel. If you send a message before applying them, the settings saved in the conversation are used, and the settings change confirmation is not shown. "Apply changes" is explained in [06 Continuing a Conversation](06-continue.md).

During a conversation, "Restore session" is shown to the left of "New save". When you select "Restore session", the changes made in the panel are discarded and the settings saved in the conversation are restored to the panel.

## 2. Choosing Settings Files and Additional Settings

On the Scene and Style tabs, the settings file selectors and the additional settings switches are laid out in the same way. "User settings" on the Characters tab works the same way.

- When you choose a settings file in a selector, another selector is added below it. You can choose up to five files for one item.
- Select the trash icon to the right of a selector to clear its selection.
- Files already chosen within the same item cannot be chosen in the other selectors.
- Turn on a switch such as "Additional world settings" to show a free-text field. Use it to add notes for each conversation that are not written in the settings files.

How to create and edit the settings files used as choices is explained in [07-1 Materials: Settings Files](07-material-files.md).

## 3. The Scene Tab

On the "Scene" tab, set the world, place, and situation where the conversation takes place.

![The Scene tab](../images/ja/05-02-scene-tab.png)

| Item | Description |
| --- | --- |
| World | Choose settings files for the world behind the conversation, such as its era and social system. Use "Additional world settings" to add free-text notes |
| Stage | Choose settings files for the place where the conversation happens, such as a shop or a school. Use "Additional stage settings" to add free-text notes |
| Situation | Choose settings files for the situation that starts the conversation, such as sheltering from the rain or meeting up with someone. Use "Additional situation settings" to add free-text notes |
| Overall additional settings | When turned on, a free-text field is shown. Write notes for the whole conversation here |
| Date/time settings | Set the date and time within the conversation. They are explained in the next section |

## 4. Date/Time Settings

In "Date/time settings" at the bottom of the Scene tab, you set how the date and time within the conversation are passed to the AI. Select the heading to show the settings.

![Date/time settings](../images/ja/05-03-datetime.png)

### Whether to pass the date and time

When "Include date/time in the prompt" is turned on, the date and time within the conversation are passed to the AI, and the items below are shown. While it is on, "Enabled" is shown to the right of the heading.

Select the lock icon next to the item name to lock this setting. While it is locked, new conversations are prepared with "Include date/time in the prompt" turned on. The lock state is kept after the next startup.

### How the time within the conversation is decided

The starting point of the time within the conversation is decided when you send the first message of the conversation. Choose the type of starting point by switching between "Current date/time" and "Fixed date/time".

- **Current date/time**: The PC's date and time at the moment you send the message is used as the starting point.
- **Fixed date/time**: The specified date and time are used as the starting point. When "Use today's date" is turned on, the date becomes today and the date selectors become unavailable. You can still specify the time.

From the second message onward, the previous time is used as the base. When the time increment is on, the time advances from the base by the specified amount; when it is off, the base time stays as it is.

### Date/time presets

When "Fixed date/time" is chosen, "Date/time presets" is shown. Select the heading to show the following operations.

- Enter a name and select the save icon to save the specified date and time.
- Choose a preset in the selector and select the folder icon to load that date and time.
- Select the trash icon and confirm to delete the selected preset.

### Time increment

When "Time increment" is turned on, the time within the conversation advances each time you send a message, as if the specified amount of time had passed.

- Specify the amount of time in hours and minutes. When "Detailed mode (years/months/days/seconds)" is turned on, also specify years, months, days, and seconds. When detailed mode is turned off, the years, months, days, and seconds are set to 0.
- When "Link relationship length to session progress" is turned on, the "relationship length" item of the individual parameters advances according to the number of days that have passed within the conversation. This setting applies when the parameter schema has a "relationship length" item.

### Session time info

When the time increment is on and a time within the conversation has been recorded, "Session time info" shows the current session time, the increment settings, and the total elapsed days.

Select the pencil icon to show a field for editing the session time. The edited time becomes the starting point when the time advances at the next message. Select × to finish editing.

### Time settings group presets

"Time settings group presets" is shown even while the date/time settings are collapsed. It saves, loads, and deletes the contents of the date/time settings as a set, including the date and time and the time increment. It is used in the same way as date/time presets.

The difference is that date/time presets save only the specified date and time, while time settings group presets save the whole contents of the date/time settings.

## 5. The Style Tab

On the "Style" tab, set how responses are written.

![The Style tab](../images/ja/05-04-style-tab.png)

| Item | Description |
| --- | --- |
| Writing style | Choose settings files that define how responses are written, such as the point of view of the narration and the balance between dialogue and description. Use "Additional writing style settings" to add free-text notes |
| Image-generation notes | Write notes to pass to the AI that analyzes the scene for image generation. They are used when the image generation supporter feature is enabled |

Image generation is explained in [10 Image Generation](10-image-generation.md).

## 6. The Presets Tab

![The Presets tab](../images/ja/05-05-preset-tab.png)

### Character preset

Saves and loads the characters taking part and their character details, the files chosen in the scene, style, and user settings, the parameter schema, and more. It differs from the conversation preset in that it mainly saves the choice of characters and files.

- Select "New save" to show the name field, enter a preset name, and select "Save". Saving with the same name overwrites the contents.
- Saved presets are shown as badges. Select a badge to load its contents.
- When there are no saved presets, "No presets yet" is shown.

### Parameter schema

Choose the combination of items (schema) shown in the individual parameters.

- When you switch the schema, the individual parameters of all characters are set to the defaults of the new schema.
- After the conversation starts, it can no longer be changed, and "Cannot be changed after the session starts." is shown.
- Select "Manage" to show the dialog for creating and editing schemas. How to use this dialog is explained in [08 Settings](08-settings.md).

## 7. Types of Presets

AlSlime has the following five types of presets, depending on what they save.

| Preset | Location | What it saves |
| --- | --- | --- |
| Conversation preset | Top of the Setup panel | The whole set of panel settings |
| Character preset | Presets tab | Settings centered on the choice of characters and files |
| Detail preset | "Status" in the character details ([04 Setup: Characters](04-prepare-characters.md)) | The status of one character |
| Date/time presets | Date/time settings (when Fixed date/time is chosen) | The specified date and time |
| Time settings group presets | Bottom of the date/time settings | The whole contents of the date/time settings |

---

Previous chapter: [04 Setup: Characters](04-prepare-characters.md) / Next chapter: [06 Continuing a Conversation](06-continue.md)

[Back to Contents](index.md)
