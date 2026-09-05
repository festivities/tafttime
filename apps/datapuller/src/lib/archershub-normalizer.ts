import {
  type ArchersHubSnapshot,
  canonicalId,
  validateArchersHubSnapshot,
} from "archershub-worker/snapshot";

type Campus = "Manila" | "Laguna";
type Modality = "in-person" | "online" | "hybrid";

export type NormalizedMeeting = {
  day: string;
  startTime: string;
  endTime: string;
  location: string | null;
  modality: Exclude<Modality, "hybrid"> | null;
};

export type NormalizedArchersHubSection = {
  identity: {
    provider: "archershub";
    requestCampusId: string;
    academicSessionId: string;
    courseCreationId: string;
    sectionCreationId: string;
    batchCreationId: string | null;
  };
  sectionName: string | null;
  subjectType: string | null;
  credits: number | null;
  campus: {
    requestCampusId: string;
    sourceCampus: string | null;
    inferredCampus: Campus | null;
    inference: "section-name-x-prefix" | "section-name-non-x" | null;
  };
  capacity: number | null;
  updatedCapacity: number | null;
  enlisted: number | null;
  approvedCount: number | null;
  availableSeats: number | null;
  teachers: string[];
  rawSchedules: string[];
  scheduleStatus: "missing" | "parsed" | "unparsed";
  meetings: NormalizedMeeting[] | null;
  modality: Modality | null;
  fragments: Record<string, unknown>[];
};

export type NormalizedArchersHubBundle = {
  provider: "archershub";
  retrievedAt: string;
  offering: {
    identity: {
      provider: "archershub";
      requestCampusId: string;
      academicSessionId: string;
      courseCreationId: string;
    };
    course: {
      sourceCourseId: string;
      courseCode: string | null;
      title: string;
      sourceName: string;
    };
    term: {
      sourceAcademicSessionId: string;
      label: string | null;
      academicYear: string | null;
      ordinal: 1 | 2 | 3 | null;
      sourceStartDate: string | null;
      sourceEndDate: string | null;
      parseStatus: "missing" | "parsed" | "unparsed";
      timezone: "Asia/Manila";
    };
    academicCareer: null;
    gradingBasis: null;
    finalExam: null;
    sections: NormalizedArchersHubSection[];
  };
};

const DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

function fail(message: string): never {
  throw new Error(`NORMALIZATION_ERROR: ${message}`);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") fail(`${field} was not a string`);
  return value.trim() || null;
}

function optionalCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    (typeof value !== "number" &&
      (typeof value !== "string" || !/^\d+$/.test(value.trim()))) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 0
  ) {
    fail(`${field} was not a non-negative integer`);
  }
  return Number(value);
}

function optionalCredits(value: unknown): number | null {
  const credits = optionalCount(value, "CREDITS");
  if (credits !== null && credits > 5) fail("CREDITS was outside 0-5");
  return credits;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    return canonicalId(value);
  } catch {
    return fail(`${field} was not a canonical ID`);
  }
}

function requiredId(value: unknown, field: string): string {
  return optionalId(value, field) ?? fail(`${field} was missing`);
}

function consensus<T>(values: T[], field: string): T {
  const distinct = new Map(
    values.map((value) => [JSON.stringify(value), value])
  );
  if (distinct.size !== 1) fail(`${field} conflicted within one section`);
  return values[0];
}

function parseCourseName(sourceName: string): {
  courseCode: string | null;
  title: string;
} {
  const delimiter = " - ";
  const index = sourceName.indexOf(delimiter);
  if (index <= 0 || index !== sourceName.lastIndexOf(delimiter)) {
    return { courseCode: null, title: sourceName };
  }
  const courseCode = sourceName.slice(0, index).trim();
  const title = sourceName.slice(index + delimiter.length).trim();
  return courseCode && title
    ? { courseCode, title }
    : { courseCode: null, title: sourceName };
}

function parseTime(value: string): { text: string; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const minutes =
    (hour % 12) * 60 + minute + (match[3].toUpperCase() === "PM" ? 720 : 0);
  return {
    text: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    minutes,
  };
}

function parseSchedule(schedule: string): NormalizedMeeting[] | null {
  const meetings: NormalizedMeeting[] = [];
  for (const part of schedule.split(/\s*\|\s*/)) {
    const match =
      /^\[\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))(?:\s*:\s*(.*?))?\s*\]$/i.exec(
        part
      );
    if (!match) return null;
    const start = parseTime(match[2]);
    const end = parseTime(match[3]);
    if (!start || !end || end.minutes <= start.minutes) return null;

    const suffix = match[4]?.trim();
    let location: string | null = null;
    let modality: NormalizedMeeting["modality"] = null;
    if (suffix) {
      if (/^online$/i.test(suffix)) {
        modality = "online";
      } else {
        const room = /^room\s*-\s*(.+)$/i.exec(suffix)?.[1].trim();
        if (!room) return null;
        location = room;
        modality = "in-person";
      }
    }
    meetings.push({
      day: match[1].toUpperCase(),
      startTime: start.text,
      endTime: end.text,
      location,
      modality,
    });
  }
  return meetings;
}

function sectionModality(meetings: NormalizedMeeting[]): Modality | null {
  const modalities = new Set(meetings.map((meeting) => meeting.modality));
  if (modalities.has(null)) return null;
  if (modalities.size > 1) return "hybrid";
  return modalities.values().next().value ?? null;
}

function normalizeSection(
  snapshot: ArchersHubSnapshot,
  rows: Record<string, unknown>[]
): NormalizedArchersHubSection {
  const sectionCreationId = consensus(
    rows.map((row) =>
      requiredId(row.SECTION_CREATION_ID, "SECTION_CREATION_ID")
    ),
    "SECTION_CREATION_ID"
  );
  const batchCreationId = consensus(
    rows.map((row) => optionalId(row.BATCH_CREATION_ID, "BATCH_CREATION_ID")),
    "BATCH_CREATION_ID"
  );
  const sectionName = consensus(
    rows.map((row) => optionalString(row.SECTION_NAME, "SECTION_NAME")),
    "SECTION_NAME"
  );
  const sourceCampus = consensus(
    rows.map((row) => optionalString(row.CAMPUS, "CAMPUS")),
    "CAMPUS"
  );
  const subjectType = consensus(
    rows.map((row) => optionalString(row.SUBJECT_TYPE, "SUBJECT_TYPE")),
    "SUBJECT_TYPE"
  );
  const credits = consensus(
    rows.map((row) => optionalCredits(row.CREDITS)),
    "CREDITS"
  );
  const capacity = consensus(
    rows.map((row) => optionalCount(row.CAPACITY, "CAPACITY")),
    "CAPACITY"
  );
  const updatedCapacity = consensus(
    rows.map((row) => optionalCount(row.UPDATED_CAPACITY, "UPDATED_CAPACITY")),
    "UPDATED_CAPACITY"
  );
  const enlisted = consensus(
    rows.map((row) => optionalCount(row.ENLISTED, "ENLISTED")),
    "ENLISTED"
  );
  const approvedCount = consensus(
    rows.map((row) => optionalCount(row.APPROVED_COUNT, "APPROVED_COUNT")),
    "APPROVED_COUNT"
  );

  const teachers = new Set<string>();
  const rawSchedules = new Set<string>();
  let invalidSchedule = false;
  for (const row of rows) {
    for (const field of ["MAIN_TEACHER", "ADDITIONAL_TEACHER"] as const) {
      const teacher = optionalString(row[field], field);
      if (teacher) teachers.add(teacher);
    }
    if (
      row.SCHEDULE !== undefined &&
      row.SCHEDULE !== null &&
      typeof row.SCHEDULE !== "string"
    ) {
      invalidSchedule = true;
    } else {
      const schedule = optionalString(row.SCHEDULE, "SCHEDULE");
      if (schedule) rawSchedules.add(schedule);
    }
  }

  const parsedMeetings: NormalizedMeeting[] = [];
  for (const schedule of rawSchedules) {
    const parsed = parseSchedule(schedule);
    if (!parsed) invalidSchedule = true;
    else parsedMeetings.push(...parsed);
  }
  const meetingMap = new Map(
    parsedMeetings.map((meeting) => [JSON.stringify(meeting), meeting])
  );
  const meetings = [...meetingMap.values()].sort((left, right) => {
    const day =
      DAYS.indexOf(left.day as (typeof DAYS)[number]) -
      DAYS.indexOf(right.day as (typeof DAYS)[number]);
    return (
      day ||
      compare(left.startTime, right.startTime) ||
      compare(left.endTime, right.endTime) ||
      compare(left.location ?? "", right.location ?? "")
    );
  });
  const scheduleStatus = invalidSchedule
    ? "unparsed"
    : rawSchedules.size
      ? "parsed"
      : "missing";
  const normalizedSection = sectionName?.trim().toUpperCase();
  const inferredCampus = normalizedSection
    ? normalizedSection.startsWith("X")
      ? "Laguna"
      : "Manila"
    : null;

  return {
    identity: {
      provider: "archershub",
      requestCampusId: snapshot.scope.campusId,
      academicSessionId: snapshot.scope.academicSessionId,
      courseCreationId: snapshot.scope.courseId,
      sectionCreationId,
      batchCreationId,
    },
    sectionName,
    subjectType,
    credits,
    campus: {
      requestCampusId: snapshot.scope.campusId,
      sourceCampus,
      inferredCampus,
      inference: inferredCampus
        ? inferredCampus === "Laguna"
          ? "section-name-x-prefix"
          : "section-name-non-x"
        : null,
    },
    capacity,
    updatedCapacity,
    enlisted,
    approvedCount,
    availableSeats:
      capacity === null || enlisted === null ? null : capacity - enlisted,
    teachers: [...teachers].sort(compare),
    rawSchedules: [...rawSchedules].sort(compare),
    scheduleStatus,
    meetings: scheduleStatus === "parsed" ? meetings : null,
    modality: scheduleStatus === "parsed" ? sectionModality(meetings) : null,
    fragments: [...rows].sort((left, right) =>
      compare(JSON.stringify(left), JSON.stringify(right))
    ),
  };
}

export function normalizeArchersHubSnapshot(
  snapshotValue: unknown
): NormalizedArchersHubBundle {
  const snapshot = validateArchersHubSnapshot(snapshotValue);
  const sourceName = snapshot.matchedCourse.COURSE_NAME.trim();
  const course = parseCourseName(sourceName);
  const rows = snapshot.classes as Record<string, unknown>[];

  for (const row of rows) {
    const subjectName = optionalString(row.SUBJECT_NAME, "SUBJECT_NAME");
    if (subjectName && subjectName !== sourceName) {
      fail("SUBJECT_NAME did not match the selected course");
    }
  }

  const termLabel = rows.length
    ? consensus(
        rows.map((row) => optionalString(row.SESSION, "SESSION")),
        "SESSION"
      )
    : null;
  const sourceStartDate = rows.length
    ? consensus(
        rows.map((row) => optionalString(row.START_DATE, "START_DATE")),
        "START_DATE"
      )
    : null;
  const sourceEndDate = rows.length
    ? consensus(
        rows.map((row) => optionalString(row.END_DATE, "END_DATE")),
        "END_DATE"
      )
    : null;
  const termMatch = termLabel
    ? /^AY\s+(\d{4}-\d{4})\s+Term\s+([123])$/i.exec(termLabel)
    : null;

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      snapshot.provider,
      snapshot.scope.campusId,
      snapshot.scope.academicSessionId,
      snapshot.scope.courseId,
      requiredId(row.SECTION_CREATION_ID, "SECTION_CREATION_ID"),
      optionalId(row.BATCH_CREATION_ID, "BATCH_CREATION_ID"),
    ]);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const sections = [...grouped.values()]
    .map((group) => normalizeSection(snapshot, group))
    .sort((left, right) =>
      compare(JSON.stringify(left.identity), JSON.stringify(right.identity))
    );

  return {
    provider: "archershub",
    retrievedAt: snapshot.retrievedAt,
    offering: {
      identity: {
        provider: "archershub",
        requestCampusId: snapshot.scope.campusId,
        academicSessionId: snapshot.scope.academicSessionId,
        courseCreationId: snapshot.scope.courseId,
      },
      course: {
        sourceCourseId: snapshot.scope.courseId,
        courseCode: course.courseCode,
        title: course.title,
        sourceName,
      },
      term: {
        sourceAcademicSessionId: snapshot.scope.academicSessionId,
        label: termLabel,
        academicYear: termMatch?.[1] ?? null,
        ordinal: termMatch ? (Number(termMatch[2]) as 1 | 2 | 3) : null,
        sourceStartDate,
        sourceEndDate,
        parseStatus: !termLabel ? "missing" : termMatch ? "parsed" : "unparsed",
        timezone: "Asia/Manila",
      },
      academicCareer: null,
      gradingBasis: null,
      finalExam: null,
      sections,
    },
  };
}
