# 10 Image Generation

[Back to Contents](index.md)

Previous chapter: [09 Supporter Features](09-sponsor.md) / Next chapter: [11 Text-to-Speech](11-tts.md)

This chapter explains image generation, which turns conversation scenes into images: the preparation flow, the settings, and how to use it in conversations. Image generation is used when the image generation supporter feature is enabled ([09 Supporter Features](09-sponsor.md)).

## What This Chapter Covers

1. The flow to get started
2. Image generation on the Settings screen
3. Quick settings
4. Generating images in a conversation
5. Automatic image generation on reply
6. Viewing generated images
7. Background images
8. Image generation in this conversation

## 1. The Flow to Get Started

In image generation, the AI analyzes the conversation scene and builds a prompt, and the image is generated with ComfyUI or an API service. The flow to get started is as follows.

1. Sign in to the supporter features and get the image generation integration module ([09 Supporter Features](09-sponsor.md)).
2. Prepare the image generation backend.
   - **ComfyUI**: Start ComfyUI and specify its address on the Settings screen. ~~How to install ComfyUI is explained on the AlSlime website.~~ (currently in preparation)
   - **API service**: Save the API token on the Settings screen and run a connection test. ~~How to get an API token is explained on the AlSlime website.~~ (currently in preparation)
3. In Materials, prepare workflows or generation presets and tags ([07-5 Materials: Tags and Image Generation](07-material-image.md)). Make the image settings for each character on the "Characters" tab of Materials ([07-3 Materials: Characters](07-material-characters.md)).
4. Choose the AI that reads the scene ("2. Image Generation on the Settings Screen" in this chapter).
5. Select "Generate image" on a chat bubble in the conversation.

## 2. Image Generation on the Settings Screen

Make the overall image generation settings under "Image generation" in "Image & voice" in Settings. When text-to-speech is also enabled, switch the display with "Image generation" and "Read aloud" at the top. Image settings for each character, tags, and workflows are managed in Materials; use "Open characters" to show the "Characters" tab of Materials.

### Connection

![The Connection field](../images/ja/10-01-connection.png)

Choose the image generation backend with "ComfyUI" and "API service" at the top of the field. Your choice is saved immediately.

| Item | Description | When it is shown |
| --- | --- | --- |
| ComfyUI address | Enter the address of ComfyUI. Use "Test" to check the connection. The default port of ComfyUI is 8188 | ComfyUI |
| LoRA folders | Specify the names of the subfolders for each category (character, expression, composition, and so on) inside the ComfyUI LoRA folder. "Reset" restores the default names | ComfyUI |
| Connection settings | Enter the API token and save it with "Save token". When you check the connection with "Test connection", the plan, Anlas balance, free allowance, expiration date, and more are shown. Delete the saved token with "Delete token" | API service |
| Model | Choose the model used with the API service. Your choice is saved immediately | API service |
| Auto sound effects | The AI decides whether sound effects are needed and what they say, and adds them to the generation instructions | API service, when a supported model is selected |
| API service balance | Shows the plan, Anlas balance, free allowance, and more. Use "Refresh balance" to get the latest values | API service |

### Tags and workflows

In the field below "Connection", choose the format for getting tags and trigger words (Underscore, Space, For Anima, and so on). The format choice is shown for ComfyUI. Use "Open tags in Materials" and "Open workflows in Materials" to show the corresponding tabs of Materials.

### When creating images from chat

![The When creating images from chat field](../images/ja/10-02-analysis.png)

| Item | Description |
| --- | --- |
| AI that reads the scene | Choose the AI (analysis AI) and model that analyze the conversation history and choose the tags used for image generation. Depending on the AI, also choose how deeply it thinks (effort and so on) |
| Tag judge timeout (seconds) | Specify how long to wait for the scene analysis, in the range from 30 to 1800 seconds |
| Instruction format | Choose from six formats of the instructions sent to the AI when analyzing the scene: mixed natural language (first-person view and third-person view, and a short version of each) and Danbooru tags only (first-person view and third-person view). Mixed natural language suits models that follow natural-language instructions well, such as Anima. It is set separately for ComfyUI and the API service |
| Image generation job unit | With "Analysis and generation as one job", the analysis of the next image starts after the current image has been generated. With "Separate analysis and generation", the analysis of the next image starts as soon as the analysis of the current image is complete, and generation requests are sent one image at a time in order |

Messages can still be sent in the conversation while image generation is waiting or running.

### Your appearance

For the API service, the "Your appearance" field is shown. These are settings for drawing the user (you, within the conversation) as a person in images: the names that refer to the user in the conversation, the appearance prompts, and reference images. The items are the same as the character image settings in Materials ([07-3 Materials: Characters](07-material-characters.md)). With supported models, each reference image incurs a cost (Anlas). These settings are not used for generation with ComfyUI.

### Saving images

For ComfyUI, the "Saving images" field is shown. Turn on "Override save format during image generation" and then specify the format of generated images (AVIF, WebP, or PNG) and the quality. This setting is applied to workflows that contain the "Yakimikan Save Image Lightweight" node, which saves images.

## 3. Quick Settings

Select "Quick settings" in the header of the conversation screen to show the image generation settings shared by all conversations on the right side of the screen. Each item shows its contents when you select its heading, and changes are saved immediately.

![Tag judge & generation settings in Quick settings](../images/ja/10-03-quick-settings.png)

- **Tag judge & generation settings**: Choose the image generation backend (ComfyUI or API service), the AI that reads the scene, and the instruction format. Specify the workflow to use (the generation preset for the API service) for each instruction format. When "Common" is chosen, the common workflow is used for ComfyUI, and the common generation preset for the API service.
- **API service balance**: Shows the balance and more for the API service.
- **Image generation job unit**: Contains the same choices as the Settings screen, plus "Generate images automatically on reply" and "Tag enable/disable settings".

![Image generation job unit in Quick settings](../images/ja/10-10-auto-generate.png)

In "Tag enable/disable settings", switch tags on or off across categories. Disabled tags are not used for scene analysis or generation. Changes are saved immediately. Use "Edit in Materials" to show the "Tags" tab of Materials.

## 4. Generating Images in a Conversation

Select "Generate image" below a chat bubble in the conversation to turn the scene of that chat bubble into an image.

![Generating an image](../images/ja/10-04-generating.png)

- While it is being processed, the button shows "Queued", "Analyzing", "Waiting to render", and "Rendering" in turn.
- If you then select "Generate image" on another chat bubble, it is queued and processed in order.
- While processing, a badge such as "1 running" is shown in the header. Select the badge to show Job progress ([06 Continuing a Conversation](06-continue.md)).
- The "Generate image" button is shown after the conversation is saved and while no response is being generated.
- If generation fails or does not finish within 5 minutes, that is shown on the screen.

## 5. Automatic Image Generation on Reply

When "Generate images automatically on reply" is turned on in "Image generation job unit" of Quick settings, image generation for each chat bubble is queued from top to bottom when a response arrives. If the connection to the image generation backend cannot be confirmed, nothing is queued and that is shown.

Specify which characters are targeted by automatic image generation individually with "Include in automatic image generation" in the character details of the Setup panel ([04 Setup: Characters](04-prepare-characters.md)).

## 6. Viewing Generated Images

Generated images are shown small, below the buttons under the chat bubble.

![A generated image](../images/ja/10-05-generated.png)

Select an image to enlarge it. Select × at the upper right or outside the image to close the enlarged view.

![The enlarged view](../images/ja/10-06-enlarged.png)

At the upper right of the enlarged view are the following buttons.

| Button | Description |
| --- | --- |
| Set this image as background | Makes this image the background image of that chat bubble. Shown when background images are enabled |
| Show positive prompt | Shows the prompt used for generation. For the API service, the generation details such as the model and seed are also shown |
| Delete this image | Deletes this image after a confirmation |
| Close | Closes the enlarged view |

## 7. Background Images

When "Session background image" is turned on under "Background image" in "General" in Settings, the image of a chat bubble is shown as the background of the conversation while that chat bubble is on the screen.

![The background image settings](../images/ja/10-07-background-setting.png)

| Item | Description |
| --- | --- |
| Background image opacity | Specifies how strongly the background image is shown. At 100%, it is shown most strongly |
| Message background opacity | Specifies the opacity of the chat bubble background |
| Background image scaling | "Fill screen" fills the whole screen with the image and crops the parts that overflow. "Show entire image" shows the whole image |
| Background image area | "History area only" shows it within the conversation history area. "Include chat area" extends it behind the input field, and "Panel opacity with background image" is also shown. Shown when the scaling is "Fill screen" |

![An image shown as the background](../images/ja/10-08-background.png)

The background shows the image of the chat bubble closest to the center of the screen. A background chosen with "Set this image as background" is remembered by that browser.

## 8. Image Generation in This Conversation

Select "Image generation settings" in "Image generation in this conversation" of the Setup panel to show the image generation settings used only for that conversation.

![Image generation in this conversation](../images/ja/10-09-session-image-settings.png)

| Item | Description |
| --- | --- |
| Workflow | Choose the workflow (the generation preset for the API service) used in this conversation |
| Analysis instructions for image generation | Choose the instruction format used in this conversation |

For both, the default is "Default (follow global settings)", which follows the contents of Quick settings and the Settings screen.

---

Previous chapter: [09 Supporter Features](09-sponsor.md) / Next chapter: [11 Text-to-Speech](11-tts.md)

[Back to Contents](index.md)
