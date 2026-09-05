import type { ICatalogClassItem } from "@repo/common/models/catalog-class";
import type { IClassItem } from "@repo/common/models/class";
import type { ICourseItem } from "@repo/common/models/course";
import type { IEnrollmentHistoryItem } from "@repo/common/models/enrollment-history";
import type { ISectionItem } from "@repo/common/models/section";
import type { ITermItem } from "@repo/common/models/term";

import type { NormalizedArchersHubBundle } from "./archershub-normalizer";

export type ProjectedScope = {
  year: number;
  semester: string;
  termId: string;
  courseId: string;
  term: ITermItem;
  course: ICourseItem;
  classes: IClassItem[];
  sections: ISectionItem[];
  enrollments: IEnrollmentHistoryItem[];
};

export type ProjectionSkip = {
  scope: string;
  reason: string;
};

const DAY_INDEX: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

const COMPONENT_MAP: Record<string, string> = {
  Lecture: "LEC",
  Laboratory: "LAB",
};

export function toCatalogSemester(label: string | null): string {
  const match = label === null ? null : /\bTerm ([123])$/.exec(label);
  if (!match) {
    throw new Error(
      `PROJECT_ERROR: unsupported term label ${JSON.stringify(label)}`
    );
  }
  return `Term${match[1]}`;
}

export function toCatalogYear(academicYear: string | null): number {
  const match =
    academicYear === null ? null : /^(\d{4})-\d{4}$/.exec(academicYear);
  if (!match) {
    throw new Error(
      `PROJECT_ERROR: unsupported academic year ${JSON.stringify(academicYear)}`
    );
  }
  return parseInt(match[1], 10);
}

export function toCatalogTime(time: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim())) {
    throw new Error(`PROJECT_ERROR: unsupported meeting time ${time}`);
  }
  return time.trim();
}

export function projectArchersHubOffering(
  bundle: NormalizedArchersHubBundle
): ProjectedScope {
  const identity = bundle.offering.identity;
  const semester = toCatalogSemester(bundle.offering.term.label);
  const year = toCatalogYear(bundle.offering.term.academicYear);
  const courseCode = bundle.offering.course.courseCode;
  if (!courseCode) {
    throw new Error("PROJECT_ERROR: course code is required for projection");
  }
  const { sourceStartDate, sourceEndDate } = bundle.offering.term;
  if (!sourceStartDate || !sourceEndDate) {
    throw new Error("PROJECT_ERROR: term begin/end dates are required");
  }

  const termId = `archershub-${identity.requestCampusId}-${identity.academicSessionId}`;
  const courseId = `${termId}:${identity.courseCreationId}`;
  const retrievedAt = new Date(bundle.retrievedAt);

  const term: ITermItem = {
    academicCareerCode: "UGRD",
    temporalPosition: "Current",
    id: termId,
    name: `${year} ${semester}`,
    academicYear: bundle.offering.term.academicYear as string,
    beginDate: sourceStartDate,
    endDate: sourceEndDate,
    hasCatalogData: true,
    retrievedAt: bundle.retrievedAt,
  };

  const course: ICourseItem = {
    courseId,
    subject: courseCode,
    number: courseCode,
    title: bundle.offering.course.title,
    academicCareer: "UGRD",
    printInCatalog: true,
  };

  const classes: IClassItem[] = [];
  const sections: ISectionItem[] = [];
  const enrollments: IEnrollmentHistoryItem[] = [];

  for (const section of bundle.offering.sections) {
    const classNumber =
      section.sectionName ?? `SEC-${section.identity.sectionCreationId}`;
    const sectionId = [
      "archershub",
      identity.requestCampusId,
      identity.academicSessionId,
      identity.courseCreationId,
      section.identity.sectionCreationId,
      section.identity.batchCreationId ?? "none",
    ].join("-");
    const credits = section.credits;

    classes.push({
      courseId,
      courseNumber: courseCode,
      year,
      semester,
      subject: courseCode,
      termId,
      sessionId: identity.academicSessionId,
      number: classNumber,
      title: bundle.offering.course.title,
      ...(credits === null
        ? {}
        : { allowedUnits: { minimum: credits, maximum: credits } }),
      anyPrintInScheduleOfClasses: true,
    });

    const meetings =
      section.scheduleStatus === "parsed" && Array.isArray(section.meetings)
        ? section.meetings.map((meeting) => {
            const days = [false, false, false, false, false, false, false];
            days[DAY_INDEX[meeting.day]] = true;
            return {
              days,
              startTime: toCatalogTime(meeting.startTime),
              endTime: toCatalogTime(meeting.endTime),
              ...(meeting.location === null
                ? {}
                : { location: meeting.location }),
              instructors: section.teachers.map((name) => ({
                familyName: name,
                role: "PI",
                printInScheduleOfClasses: true,
              })),
            };
          })
        : undefined;

    sections.push({
      courseId,
      classNumber,
      sessionId: identity.academicSessionId,
      termId,
      sectionId,
      number: classNumber,
      subject: courseCode,
      courseNumber: courseCode,
      year,
      semester,
      ...(section.subjectType !== null &&
      COMPONENT_MAP[section.subjectType] !== undefined
        ? { component: COMPONENT_MAP[section.subjectType] }
        : {}),
      ...(section.modality === "online" ? { instructionMode: "O" } : {}),
      printInScheduleOfClasses: true,
      primary: true,
      ...(meetings === undefined ? {} : { meetings }),
    });

    enrollments.push({
      termId,
      year,
      semester,
      sessionId: identity.academicSessionId,
      sectionId,
      subject: courseCode,
      courseNumber: courseCode,
      sectionNumber: classNumber,
      history: [
        {
          startTime: retrievedAt,
          endTime: retrievedAt,
          granularitySeconds: 0,
          ...(section.availableSeats === null
            ? {}
            : { status: section.availableSeats > 0 ? "O" : "C" }),
          ...(section.enlisted === null
            ? {}
            : { enrolledCount: section.enlisted }),
          ...(section.capacity === null ? {} : { maxEnroll: section.capacity }),
        },
      ],
    });
  }

  return {
    year,
    semester,
    termId,
    courseId,
    term,
    course,
    classes,
    sections,
    enrollments,
  };
}

export type ProjectCollectionStore = {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  insertMany(docs: unknown[]): Promise<unknown>;
  replaceOne(
    filter: Record<string, unknown>,
    doc: unknown,
    options: { upsert: boolean }
  ): Promise<unknown>;
};

export type ProjectStores = {
  terms: ProjectCollectionStore;
  courses: ProjectCollectionStore;
  classes: ProjectCollectionStore;
  sections: ProjectCollectionStore;
  enrollments: ProjectCollectionStore;
  catalogClasses: ProjectCollectionStore;
};

export async function writeProjectedScope(
  stores: ProjectStores,
  projected: ProjectedScope
): Promise<void> {
  await stores.terms.replaceOne({ id: projected.termId }, projected.term, {
    upsert: true,
  });
  await stores.courses.replaceOne(
    { courseId: projected.courseId },
    projected.course,
    { upsert: true }
  );
  for (const [store, docs, key] of [
    [stores.classes, projected.classes, "courseId"],
    [stores.sections, projected.sections, "courseId"],
  ] as const) {
    await store.deleteMany({ [key]: projected.courseId });
    if (docs.length > 0) await store.insertMany([...docs]);
  }
  for (const section of projected.sections) {
    await stores.enrollments.deleteMany({ sectionId: section.sectionId });
  }
  if (projected.enrollments.length > 0) {
    await stores.enrollments.insertMany([...projected.enrollments]);
  }
}

export async function replaceCatalogClasses(
  store: ProjectCollectionStore,
  year: number,
  semester: string,
  docs: ICatalogClassItem[]
): Promise<number> {
  await store.deleteMany({ year, semester });
  const BATCH_SIZE = 2000;
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    if (batch.length > 0) {
      await store.insertMany(batch);
      inserted += batch.length;
    }
  }
  return inserted;
}

export function describeProjectedScope(projected: ProjectedScope) {
  return {
    courseId: projected.courseId,
    year: projected.year,
    semester: projected.semester,
    classCount: projected.classes.length,
    sectionCount: projected.sections.length,
  };
}
