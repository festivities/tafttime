# ArchersHub Authentication

## Observed Sign-In Options

The login page now includes a `Continue with Google` anchor:

```html
<a href="#" role="button" id="btnGoogleSignIn" class="google-login ...">
  Continue with Google
</a>
```

This is preferable to the older username/password path because the latter can require CAPTCHA and a two-step OTP. Crossbow's existing path is in:

- `D:\Dev\projects\Crossbow\crossbow-enlistment.py`
- `D:\Dev\projects\Crossbow\crossbow-adjustment.py`

Crossbow currently supports:

- Selenium with ChromeDriver Manager.
- Manual login fallback.
- Optional username/password prefill.
- OCR of `#captchaImageLogin` using Tesseract/Pillow.
- Gmail OTP retrieval for `#formTwoStepAuth` / `#txtTwoStepOTP`.
- Attaching to an existing Chrome remote-debugging session.
- Persistent or temporary Chrome profiles.

The Google button should replace the CAPTCHA/OTP path as the preferred human-assisted bootstrap. Do not automate Google credential entry, defeat Google anti-abuse controls, or treat the Google browser cookie as an application credential.

## What Was Observed Live

The current Charlotte tab was already authenticated at:

```text
https://archershub.dlsu.edu.ph/StudentDashboard/index/1
```

The visible dashboard's `Enlistment` link led to:

```text
https://archershub.dlsu.edu.ph/Enlistment_V2/Index/2
```

The Course Finder navigation item led to:

```text
https://archershub.dlsu.edu.ph/CourseFinder/index/53
```

The session remained usable on Course Finder. Browser JavaScript could see only these cookie names:

```text
ApplicationGatewayAffinityCORS
ApplicationGatewayAffinity
```

This is not evidence that those are the complete authentication state. The actual session cookie is likely HttpOnly and therefore unavailable to `document.cookie`; browser DevTools/network tooling or the browser context itself is required to send it. Never use client-side JavaScript as a cookie extraction mechanism.

## Google Flow Verification

On September 3, 2026, after the account owner logged out, the logged-out ArchersHub page at `/` visibly showed the control as a button-like element with:

```text
Continue with Google
```

The control has DOM ID `btnGoogleSignIn` and is implemented as an anchor with `role="button"`. Clicking it initiated the portal's Google OAuth flow. The browser reached Google's account chooser, where the already-authenticated account was available. Selecting that account returned the browser to:

```text
https://archershub.dlsu.edu.ph/StudentDashboard
```

The authenticated dashboard rendered again, confirming that the visible Google flow successfully created/restored an ArchersHub login session. No Google credentials, OAuth authorization code, state value, or cookie value was recorded.

The portal's login JavaScript confirms that the click first POSTs to `/StudentLogin/GoogleLogin/` with a CSRF token, current date, and browser IP metadata. The successful response supplies the Google authorization redirect. This means the worker must click the real control or reproduce the complete browser flow, not invent a direct callback URL.

After the return to ArchersHub, the same browser context loaded Course Finder and successfully called both authenticated endpoints. The current verification returned 2,760 course offerings from `GetCourseList`; `STSWENG` resolved to course ID `367`, and `GetCFData` returned 6 class rows. This confirms that Google-based sign-in grants access to the SIS-backed Course Finder data in the same way as the previous authenticated session.

## Why Copying Local Cookies To Oracle Is A Poor Primary Design

Copying cookie text or a Chrome profile from a local PC to the Oracle Ampere host is fragile and unsafe:

- HttpOnly cookies are easy to mishandle and are bearer credentials if exposed.
- Chrome cookie values may be encrypted using the source operating system's key store. A raw profile copy may not decrypt on Linux/Oracle.
- A Chrome profile is a live database and should not be copied while Chrome is running.
- Google and the portal may detect a new device, IP, browser, or location and invalidate the session or require reauthentication.
- Application Gateway affinity cookies may be host/path/SameSite scoped and do not constitute a portable login.
- Server-side session expiry is independent of the browser cookie's local expiration.
- A long-lived copied cookie gives anyone who obtains the artifact access to a student account.
- A local-PC-to-server cookie bridge creates a second secret transport and an unclear revocation story.

Cookie transfer can be a short-lived diagnostic experiment in a controlled environment, but it should not be the TaftTime production architecture.

## Recommended Authentication Architecture

Use a dedicated authenticated browser worker on the Oracle host:

1. Run Chromium/Playwright or Selenium in a persistent profile owned by a dedicated OS user.
2. Start it with a visible browser during provisioning, or expose an authenticated remote desktop/tunnel for the one-time Google sign-in.
3. The account owner clicks `Continue with Google` and completes any Google prompts interactively.
4. Close the provisioning access and keep the browser profile on the Oracle host with strict filesystem permissions.
5. The worker navigates to a harmless authenticated page and uses the same browser context to request Course Finder data.
6. If the portal redirects to login or an endpoint returns an authentication response, mark the session expired and alert the owner. Do not repeatedly retry login or scrape Google.
7. Reopen the controlled provisioning path only when a human needs to sign in again.

This keeps the session cookie in the browser's cookie jar, where HttpOnly and SameSite behavior work normally. It also avoids asking TaftTime's Node API to receive or persist a raw portal cookie.

The worker should be a separate, narrow service. TaftTime's backend should call the worker over a private Docker/Kubernetes network or receive a normalized data artifact from it. The public frontend must never receive ArchersHub cookies or credentials.

## Session Lifetime Is Unknown

No reliable TTL can be inferred from one signed-in observation. Track it empirically without logging secrets:

- Record worker login time, last successful authenticated probe, and first failure time.
- Probe at a conservative interval, not continuously. Start with 15-30 minutes unless the data freshness requirement demands otherwise.
- Use `CourseFinder/Index` or another read-only authenticated page as a probe.
- Treat redirects to `StudentLogin`, a login-form marker, HTTP 401/403, or an empty/unauthorized endpoint response as expiry candidates.
- Distinguish portal outage, rate limiting, and malformed requests from session expiry.
- Alert after one or two confirmed failures and stop polling until reauthentication.

The portal may refresh a session through normal navigation or a route such as `/StudentLogin/ReFillSession/`; the existence of that JavaScript route was observed in the site's common bundle, but its authorization semantics and safe use were not established. Do not call undocumented session-refresh endpoints blindly.

## Crossbow Reuse

Reuse Crossbow's proven browser attachment and profile handling concepts, especially:

- `ATTACH_TO_EXISTING_BROWSER` and `DEBUGGER_ADDRESS` for provisioning/debugging.
- `CHROME_USER_DATA_DIR` and `CHROME_PROFILE_DIRECTORY` for persistent state.
- Explicit logged-in checks based on URL and page indicators.
- Bounded waits and a manual fallback.

Do not carry the OCR CAPTCHA or Gmail OTP automation into the preferred path. Keep it only as a legacy emergency path if the account owner explicitly wants it and policy permits it. The Google flow should remain human-driven.

## Unattended Operation

The first worker milestone supports ntfy notifications and a supervised watch loop. Configure a private topic through `NTFY_TOPIC`; use `NTFY_TOKEN` for a protected topic or `NTFY_SERVER` for a self-hosted HTTPS server. Alerts contain only state and safe counts/messages, never cookies, authorization headers, OAuth URLs, or page dumps.

When authentication expires, the worker enters `WAITING_FOR_REAUTHENTICATION`, sends one incident notification, and does not repeatedly click through Google. Connect to the `desktop` XFCE session over RDP, complete the visible Google flow and any password/phone approval manually, leave Chrome running, and let the worker detect recovery. The worker's CDP connection is read-only with respect to browser ownership: it must not close the attached Chrome process.
