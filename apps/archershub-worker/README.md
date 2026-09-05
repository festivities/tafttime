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
  --google-account example@dlsu.edu.ph
```

The worker clicks ArchersHub's real `Continue with Google` element and selects the matching account in Google's chooser. It does not enter a password or approve phone MFA. If either is requested, complete it manually in Chrome. The worker waits for the authenticated ArchersHub dashboard before fetching Course Finder data.

During Google authentication, the worker inspects only the rendered Google prompt text. If it sees the simple Gmail approval prompt, it sends an ntfy approval alert. If it sees the number-matching prompt (`Open the Gmail app ... then tap N on your phone ...`), it sends the required number in the ntfy title and message. Each distinct prompt is sent once per login attempt; the worker never reads or stores passwords, tokens, cookies, or other page text.

The Google chooser/callback may use a different tab from the original ArchersHub login tab. The worker therefore scans all pages attached to the CDP browser for an authenticated ArchersHub dashboard/Course Finder marker after account selection. Seeing the original ArchersHub login tab remain open during OAuth is normal; the callback tab is the page that matters.

The authenticated callback page must be assigned back to the worker's active page reference. If the original login page is reused after the callback, the next Course Finder navigation sends that tab back to login and makes a successful Google sign-in appear to fail. The worker now preserves the callback page and retries Course Finder navigation briefly while the server-side session settles.

## Watch Mode And ntfy

Watch mode is opt-in and keeps retrying without writing application data:

```sh
export NTFY_TOPIC=your-private-topic
npm run start -- \
  --watch \
  --interval-seconds 900 \
  --cdp http://127.0.0.1:9222 \
  --course STSWENG \
  --login \
  --google-account example@dlsu.edu.ph
```

`NTFY_TOPIC` is optional in development but should be set for unattended operation. Optional settings are `NTFY_SERVER` (defaults to `https://ntfy.sh`) and `NTFY_TOKEN` for an authenticated ntfy topic. Use a private, unguessable topic and do not put the topic or token in source control. If using a self-hosted ntfy server, set `NTFY_SERVER` to its HTTPS URL.

The worker sends one notification when it enters a new state:

- `WAITING_FOR_REAUTHENTICATION`: connect through RDP, complete Google sign-in/MFA manually, and leave Chrome running.
- `PROVIDER_UNAVAILABLE`: Chrome or ArchersHub is unavailable; the worker retries.
- Recovery: Course Finder is authenticated again.

The worker attempts Google account selection only once per authentication incident. After that it pauses login attempts while polling, so inconsistent Google phone notifications do not cause repeated OAuth requests. `--watch` without `--login` is valid and will alert on expiry while waiting for manual recovery; rerun with `--login` when account selection must be automated.

Every four minutes, watch mode sends a tiny Playwright mouse move inside the browser page and updates ArchersHub's existing `localStorage["IdleTime"]` marker. Together these reset the portal's client-side inactivity timers without moving the physical cursor or interacting with Google.

The worker deliberately does not call `/StudentLogin/ReFillSession/`. ArchersHub's own recurring call to that endpoint is commented out, and the active site calls it only when a user chooses `Continue` in the expiry warning. Calling it proactively returned dashboard HTML but cleared the server-side context used by Course Finder, making later list requests return empty data.

ArchersHub's server-side session context expires after approximately 30 minutes even while Course Finder requests remain active. Its data endpoints then return the JSON string `"Object reference not set to an instance of an object."` with HTTP 200 instead of redirecting to login. The worker recognizes this exact sentinel as an authentication failure and starts the normal bounded Google reauthentication flow.

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

Watch mode keeps one CDP connection, browser context, and active page across polling cycles. It does not reconnect to Chrome or select `context.pages()[0]` on every poll. If a provider/CDP error occurs, it attempts a fresh CDP connection and continues with the recovered page.

## Diagnostic Logging

Enable secret-safe JSONL logs with `--log-dir` or `ARCHERSHUB_LOG_DIR`:

```sh
mkdir -p /var/log/tafttime/archershub
npm run start -- \
  --watch \
  --log-dir /var/log/tafttime/archershub \
  --cdp http://127.0.0.1:9222 \
  --course STSWENG \
  --login \
  --google-account example@dlsu.edu.ph
```

Each run creates one `archershub-*.jsonl` file. Events include worker startup, CDP page counts, Google-page discovery, account selection, MFA prompt kind and number, authentication completion, endpoint status/timing/response size, state transitions, and errors. URLs are logged without query strings. Request forms and response bodies are never logged. The directory is created with mode `700` and files with mode `600` where supported.

The logger is opt-in. Without `--log-dir` or `ARCHERSHUB_LOG_DIR`, no diagnostic file is created. Keep logs on the Oracle host, restrict access to `tafttime`, and rotate/delete them according to your retention policy.

## Failure Categories

- `AUTHENTICATION_REQUIRED`: reauthenticate manually in Chrome or rerun with `--login`.
- `GOOGLE_ACCOUNT_REQUIRED`: provide `--google-account` for automatic chooser selection.
- `PROVIDER_ERROR`: ArchersHub returned a non-success response.
- `INVALID_RESPONSE`: the provider response shape changed.
- `COURSE_NOT_FOUND`: the selected campus/session does not offer the requested prefix.

Do not respond to failures by copying cookies, reading Chrome's `Cookies` database, or exposing CDP beyond localhost.
