# Releasing the phone app (Google Play + over-the-air updates)

The workflow is `.github/workflows/mobile.yml`. It does three things:

| When | What happens |
|---|---|
| Any change under `mobile/` (pull request, or a push to `main`/`develop`) | Type check, accessibility scan, tests, `expo-doctor`, and an Android bundle. A red tick means do not release. |
| A push to `main` that changes `mobile/` (or "Run workflow" > `ota-update`) | **Over-the-air update**: phones that already have this app version get the new JavaScript the next time they open the app. No Play review, no new install. |
| "Run workflow" > `build-and-submit-to-play` | **New store version**: builds the app bundle (version code goes up by itself) and sends it to Google Play's *internal testing* track as a draft. You promote it to production in the Play Console. |
| "Run workflow" > `build-apk-only` | An installable APK (for the website's Android download button or a quick test). |

## What goes by OTA and what needs a store build

OTA can change screens, logic, text and translations. It **cannot** add or change native code. A store build is needed when you:
add or upgrade a native package (anything with a native part: expo-*, react-native-*), change a permission, change `app.json` plugins, or upgrade Expo.
When you do, **raise `version` in `mobile/app.json`** (1.0.0 to 1.1.0). Updates only go to phones with the same `version` (`runtimeVersion` follows it),
so an old phone is never sent code its native part cannot run.

## One-time setup (needs your accounts; Claude cannot do these)

1. **Expo account and project.** On your computer, in `mobile/`: `npm install -g eas-cli`, `eas login`, then `eas init` (writes the project id into `app.json`), then `eas update:configure` (adds the update address). Commit the changes.
2. **Android signing key.** Run `eas build --platform android --profile production` once on your computer and let EAS generate and store the keystore. Never lose access to the Expo account: the keystore lives there. (Play App Signing then re-signs for users.)
3. **Create the app in the Google Play Console** (app name, package `com.flowxp.app`) and **upload the first bundle by hand** (download the `.aab` from the EAS build page). Google does not allow the very first upload through the API. Complete the store listing, data safety, content rating and privacy policy (`mobile/STORE.md`, `mobile/PLAY_PRIVACY.md`).
4. **Google service account for automatic uploads.** Play Console > Setup > API access > create a service account in Google Cloud, give it the **Release manager** role for this app (or Admin), create a JSON key and download it.
5. **GitHub secrets** (repository Settings > Secrets and variables > Actions), preferably under an environment called `mobile-production` with required reviewers so a release needs a human click:
   - `EXPO_TOKEN`: expo.dev > Account settings > Access tokens > create.
   - `PLAY_SERVICE_ACCOUNT_JSON`: the whole text of the JSON key from step 4.
6. Run **Actions > Mobile > Run workflow > build-apk-only** once to prove the build works, then `build-and-submit-to-play`.

## Day to day

- Fix a bug or change a screen in `mobile/`: merge to `main`. The OTA job publishes it. Phones update on their next app open (the update is downloaded in the background and used from the open after).
- Something native changed: bump `version` in `app.json`, merge, then run `build-and-submit-to-play`. In the Play Console promote the internal draft to production (staged rollout is a good idea).
- A bad OTA update: `eas update:rollback --channel production` (or publish the previous commit again).
- The test channel (`eas.json`, `test` profile) still needs its server address filled in if you want a staging build.

## Safety notes

- Builds use `https://flowxp.in` (production profile). The Play key file is written only during the job and deleted at the end.
- The submit step uses `track: internal`, `releaseStatus: draft` from `eas.json`, so nothing reaches customers without you promoting it in Play.
- Do not publish an OTA from `develop`: only `main` does, by design.
