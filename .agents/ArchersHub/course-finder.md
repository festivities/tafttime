# ArchersHub Course Finder

## Page Flow

With an authenticated session, load:

```text
GET https://archershub.dlsu.edu.ph/CourseFinder/Index
```

The page loads `Scripts/CourseFinder.js` and first requests the dropdown data:

```text
POST /CourseFinder/GetAllDropDownList/
```

The page renders these native selects, enhanced by Select2:

| Element | Meaning | Observed values |
| --- | --- | --- |
| `#ddlSelectCampus` | Campus | selected `7`, displayed `Manila` |
| `#ddlSelectAcadSession` | Academic session | selected `155`, displayed `AY 2026-2027 Term 1` |
| `#ddlSelectCourse` | Offered course | `COURSE_CREATION_ID` values |
| `#ddlStudentList` | Student selector | placeholder only in this flow |

The page had 2,760 course options after the list request. The first observed option was:

```text
COURSE_CREATION_ID: 1
COURSE_NAME: SH-KOMUPIL - KOMUNIKASYON AT PANANALIKSIK SA WIKA AT KULTURANG PILIPINO
```

The last observed option had ID `12449`. Counts and course values are time-dependent and must not be hardcoded.

## Endpoint 1: Offered Courses

```text
POST https://archershub.dlsu.edu.ph/CourseFinder/GetCourseList/
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

The browser sends:

```text
Campusno=<campus value>&AcademicSession=<academic session value>
```

Example parameter values observed in the signed-in page were `Campusno=7` and `AcademicSession=155`. The response was JSON with this shape:

```json
{
  "CampusDrp": [...],
  "SessionDrp": [...],
  "CourseDrp": [
    {
      "COURSE_CREATION_ID": 1,
      "COURSE_NAME": "..."
    }
  ]
}
```

The required list for TaftTime is `CourseDrp`. Preserve the other response keys while investigating because they may be used for rebinding the UI.

The request succeeds without a visible request body token in the page flow, but it depends on the signed-in browser session. Reproduce it through the authenticated browser context, not an unauthenticated server-side `fetch`.

## Endpoint 2: Selectable Classes/Sections

```text
POST https://archershub.dlsu.edu.ph/CourseFinder/GetCFData/
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

The browser sends:

```text
Campusno=<campus value>&AcademicSession=<academic session value>&Courseid=<course creation ID>
```

For the observed values, the request was equivalent to:

```text
Campusno=7&AcademicSession=155&Courseid=1
```

The response is a JSON array. A non-empty verification using `STSWENG - ADVANCED SOFTWARE ENGINEERING` found course ID `367` and returned 6 rows for the currently selected campus/session. The values below are structural and redacted; course offerings, schedules, teachers, dates, and counts are live academic data and must not be copied into fixtures without redaction.

The observed row schema was:

```text
SESSION
CAMPUS
COURSE_CREATION_ID
SECTION_CREATION_ID
SECTION_NAME
CAPACITY
UPDATED_CAPACITY
SUBJECT_NAME
SUBJECT_TYPE
CREDITS
MAIN_TEACHER
ADDITIONAL_TEACHER
SCHEDULE
ENLISTED
APPROVED_COUNT
START_DATE
END_DATE
BATCH_CREATION_ID
SECTION_REMARK
ROOOMNAME
BATCHNAME
```

The page renders these fields as course type, teacher, credits, section, schedules, enrollment capacity, enrolled count, remark, and action columns. `CAPACITY` and `ENLISTED` are separate values: a class can be full even when the endpoint returns it successfully. `UPDATED_CAPACITY` and `APPROVED_COUNT` may affect how the portal displays availability, so the normalization logic must establish the provider's exact seat-availability rule instead of assuming `CAPACITY - ENLISTED` is sufficient.

## Browser Behavior

Changing campus or academic session clears the course select and class table. Changing course schedules `loadCFData()` asynchronously. The page uses jQuery AJAX and Select2; a native DOM `change` event is enough to trigger the request when testing, but a production worker should wait for the response/table state rather than sleep a fixed duration.

The page also calls `/CourseFinder/GetScheduleData/` for the schedule modal. That endpoint was not part of the requested investigation and is not documented as an ingestion dependency yet.

## Request Implementation Guidance

Preferred sequence inside one persistent authenticated browser context:

1. Navigate to `/CourseFinder/Index`.
2. Wait for `#ddlSelectCampus`, `#ddlSelectAcadSession`, and `#ddlSelectCourse` to be populated.
3. Read campus/session option values from the page or call `GetAllDropDownList` through the same context.
4. POST `GetCourseList` with URL-encoded form data through the browser context.
5. For every `CourseDrp` record, POST `GetCFData` with its `COURSE_CREATION_ID`, using bounded concurrency and rate limits.
6. Normalize the responses into TaftTime's shared course/class/section model at the ingestion boundary.
7. Store source IDs and retrieval timestamps so a later refresh can reconcile changes.

Do not make 2,760 class requests with unlimited parallelism. First measure the endpoint's response size, rate limits, and whether multiple course IDs can be queried more efficiently. Start with low concurrency (for example, 2-5) and exponential backoff for transient failures. Preserve incomplete-run detection: a partial catalog must not silently replace a complete one.

The endpoint is not a documented public API. Expect route names, parameter casing, response fields, and authorization behavior to change. Keep a small contract probe and redacted fixture test rather than coupling the entire datapuller directly to raw responses.
