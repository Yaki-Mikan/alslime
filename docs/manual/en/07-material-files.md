# 07-1 Materials: Settings Files

[Back to Contents](index.md) / [07 Materials](07-material.md)

Previous chapter: [07 Materials](07-material.md) / Next chapter: [07-2 Materials: Create with AI](07-material-ai-create.md)

This chapter explains how to create and edit settings files for characters, scenes, and more on the "Settings files" tab of Materials.

## What This Chapter Covers

1. The screen layout
2. The list
3. Editing and saving the text
4. Fill in fields
5. The side panel
6. Templates
7. AI instructions

## 1. The Screen Layout

Select "Materials" on the navigation bar to show the Materials screen with the "Settings files" tab.

![The Settings files tab](../images/ja/07-1-01-files.png)

The screen consists of three areas.

- **The list on the left**: Settings files are listed by type.
- **The text in the center**: The name and contents of the file selected in the list are shown.
- **The side panel on the right**: Handles settings other than the text, such as a character's work and tags, expression images, and links. For types other than characters, only "Edit by chat" is shown, and for templates and AI instructions, the side panel is not shown.

On narrow screens, the list is shown over the text with the "List" icon at the upper left of the text. The text and the side panel switch to tabs, with "Content" and each side panel tab side by side.

## 2. The List

Use the chips at the top of the list to switch the group of types shown.

| Group | Types included |
| --- | --- |
| Characters | Character |
| Scenes | Worldview, Stage, Situation |
| Individual | Individual personality, Individual outfit / hair, Individual background |
| Users & jobs | User settings, Occupation settings |
| Styles | Writing style |
| AI instructions | AI provider instructions, Auto-generation instructions, Image generation analysis instructions (Image generation analysis instructions appear when the image generation supporter feature is enabled) |

- In the list, each type has a subheading with the number of files, followed by its files. Select a file to show its contents in the text area.
- Select "＋" to the right of a subheading to start creating a new file of that type. You can select it even for types that have no files yet.
- Select "New" to start creating a new file of the selected type from the contents of its default template. The subheading of the selected type is shown in the highlight color.
- Use "Search by name" to filter by part of the file name.
- "Create with AI" is explained in [07-2 Materials: Create with AI](07-material-ai-create.md).

### Adding files

Drag and drop .md files from your PC onto the list to add them to the selected type.

- While you drag files over the list, "Drop .md files here to add them: (type name)" is shown with the type the files will be added to.
- If a file with the same name already exists, the file is added with a name in the form "Name (2)".
- Files are not added while the template list is shown or for AI instructions.

## 3. Editing and Saving the Text

The bar above the text shows the file name and the save state ("Saved" or "Unsaved changes"). For a new file, enter the file name in the name field of the bar.

| Operation | Description |
| --- | --- |
| Save | Saves the changes to the text and to the "Info", "Image", and "Links" tabs of the side panel together. You can also save with Ctrl+S. If a file with the same name exists, an overwrite confirmation is shown |
| Save as a new file | Enter a name in the field that appears to save it as a separate file. On narrow screens, only the icon is shown |
| More | The "…" icon at the right end of the bar shows the following menu |

![The More menu](../images/ja/07-1-03-more.png)

The "More" menu contains the following items.

- **Rebuild from template "name"**: Recreates the text with the contents of the chosen template. Shown when the type has templates.
- **Import .md files**: Adds .md files from your PC to the selected type. The type the files will be added to is shown in parentheses after the item name. You can choose several files at once.
- **Export**: Saves the current text to your PC as an .md file.
- **Delete this file**: Deletes the current file after a confirmation.

In the text editor, press Ctrl+F to find and Ctrl+H to replace.

If you try to move to another file or type while there are unsaved changes, a confirmation appears where you choose "Save and move", "Discard and move", or "Back".

## 4. Fill in Fields

For the character type, switch the editing style with "Edit text" and "Fill in fields" on the bar. In "Fill in fields", items such as the name, its reading, and age are arranged in sections, and you create the character's settings by filling in the items.

![Fill in fields](../images/ja/07-1-02-form.png)

> **Note**
>
> "Fill in fields" does not read the existing text and starts from empty items. When you switch to "Edit text", a confirmation appears, and you choose one of the following.
>
> - **Yes**: Replaces the text with the contents of the items, then switches.
> - **No**: Discards the item input and switches with the original text.
> - **Cancel**: Continues entering items.
>
> Even if you choose "Yes" for an existing file, the file is not changed until you select "Save". "Fill in fields" is intended for creating a new character from scratch.

## 5. The Side Panel

The side panel has the following tabs depending on the type. For a new file, tabs other than "Info" are not available until the file is saved once.

| Tab | Description | When it is shown |
| --- | --- | --- |
| Info | Sets the character's work and tags. The work and tags are used to filter characters when choosing characters in the Setup panel. Press the Enter key in the input field to add a tag, and select × on its chip to remove it | Characters |
| Edit by chat | Asks the AI to revise the text (see below) | Saved files |
| Expressions | Registers character images for each expression. It works the same as Character image management in [04 Setup: Characters](04-prepare-characters.md) | Characters |
| Image | Makes the character settings used for image generation ([07-3 Materials: Characters](07-material-characters.md)) | Characters, when the image generation supporter feature is enabled |
| Voice | Links the voice used for text-to-speech. Save it with the save button inside the tab ([07-3 Materials: Characters](07-material-characters.md)) | Characters, when the text-to-speech supporter feature is enabled |
| Links | Links individual settings files to the character (see below) | Characters |

- Select the icon to the right of the side panel heading to switch between showing the tabs one at a time and stacking the sections vertically (characters only). In the stacked layout, "Expressions" comes first, and at first only "Expressions" shows its contents. The layout and whether each section is open are remembered by the browser.
- Tabs with unsaved changes (or section headings in the stacked layout) are marked with "●".

### Links

In "Links", choose the files to link to the character for each of individual personality, individual outfit and hairstyle, and individual background, and enter the character-side additional settings.

![The Links tab](../images/ja/07-1-05-linked.png)

- **Linked files**: When you choose a file in a selector, another selector is added, so you can link several files. Select the trash icon to the right of a selector to clear its selection.
- **Character-side additional settings**: Consists of a free-text field and a choice between "Append" and "Replace". With "Append", this text is added after the additional settings in the Setup panel. With "Replace", only this text is used instead of the additional settings in the Setup panel.

When you add or swap in this character in the Setup panel, the linked files are applied to the individual settings automatically ([04 Setup: Characters](04-prepare-characters.md)). Save changes to the links with "Save" on the text bar.

### Edit by chat

In "Edit by chat", tell the AI how to revise the current file, and it revises the text.

![The Edit by chat tab](../images/ja/07-1-04-dialog.png)

1. In the input field at the bottom, enter what to change (for example, make the tone a little softer).
2. If needed, choose the AI and model under "AI" below the input field.
3. Select "Send". If there are unsaved changes, the button shows "Save and send", and the changes are saved before sending.

When the AI finishes revising, the revised text is saved to the file and the displayed text is updated.

- Below "The AI updated the text", the number of changed lines is shown. Select "Undo" to restore and save the text from before sending. Select "Show changes" to show the differences from the text before sending.
- At the top, the number of conversation turns for this file is shown. Select "Start a new conversation" and confirm to clear the record of the conversation so far. The text is not changed.
- If the file was rewritten elsewhere before sending, sending is stopped to prevent overwriting. Select "Reload the text", check the contents, and send again.

## 6. Templates

Select "Templates" in the list to show the templates of the selected type. Select it again to return to the list of settings files.

![The template list](../images/ja/07-1-06-templates.png)

- The list shows templates under "Templates for (type name)", and the default template is marked with a "Default" badge. The default template is used as the contents when you start creating a file with "New".
- Start creating a new template with "New template", and save it with "Save" or "Save as a new file" on the text bar.
- The "More" menu contains "Make default template", "Delete this template", and "Export".

### Importing a template pack

Select "Import template pack" at the bottom of the template list to download and import a set of templates for manual creation and instructions for automatic settings generation from the internet.

- If you import with "Overwrite existing templates" selected, templates with the same name are overwritten. If it is not selected, templates with the same name are not changed.
- When the import is complete, the number of imported files is shown.
- The same set can also be imported with "Templates for setting generation" under "Official samples" in Settings ([08 Settings](08-settings.md)).

## 7. AI Instructions

In the "AI instructions" group, you edit the instruction files that AlSlime passes to the AI. These files can only be rewritten; creating new ones, deleting them, and renaming them are not available.

Changing the instructions can greatly affect the results of conversations and automatic settings creation. ~~The role of each file and how to edit it are explained on the AlSlime website.~~ (currently in preparation)

---

Previous chapter: [07 Materials](07-material.md) / Next chapter: [07-2 Materials: Create with AI](07-material-ai-create.md)

[Back to Contents](index.md)
