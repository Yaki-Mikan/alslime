# 14 Troubleshooting

[Back to Contents](index.md)

Previous chapter: [13 Data Location and Backups](13-data.md)

This chapter explains what to check and how to deal with problems such as AlSlime not starting or responses not coming back.

## What This Chapter Covers

1. AlSlime does not start or quits right after starting
2. Responses do not come back
3. Checking with system diagnostics
4. Jobs do not progress
5. The screen of the previous version is shown

## 1. AlSlime Does Not Start or Quits Right After Starting

When AlSlime fails to start, it shows the reason in the console and quits. On Windows, the console window may close immediately, making it hard to read the reason. In that case, check the reason with the following steps.

1. Start Command Prompt.
2. In `cd /d "folder where AlSlime was extracted"`, replace the text inside the quotation marks with the actual location of the folder. Keep the quotation marks, enter the command, and run it to move to the AlSlime folder.
3. Enter `alslime.exe` and run it. The reason for quitting stays shown in the window.

The main reasons and how to deal with them are as follows.

| Example of the message | Cause | What to do |
| --- | --- | --- |
| "The server stopped abnormally" followed by details about the port being in use | Another application is using the same port | Quit the application that uses the same port. Alternatively, change the port in the startup settings |
| "The server settings JSON is invalid" | The startup settings file is corrupted | Rename `roleplay/global/settings/server-settings.json` in the data folder to set it aside. When there is no startup settings file, AlSlime starts with the default values. After starting, set them again under "Startup & system" in Settings |
| "Failed to initialize the workspace" | Writing to the data folder is not allowed | Move AlSlime to a folder where writing is allowed and start it there |

While AlSlime is running, change the port in "Startup settings" under "Startup & system" in Settings ([01 Installation and Startup](01-setup.md)). If it does not start, change the `port` value in `server-settings.json`.

## 2. Responses Do Not Come Back

- If getting a response fails, or if the AI does not respond for 10 minutes and it times out, get the response again with "Regenerate" ([03 Your First Conversation](03-first-chat.md)).
- If the AI's response was empty, a message saying so is shown where the response would be. In this case too, get the response again with "Regenerate".
- While AlSlime is updating, messages are not accepted. Send again after the update is complete.
- If the same problem continues, check the state of the AI CLI you are using in system diagnostics ("3. Checking with System Diagnostics" in this chapter).

## 3. Checking with System Diagnostics

Check the state of AlSlime all at once with "System diagnostics" under "Startup & system" in Settings. The contents of each item are explained in [08 Settings](08-settings.md). The main places to check are as follows.

| Place to check | Contents and what to do |
| --- | --- |
| CLI status | Shows whether each AI CLI was found and whether it is signed in. If it is not found, specify the location of the CLI ([01 Installation and Startup](01-setup.md)). If it is not signed in, sign in with the CLI following the instructions shown |
| Configuration file check | Shows problems with settings files. After fixing the files, check again with "Rescan" |
| Data folder | Shows whether writing to the data folder is possible |

## 4. Jobs Do Not Progress

If jobs such as AI responses or image generation do not progress, select "○ running" in the header of the conversation screen to show "Job progress" ([06 Continuing a Conversation](06-continue.md)).

- Stop running jobs with "Stop", and cancel pending jobs with "Cancel".
- If many jobs are pending, adjust the limit on the number of jobs running at the same time in "Concurrency settings" in [08 Settings](08-settings.md).

~~Where job records are saved and how concurrency works in detail are explained on the AlSlime website.~~ (currently in preparation)

## 5. The Screen of the Previous Version Is Shown

After updating AlSlime to a new version, the screen of the previous version may still be shown even after selecting "Reload" ([02 Understanding the Screen](02-screen.md)). In that case, delete the site data for the address of the AlSlime screen (such as `http://127.0.0.1:3000`) in your browser settings, and then show the screen again.

---

Previous chapter: [13 Data Location and Backups](13-data.md)

[Back to Contents](index.md)
