---
name: comfyui-artifacts
description: Publish completed, failed, or cancelled ComfyUI image, video, audio, text, and 3D outputs as a structured Pi Web artifact card. Use after a ComfyUI client or workflow returns local output paths, especially when automatic result detection did not publish a card.
---

# ComfyUI Artifacts

Keep generation in the specialized workflow skill. This skill only hands the
result to Pi Web in a durable, structured form.

1. Run the selected ComfyUI client with its wait/download option so final media
   exists as local files.
2. The package normally recognizes the client's final JSON automatically.
3. If no artifact card appears, call `comfyui_publish` exactly once with the
   prompt/generation id and all final local paths.
4. Put a concise summary in `summary`. Put model/workflow identity in
   `workflowName`, and pass a seed as a string so 64-bit seeds stay exact.
5. Never embed full-resolution base64 data. Never publish temporary previews as
   final outputs.

The publishing call does not replace the normal assistant response. After it
succeeds, briefly tell the user what was generated and where it was saved.
