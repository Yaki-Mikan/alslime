# 13 Data Location and Backups

[Back to Contents](index.md)

Previous chapter: [12 Settings Packs and Updates](12-settings-pack-update.md) / Next chapter: [14 Troubleshooting](14-troubleshooting.md)

This chapter explains where AlSlime saves its settings and conversation history, and the key points for backing up and moving to another PC.

## What This Chapter Covers

1. The data folder
2. Information to exclude when sharing
3. Editing settings files directly
4. Backups and moving

## 1. The Data Folder

AlSlime saves its settings and conversation history in the "data folder".

- If the environment variable `WORKSPACE_ROOT` is set, that folder becomes the data folder. If it is not set, the data folder is the working folder at the time AlSlime starts (when started from a terminal, the folder open in the terminal at that time).
- On Windows, when AlSlime is started from `start-alslime.bat`, the folder containing `start-alslime.bat` (the folder where AlSlime was extracted) becomes the data folder.
- After updating the app and restarting, the same data folder continues to be used.
- Check the current data folder in "Build information" of "System diagnostics" under "Startup & system" in Settings ([08 Settings](08-settings.md)).

The main contents of the data folder are as follows.

| Location | Contents |
| --- | --- |
| `roleplay/` | Settings files such as characters, presets, conversation history, and text-to-speech audio |
| `modules/` | Supporter feature modules |
| `configgen_workspace/` | The work area for automatic settings creation ("Create with AI" in Materials) |
| Instruction files directly under the folder | Base instruction files for the AI, read by each AI CLI |

Generated images are saved not in the data folder but in `.gemini/tmp/<identifier>/chats/images/` in your home folder (the folder for each OS user).

~~The detailed contents of each folder and the list of files deleted automatically are explained on the AlSlime website.~~ (currently in preparation)

## 2. Information to Exclude When Sharing

`roleplay/auth/` stores secret information such as the API keys of API connections, the API service token, and the sign-in information of the supporter features.

- Settings packs do not include this information.
- If you copy the whole data folder, `roleplay/auth/` is included. When you give the data folder to someone else or save it in a shared location, exclude `roleplay/auth/`.

## 3. Editing Settings Files Directly

Settings files for characters, worlds, and so on (in Markdown format) can also be edited directly with a text editor. You can also create subfolders to organize them.

~~Where each type of settings file is placed and the conditions for appearing in the choices are explained on the AlSlime website.~~ (currently in preparation)

To edit them inside AlSlime, use the "Settings files" tab of Materials ([07-1 Materials: Settings Files](07-material-files.md)).

## 4. Backups and Moving

| Purpose | Method |
| --- | --- |
| Move or share only the settings to another PC | Export a settings pack and import it on the destination ([12 Settings Packs and Updates](12-settings-pack-update.md)) |
| Keep or move everything | Copy the whole data folder. Include not only `roleplay/` but also the instruction files directly under the folder, `modules/`, and `configgen_workspace/`. If you use image generation, also copy the folder where generated images are saved in your home folder |

Data copied as a whole folder includes secret information. Notes on handling it are given in "2. Information to Exclude When Sharing" in this chapter.

---

Previous chapter: [12 Settings Packs and Updates](12-settings-pack-update.md) / Next chapter: [14 Troubleshooting](14-troubleshooting.md)

[Back to Contents](index.md)
