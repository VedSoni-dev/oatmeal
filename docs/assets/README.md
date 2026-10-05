# Documentation assets

- `oatmeal-notebook.png`, `oatmeal-settings.png`: screenshots of the actual desktop preview, captured with an isolated profile and fictional meeting data.
- `oatmeal-demo.gif`: a ten-second UI walkthrough through notes, transcript, and a prepared summary. It does not depict live recording or model generation.
- `oatmeal-icon.svg`: Oatmeal's own icon, covered by the repository's MIT license.
- `logos/`: Cursor, Claude, OpenRouter, Ollama, Hugging Face, and Electron marks from [Simple Icons](https://github.com/simple-icons/simple-icons/tree/develop/icons), retrieved October 5, 2026. The collection is released under [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md); trademarks remain with their owners. `-light` variants use a monochrome fill for dark-background legibility; proportions are unchanged.

- `logos/openai.png`: the OpenAI organization’s public GitHub avatar, retrieved through the [GitHub organization API](https://api.github.com/orgs/openai). The mark belongs to OpenAI and identifies the Codex workflow.

Logos identify actual integrations, the optional agent workflow, and the desktop framework. They do not denote partnerships or endorsements. Claude's mark identifies both Claude and the Claude Code workflow.

Regenerate the screenshots and GIF from the desktop branch with `node scripts/capture-showcase.mjs` after installing dependencies and `ffmpeg`. It uses only fictional data and makes no audio or AI requests.
