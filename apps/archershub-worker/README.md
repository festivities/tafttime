# ArchersHub Worker

Read-only first milestone for TaftTime's ArchersHub integration. The worker attaches to the persistent Google Chrome session owned by the `desktop` Linux user through local CDP, optionally completes the visible ArchersHub Google account-selection step, and reads Course Finder data.

It does not export cookies, write browser storage, type Google passwords, automate MFA approval, enroll in courses, write MongoDB, or expose an HTTP API.

## Oracle Setup

Run from this package as the `tafttime` user:

```sh
npm install
npm run type-check
npm test
```

Chrome must already be running as `desktop` in XFCE with the authenticated profile:

```sh
google-chrome-stable \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/home/desktop/.config/tafttime-archershub \
  --profile-directory=Default
```

Run without login automation when the ArchersHub session is already valid:

```sh
npm run start -- --cdp http://127.0.0.1:9222 --course STSWENG
```

Run with the visible Google flow when the ArchersHub session has expired:

```sh
npm run start -- \
  --cdp http://127.0.0.1:9222 \
  --course STSWENG \
  --login \
  --google-account jose_edgardo_valle@dlsu.edu.ph
```

The worker clicks ArchersHub's real `Continue with Google` element and selects the matching account in Google's chooser. It does not enter a password or approve phone MFA. If either is requested, complete it manually in Chrome. The worker waits for the authenticated ArchersHub dashboard before fetching Course Finder data.

Expected output is similar to:

```text
Clicking Continue with Google.
Selecting the configured Google account.
Attached to Chrome.
Course Finder authentication: authenticated
Course offerings: 2772
Matched course: STSWENG - ADVANCED SOFTWARE ENGINEERING (id 367)
Selectable classes: 6
Sections: S06, S04, S05, S02, S03, S40
Probe completed without modifying the attached browser.
```

Counts and sections are live data and can change.

## Failure Categories

- `AUTHENTICATION_REQUIRED`: reauthenticate manually in Chrome or rerun with `--login`.
- `GOOGLE_ACCOUNT_REQUIRED`: provide `--google-account` for automatic chooser selection.
- `PROVIDER_ERROR`: ArchersHub returned a non-success response.
- `INVALID_RESPONSE`: the provider response shape changed.
- `COURSE_NOT_FOUND`: the selected campus/session does not offer the requested prefix.

Do not respond to failures by copying cookies, reading Chrome's `Cookies` database, or exposing CDP beyond localhost.
