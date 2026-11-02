# Datakul on Android

The Android app is the web app wrapped as a Trusted Web Activity (TWA): the real site, full screen, with no browser bar,
published on Google Play. The web app is already ready for it: it has a manifest (`web/manifest.webmanifest`), icons
(192, 512 and maskable), an offline service worker (`web/sw.js`) and runs over https at the Pages address.

## Steps (when you are ready)

1. Google Play Console account (one-off US$25).
2. Install Bubblewrap (`npm i -g @bubblewrap/cli`), then `bubblewrap init --manifest https://<your-site>/manifest.webmanifest`.
   Package name suggestion: `app.datakul`. Keep the generated signing key private (never commit it).
3. `bubblewrap build` makes the `.aab` for Play and an `.apk` for testing.
4. Digital Asset Links, so the app opens without a browser bar: `bubblewrap fingerprint` prints the SHA-256 of the signing
   key (with Play App Signing, copy the one shown in Play Console under App signing). Put it in
   `web/.well-known/assetlinks.json` using the template below and merge. The deploy publishes it.
5. Personal accounts created after Nov 2023 must run a closed test with 12 testers for 14 days before production.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "app.datakul",
    "sha256_cert_fingerprints": ["PASTE:THE:SHA256:FINGERPRINT:HERE"]
  }
}]
```

## Web app and Android app, separately

- Both run the same code. The Android app opens `/?source=app`-style launches the same way the installed web app does.
- Sign-in on Android uses the same Google sign-in as the web (see `docs/setup.md`). Inside a TWA it runs in Chrome, so
  no extra code is needed.
- Store listing needs the privacy page at `/privacy.html`.
