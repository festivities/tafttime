# ArchersHub Integration Notes

This directory records the live investigation of DLSU ArchersHub and the Crossbow automation workflow. It is research and implementation guidance, not a place for credentials, cookies, browser profiles, screenshots containing personal data, or production responses.

## Documents

- `authentication.md` — current sign-in flow, Google sign-in implications, session observations, and recommended architecture.
- `course-finder.md` — verified Course Finder page flow and the two requested endpoint contracts.
- `implementation-plan.md` — staged plan for integrating an authenticated browser worker into TaftTime.

## Important Boundary

The work investigated a real signed-in student account. Only metadata, endpoint paths, parameter names, response shapes, and non-sensitive counts are recorded here. Do not record cookie values, session identifiers, OAuth tokens, student identifiers, credentials, or unredacted academic data.

The ArchersHub portal is a third-party university system. Any production automation must comply with DLSU/ArchersHub terms, rate limits, privacy rules, and university policy. Course availability should be read-only unless a separate, explicit authorization exists for enrollment actions.

The visible `Continue with Google` flow was verified after logout. Selecting the already-authenticated Google account returned to the ArchersHub dashboard, after which Course Finder access worked again: `GetCourseList` returned 2,760 offerings and `STSWENG`/course ID `367` returned 6 class rows. See `authentication.md` and `course-finder.md` for details.
