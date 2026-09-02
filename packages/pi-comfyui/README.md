# @albin/pi-comfyui

A local Pi package that turns ComfyUI output into durable, structured artifact
messages for Pi Web.

The package works in two ways:

- It streams queued/running snapshots from the bundled clients into a keyed
  ComfyUI progress widget and Pi Web artifact card. Progress snapshots are
  stored as custom entries, so they do not enter the model context.
- It automatically recognizes the final JSON printed by the bundled H3,
  Z-Image Turbo, and FLUX.2 Klein clients when they include downloaded files.
- It registers `comfyui_publish` for workflows and scripts that already have
  local output paths.

The extension sends a single terminal `pi.artifact-bundle` custom message. Its
short text remains useful to the model and to older Pi Web versions; the richer
metadata is stored in `details` under the `pi.artifact-bundle/v1` schema. Pi Web
collapses progress revisions by provider and run id, and terminal cards offer a
safe **Rerun** action that prepares a normal user request in the composer for
review instead of executing package-provided commands.

## Local install

```bash
pi install D:/workspace/pi-web/packages/pi-comfyui
```

Use `pi install -l ./packages/pi-comfyui` when you only want to enable it for
the current project.

## Output rules

- Prefer absolute local output paths.
- Download remote ComfyUI outputs before publishing them.
- Publish once after a run reaches a terminal state.
- Do not put full-resolution base64 data in the message.
