# Dansk

A personal Danish vocabulary app. You add the words you want to learn with your own
translations; the app tests them inside short Danish texts and spaces the reviews.

Live at https://catalinapasari64.github.io/dansk/ (open in Safari on iPhone, then Share → Add to Home Screen).

## How it works

- **Storage:** everything lives in the browser's local storage on the device. There is no server and no account. Use Settings → Save backup file to keep a copy.
- **Texts:** DR news snippets (collected daily into `news.json` by a GitHub Actions job from DR's public RSS feeds), then Danish Wikipedia and Tatoeba, each with a link to the source. Passages are at most five sentences.
- **Scheduling:** rule-based. A correct answer moves a word along the intervals in Settings (2, 4, 10, 20, 40, 80, 160 days by default); a miss brings it back the next day.
- **Answer checking:** matched against your translations (alternatives separated by `;`), allowing small typos and different word endings. "My answer was right" overrides a wrong verdict.

## Optional: AI assistance

Paste an Anthropic API key in Settings to have Claude judge answers that do not match your
translation, and write a passage (labelled "AI-generated") when no real text is found.

- Create a key at https://console.anthropic.com/ ; usage is billed to that account.
- The key is stored only on the device, is left out of backup files, and is sent only to Anthropic.
- The Anthropic SDK is loaded from esm.sh the first time AI is used.

## Development

Static files, no build step. Serve the folder with any web server, for example
`python -m http.server 5173`. Bump `CACHE` in `sw.js` whenever files change.
