# Quoter (Kettu Plugin)

Kettu/Vendetta-style plugin that adds a `Quote` action to message context menus.

## What It Does

1. Adds `Quote` to message action sheets.
2. Builds a quote image URL from message content and author avatar.
3. Lets you either:
- Send that URL in chat
- Copy the URL to clipboard
4. Includes plugin settings for endpoint, grayscale, watermark, and GIF preference.

## Install URL

Use the plugin folder URL (must end with `/`), for example:

```text
https://raw.githubusercontent.com/<your-user>/<your-repo>/<branch>/quoter/
```

or with GitHub Pages:

```text
https://<your-user>.github.io/<your-repo>/quoter/
```

Then install from `Kettu -> Plugins -> Install a plugin`.

## Notes

- This is implemented for Kettu's mobile Vendetta runtime.
- Quote rendering is powered by an HTTP quote API endpoint (default in plugin code is `https://api.popcat.xyz/quote`).
- Optional parameters (`grayscale`, `watermark`, `format=gif`) are passed best-effort for APIs that support them.
