# 08 Settings

[Back to Contents](index.md)

Previous chapter: [07-5 Materials: Tags and Image Generation](07-material-image.md) / Next chapter: [09 Supporter Features](09-sponsor.md)

This chapter explains how to use the Settings screen, shown with "Settings" on the navigation bar, and the setting items in each section.

## What This Chapter Covers

1. The layout of the Settings screen and saving
2. General
3. AI & connections
4. Conversation defaults
5. Startup & system
6. Official samples
7. Account
8. Help

## 1. The Layout of the Settings Screen and Saving

Select "Settings" on the navigation bar to show the Settings screen. The sections are listed on the left, and the setting items of the selected section are shown on the right. When it is opened from the navigation bar, "General" is always selected first. When you select "Open model settings" in the "AI and model" popup at the lower left of the input field, "AI & connections" is shown.

| Section | Description | When it is shown |
| --- | --- | --- |
| General | Display language, design, message text display, send key, and more | Always |
| AI & connections | Default AI and model, the model list, API connections, and concurrency | Always |
| Conversation defaults | Default user name, temperature, and holidays, and management of emotions, parameter schemas, and text replacement | Always |
| Image & voice | Image generation and text-to-speech settings | When the image generation or text-to-speech supporter feature is enabled |
| Startup & system | Startup settings, CLI locations, update checks, and system diagnostics | Always |
| Official samples | Importing the sample settings and the templates for setting generation, and importing and exporting settings packs | Always |
| Account | Supporter feature sign-in and modules, and settings packs | Always |
| Help | The user manual and version | Always |

On narrow screens, select an item in the list of sections to switch to its setting items. Use the arrow to the left of the heading ("Back to sections") to return to the list of sections.

### Saving changes

When you change a setting item, the "You have unsaved changes" bar appears at the bottom of the screen.

![The save bar](../images/ja/08-02-save-bar.png)

- Select "Save" to save all the changes. If some items could not be saved, their names are shown after "Could not save the following:".
- Select "Revert" to discard the changes.
- If you try to move to another section or screen while there are unsaved changes, a confirmation appears where you choose "Save", "Discard", or "Back".

Some items are saved as soon as you choose them, without going through the bar. These include the three appearance items (display language, design, and brightness), "Check for updates automatically at startup", and operations inside the dialogs opened with "Manage", "Open", and "Run".

## 2. General

![General](../images/ja/08-01-general.png)

### Appearance

| Item | Description |
| --- | --- |
| Display language | Choose 日本語 or English. When you choose a language other than Japanese, the use of holiday information is turned off automatically |
| Design | Choose from "Minimal", "Japanese modern", and "Frosted glass" |
| Brightness | Choose from "Dark", "Light", and "Match device". The brightness is kept even when you change the design |

### Message text

| Item | Description |
| --- | --- |
| Font | Choose the font used for conversation text and the text editor of settings files. With "Match design", Minimal uses a gothic (sans-serif) typeface, and Japanese modern and Frosted glass use Shippori Mincho |
| Font size | Specify it in the range from 10 to 24 px |
| Line height / Empty line height | Specify the spacing between lines of text and the height of empty lines |
| Collapse consecutive blank lines | When turned on, two or more consecutive blank lines are shown as one |

### Character display and send key

- **Icon size**: Choose the size of the character image shown in chat bubbles, from 40 to 500 px.
- **Show icon to the left of the chat bubble**: Applies when the icon size is 100 px or larger.
- **Chat send key**: Choose the key combination for sending messages ([03 Your First Conversation](03-first-chat.md)).

### Background image

When the image generation supporter feature is enabled, the "Background image" field is shown. When "Session background image" is turned on, an image attached to a response is shown as the background while that response is on the screen. Details such as the opacity and display area of the background image are explained in [10 Image Generation](10-image-generation.md).

## 3. AI & Connections

![AI & connections](../images/ja/08-03-ai.png)

### AI model settings

| Item | Description |
| --- | --- |
| Default conversation preset | Choose the conversation preset loaded automatically when you start a new conversation. With "None (select manually each time)", the Setup panel is shown at startup |
| Default provider | Choose the AI selected at startup |
| Default model per provider | Choose the default model for each AI. With "Not set (CLI default)", the default model of each CLI is used |

### Edit model list

Select "Manage" for "Edit model list" to show the "Edit model list" dialog.

![Edit model list](../images/ja/08-04-models.png)

- Models are listed for each AI. Use the signal icon of each model to check connectivity, and the trash icon to delete it (built-in models are hidden instead). Hidden models are shown again with "Restore".
- Enter a model ID, display name, and description under "Add a model" at the bottom and select "Add" to add a new model to the list. This is intended for adding a newly released model without waiting for an AlSlime update.
- Confirm the changes with "Save".

~~How to add models in detail (such as specifying Thinking) is explained on the AlSlime website.~~ (currently in preparation)

### API Connections

Select "Manage" for "API Connections" to show the dialog for managing connections to OpenAI-compatible APIs. Start registering a connection with "Add connection".

![API Connections](../images/ja/08-05-api-provider.png)

| Item | Description |
| --- | --- |
| Preset | Choose from OpenRouter, OpenAI, DeepSeek, OpenCode Go, and Custom. The base URL and other values are set according to your choice |
| Name / Base URL / Auth method | The name of the connection and the information used to connect |
| API key | Enter the API key of the connection. Saved keys are not shown; to change one, enter it again. Select "Test connection" to save the entered contents and run a connection test |
| Do not use streaming | Turn this on for connections that do not support receiving responses little by little |
| Extra parameters | Specify additional values to pass to the connection |
| API instructions | Shows the instruction files for the connection. Available after the connection is saved once |

> **Note**
>
> - Pay-as-you-go services charge fees based on usage. Check the terms of each service in the provider's terms of use.
> - API keys are saved in a protected area on this device. They are not included in settings packs. They are included in backups made by copying the whole data folder ([13 Data Location and Backups](13-data.md)).

~~How to get a key for each service is explained on the AlSlime website.~~ (currently in preparation)

### Concurrency settings

Specify how many AI jobs can run at the same time.

![Concurrency settings](../images/ja/08-06-concurrency.png)

- **Global concurrency**: The limit for all AI jobs combined.
- **Concurrency per type**: The limit for each of Gemini, Claude, Antigravity, and API. The global value is the upper limit, and lowering the global value also lowers each per-type value.
- **Generations sent to ComfyUI at once**: A separate limit from the global concurrency, specified in the range from 1 to 4.

## 4. Conversation Defaults

![Conversation defaults](../images/ja/08-07-conversation.png)

| Item | Description |
| --- | --- |
| Default user name | The default name for you within conversations. When empty, "User" is used. Change it for each conversation in the relationships of the Setup panel |
| Temperature | Specify it in the range from 0.0 to 2.0. Lower values produce more consistent responses, and higher values produce more varied responses |
| Use holiday information | When turned on, Japanese holiday information is fetched and holidays are added to the date and time information passed to the AI. Shown when the display language is Japanese |

### Management

| Item | Description |
| --- | --- |
| Emotion type management | Manages the types of expressions used by the AI (see below) |
| Manage character parameter fields | Manages the parameter schemas for the individual parameters (see below) |
| Text replacement settings | Manages settings that replace fixed strings when settings files are read (see below) |
| Update character tag master | Select "Run" to recheck the works and tags of all characters and rebuild the filter lists of the Setup panel |

#### Emotion type management

![Emotion type management](../images/ja/08-08-emotions.png)

For each expression, set the emotion name, display name, description, and whether it is enabled. The emotion name is also used as the file name of the expression image. The description tells the AI in what kind of scene the expression is used.

Disabled expressions are not offered to the AI as candidates. The "default" row is fixed and cannot be edited.

Type in the empty row at the bottom to add an expression. Confirm the changes with "Save".

#### Manage character parameter fields

Select "Manage" for "Manage character parameter fields" to show the "Parameter schema editor" dialog.

![Parameter schema editor](../images/ja/08-09-schema.png)

- Choose the schema to edit in "Parameter schema file". Next to it are icons for creating, deleting, and copying schemas, and for exporting to and importing from JSON files.
- A schema consists of parameter groups and the elements in them (items such as sliders and choices). Select a group's heading to show its list of elements.
- Confirm the changes with "Save".

~~How to create schemas in detail is explained on the AlSlime website.~~ (currently in preparation)

Choose the schema to use on the Presets tab of the Setup panel ([05 Setup: Scene, Style, and Presets](05-prepare-scene.md)).

#### Text replacement settings

![Text replacement settings](../images/ja/08-10-replacement.png)

Fixed strings in settings files are replaced when the files are read. We recommend writing the replacement targets enclosed in `{{ }}`, like `{{usr}}`.

- **Replacement source**: Choose from "User name", "Character name", or "Not selected (manual input)". For manual input, enter the replacement text in "Replacement string".
- By default, `{{usr}}` is replaced with the user name and `{{char}}` with the character name.
- This replacement is also applied to the messages you send.

## 5. Startup & System

![Startup & system](../images/ja/08-11-system.png)

- **Startup settings / CLI executable paths**: Explained in [01 Installation and Startup](01-setup.md).
- **Check for updates**: Select "Run" to check for updates to the AlSlime app and the supporter feature modules ([12 Settings Packs and Updates](12-settings-pack-update.md)).
- **Check for updates automatically at startup**: When turned on, updates are checked at startup. It is on by default.
- **Debug settings**: Developer-oriented settings that keep records of AI responses.

### System diagnostics

Select "Open" for "System diagnostics" to show a dialog for checking the state of AlSlime all at once.

![System diagnostics](../images/ja/08-12-diagnostics.png)

| Section | Description |
| --- | --- |
| Build information | Version, entitlement, build, platform, bind address, port, and the data location (WORKSPACE_ROOT) |
| CLI status | Whether each CLI is detected and authenticated, and the state of the API (OpenAI-compatible) connections |
| Configuration files | Results of checking whether each settings file can be read. Use "Rescan" to check again |
| Cache / Backups | The state of the cache and backups |

Even if a CLI is detected, it may not be signed in. In that case, start the CLI in a terminal and follow the instructions shown to sign in. How to use this during troubleshooting is explained in [14 Troubleshooting](14-troubleshooting.md).

## 6. Official Samples

![Official samples](../images/ja/08-14-official-samples.png)

In "Official samples", you download the official samples from GitHub and import them.

| Item | Description |
| --- | --- |
| Sample settings | A set of characters, templates, and presets. Once imported, you are ready to start a conversation without creating any settings files. Existing files are not changed |
| Templates for setting generation | A set of templates for manual creation and instructions for setting generation. If you import with "Overwrite existing templates" turned on, templates with the same name are overwritten. If it is off, templates with the same name are not changed |

Select "Run" for "Download and import" in each item to start the import. When it is complete, the numbers of written and skipped files are shown. If the download fails, the reason is shown.

In "Settings pack" at the bottom, use "Import" and "Export" to import and export settings packs. These are explained in [12 Settings Packs and Updates](12-settings-pack-update.md).

## 7. Account

In "Account", you sign in to the supporter features, manage modules, and import and export settings packs. These are explained in [09 Supporter Features](09-sponsor.md) and [12 Settings Packs and Updates](12-settings-pack-update.md).

## 8. Help

![Help](../images/ja/08-13-help.png)

- **User Manual**: Select "Open" to show this manual in another browser tab.
- **Version**: Shows the version of the AlSlime app.

---

Previous chapter: [07-5 Materials: Tags and Image Generation](07-material-image.md) / Next chapter: [09 Supporter Features](09-sponsor.md)

[Back to Contents](index.md)
