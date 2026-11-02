# Datakul on Android

The Android app is the Datakul website in a **Trusted Web Activity (TWA)**: the real site, full screen, no browser bar,
installed like any app and publishable on Google Play. It has no code of its own, so the web app and the Android app
never drift apart: every deploy of the website updates the app too. The project is in `android/`.

What the app has: the Datakul icon (adaptive, with a dark brand background), dark status and navigation bars, launcher
shortcuts (long-press the icon: Ask, Quests, Practice, Certifications), and links to datakul.pages.dev open inside the app.
Offline works the same as the installed web app (the service worker keeps the app and library available).

## Get the APK to try now

Every merge to `main` that touches `android/` builds the app (`Build Android APK` run in GitHub → Actions) and publishes
`datakul-debug.apk` as a release. Open the link from the run's summary on your phone, allow installing from that source once,
and install. It is signed with a fixed debug key, so each new build installs over the last one.

This APK is for testing. **Google Play does not accept it** (debug key). Play needs the signed bundle below.

## Why it opens full screen

Android only hides the browser bar if the website says it trusts the app. That is the file
`web/.well-known/assetlinks.json`, published with the site. It lists the signing key's fingerprint. The test APK's key is
already listed. When you publish to Play, add Play's key as well (step 5), or the Play version shows a thin browser bar.
The build checks that the APK's key is in that file.

## Publishing on Google Play (when you are ready)

1. **Play Console account.** One-off US$25. Personal accounts created after Nov 2023 must run a closed test with 12 testers for
   14 days before production.
2. **Make an upload key** (once, on any computer with Java; keep the file and passwords safe, never commit them):
   `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
   then `base64 -w0 upload.jks` (on a Mac: `base64 -i upload.jks`) prints the text for the next step.
3. **Add four repository secrets** (GitHub → Settings → Secrets and variables → Actions):
   `DATAKUL_UPLOAD_KEYSTORE_B64` (that text), `DATAKUL_UPLOAD_STORE_PASSWORD`, `DATAKUL_UPLOAD_KEY_ALIAS` (`upload`),
   `DATAKUL_UPLOAD_KEY_PASSWORD`.
4. **Build the bundle.** Actions → *Release bundle for Google Play* → Run workflow. Download the `.aab` from the run.
   The version code goes up with every run, as Play requires. Upload it in Play Console → Testing → Closed testing.
   Choose Play App Signing when asked (recommended).
5. **Tell the website about Play's key.** Play Console → Test and release → App signing → copy the *App signing key
   certificate* SHA-256. Add it to the list in `web/.well-known/assetlinks.json` (keep the debug one too), merge, and the deploy
   publishes it.
6. **Store listing.** Needs: the privacy page `https://datakul.pages.dev/privacy.html` (add your contact line there first), a
   short and full description, at least 2 phone screenshots, a 512 px icon (`web/icons/datakul-icon-512.png`), a 1024 x 500
   feature graphic, the Data safety form, and the content rating questionnaire. Datakul sends questions the library can't
   answer anonymously (masked, no account) and, only if the learner signs in with Google, their progress; say so in the Data
   safety form.
7. Name and package: the app id is `app.datakul` and cannot be changed after the first upload.

## Changing the app

- Site address, colours, shortcuts and icons live in `android/app/src/main/` (`AndroidManifest.xml`, `res/`). If the website
  moves to a custom domain, change it in `res/values/strings.xml`, the manifest's host, `shortcuts.xml` and
  `web/.well-known/assetlinks.json`; `python3 tests/android_static.py` checks they agree.
- Version name: `versionName` in `android/app/build.gradle`.
- The debug key (`android/app/datakul-debug.keystore`) is committed on purpose; debug keys are not secret. The Play upload key is only ever in GitHub secrets.
- Sign-in with Google works the same as on the web (see `docs/setup.md`); inside a TWA it runs in Chrome, so no extra code.
- Tested in CI: the project builds, the bundle builds, and the website and app agree (`tests/android_static.py`). Not tested
  on a phone by Claude: please check install, full screen (no browser bar), the icon, the shortcuts, and offline.
