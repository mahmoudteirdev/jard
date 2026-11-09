# Releasing Jard

Every push to `main` builds and tests both apps. The results are under **Actions**, in the run's **Artifacts**, for 14 days. They are test builds: the APK is debug-signed and the installer has no update signature.

A tag publishes a public release with the signed files.

## Before the first release: add the signing secrets

In the repository: **Settings → Secrets and variables → Actions → New repository secret**. Run each command below in PowerShell on the machine holding the keys. It puts the value on the clipboard, ready to paste.

| Secret | Copy it with |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `Get-Content -Raw $env:USERPROFILE\.jard-keys\updater.key \| Set-Clipboard` |
| `ANDROID_KEYSTORE_BASE64` | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.jard-keys\android-release.jks")) \| Set-Clipboard` |
| `ANDROID_KEYSTORE_PASSWORD` | `(Get-Content $env:USERPROFILE\.jard-keys\android-release.properties \| Select-String '^storePassword=').Line.Split('=',2)[1] \| Set-Clipboard` |

Never commit these keys. Back up the `.jard-keys` folder: without it, you can't sign updates for what's already installed.

## Publishing a version

1. Set the same version in `apps/desktop/src-tauri/tauri.conf.json` and in `versionName` in `apps/android/app/build.gradle.kts`, and raise `versionCode`.
2. Commit and push.
3. Tag it and push the tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow refuses a tag that doesn't match the version, and refuses to build without the secrets, so nothing unsigned gets published.

It attaches the installer, the portable zip, the APK, `latest.json` for the updater, and `SHA256SUMS.txt`.

## After changing dependencies

```bash
cd apps/desktop
node scripts/licenses.mjs
```

This refreshes the open-source list and license texts shown on the About screen. Check the Android part of that script by hand when `apps/android/app/build.gradle.kts` changes.
