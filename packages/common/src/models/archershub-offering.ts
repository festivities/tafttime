import { Model, Schema, model } from "mongoose";

export interface IArchersHubMeeting {
  day: string;
  startTime: string;
  endTime: string;
  location: string | null;
  modality: "in-person" | "online" | null;
}

export interface IArchersHubSection {
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
    inferredCampus: "Manila" | "Laguna" | null;
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
  meetings: IArchersHubMeeting[] | null;
  modality: "in-person" | "online" | "hybrid" | null;
  fragments: Record<string, unknown>[];
}

export interface IArchersHubOfferingItem {
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
    sections: IArchersHubSection[];
  };
}

const nullableString = { type: String, default: null } as const;
const nullableCount = {
  type: Number,
  default: null,
  validate: {
    validator: (value: number | null) =>
      value === null || (Number.isSafeInteger(value) && value >= 0),
    message: "Expected a non-negative integer or null",
  },
} as const;
const unavailableField = {
  type: String,
  default: null,
  validate: {
    validator: (value: string | null) => value === null,
    message: "Expected unavailable source data to remain null",
  },
} as const;

const meetingSchema = new Schema<IArchersHubMeeting>(
  {
    day: {
      type: String,
      enum: [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ],
      required: true,
    },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    location: nullableString,
    modality: {
      type: String,
      enum: ["in-person", "online", null],
      default: null,
    },
  },
  { _id: false }
);

const fragmentSchema = new Schema<Record<string, unknown>>(
  {},
  { _id: false, strict: false }
);

const sectionSchema = new Schema<IArchersHubSection>(
  {
    identity: {
      provider: { type: String, enum: ["archershub"], required: true },
      requestCampusId: { type: String, required: true },
      academicSessionId: { type: String, required: true },
      courseCreationId: { type: String, required: true },
      sectionCreationId: { type: String, required: true },
      batchCreationId: nullableString,
    },
    sectionName: nullableString,
    subjectType: nullableString,
    credits: {
      type: Number,
      default: null,
      validate: {
        validator: (value: number | null) =>
          value === null ||
          (Number.isSafeInteger(value) && value >= 0 && value <= 5),
        message: "Expected whole-number credits from 0 through 5 or null",
      },
    },
    campus: {
      requestCampusId: { type: String, required: true },
      sourceCampus: nullableString,
      inferredCampus: {
        type: String,
        enum: ["Manila", "Laguna", null],
        default: null,
      },
      inference: {
        type: String,
        enum: ["section-name-x-prefix", "section-name-non-x", null],
        default: null,
      },
    },
    capacity: nullableCount,
    updatedCapacity: nullableCount,
    enlisted: nullableCount,
    approvedCount: nullableCount,
    availableSeats: {
      type: Number,
      default: null,
      validate: {
        validator: (value: number | null) =>
          value === null || Number.isSafeInteger(value),
        message: "Expected integer available seats or null",
      },
    },
    teachers: { type: [String], required: true, default: [] },
    rawSchedules: { type: [String], required: true, default: [] },
    scheduleStatus: {
      type: String,
      enum: ["missing", "parsed", "unparsed"],
      required: true,
    },
    meetings: { type: [meetingSchema], default: null },
    modality: {
      type: String,
      enum: ["in-person", "online", "hybrid", null],
      default: null,
    },
    fragments: { type: [fragmentSchema], required: true, default: [] },
  },
  { _id: false }
);

const archersHubOfferingSchema = new Schema<IArchersHubOfferingItem>(
  {
    provider: { type: String, enum: ["archershub"], required: true },
    retrievedAt: {
      type: String,
      required: true,
      validate: {
        validator: (value: string) =>
          value.endsWith("Z") && Number.isFinite(Date.parse(value)),
        message: "Expected a UTC ISO retrieval timestamp",
      },
    },
    offering: {
      identity: {
        provider: { type: String, enum: ["archershub"], required: true },
        requestCampusId: { type: String, required: true },
        academicSessionId: { type: String, required: true },
        courseCreationId: { type: String, required: true },
      },
      course: {
        sourceCourseId: { type: String, required: true },
        courseCode: nullableString,
        title: { type: String, required: true },
        sourceName: { type: String, required: true },
      },
      term: {
        sourceAcademicSessionId: { type: String, required: true },
        label: nullableString,
        academicYear: nullableString,
        ordinal: {
          type: Number,
          enum: [1, 2, 3, null],
          default: null,
        },
        sourceStartDate: nullableString,
        sourceEndDate: nullableString,
        parseStatus: {
          type: String,
          enum: ["missing", "parsed", "unparsed"],
          required: true,
        },
        timezone: {
          type: String,
          enum: ["Asia/Manila"],
          required: true,
        },
      },
      academicCareer: unavailableField,
      gradingBasis: unavailableField,
      finalExam: unavailableField,
      sections: { type: [sectionSchema], required: true, default: [] },
    },
  },
  { collection: "archershub_offerings" }
);

archersHubOfferingSchema.pre("validate", function validateScopedSections() {
  const root = this.offering.identity;
  if (
    this.provider !== root.provider ||
    this.offering.course.sourceCourseId !== root.courseCreationId ||
    this.offering.term.sourceAcademicSessionId !== root.academicSessionId
  ) {
    this.invalidate("offering.identity", "Offering scope fields conflicted");
  }
  const term = this.offering.term;
  if (
    (term.parseStatus === "parsed" &&
      (!term.label || !term.academicYear || !term.ordinal)) ||
    (term.parseStatus === "missing" &&
      (term.label !== null ||
        term.academicYear !== null ||
        term.ordinal !== null)) ||
    (term.parseStatus === "unparsed" &&
      (!term.label || term.academicYear !== null || term.ordinal !== null))
  ) {
    this.invalidate(
      "offering.term",
      "Term parse status conflicted with values"
    );
  }
  const seen = new Set<string>();
  for (const section of this.offering.sections) {
    const identity = section.identity;
    if (
      identity.provider !== root.provider ||
      identity.requestCampusId !== root.requestCampusId ||
      identity.academicSessionId !== root.academicSessionId ||
      identity.courseCreationId !== root.courseCreationId ||
      section.campus.requestCampusId !== root.requestCampusId
    ) {
      this.invalidate(
        "offering.sections",
        "Section identity did not match offering scope"
      );
    }
    const expectedAvailable =
      section.capacity === null || section.enlisted === null
        ? null
        : section.capacity - section.enlisted;
    if (section.availableSeats !== expectedAvailable) {
      this.invalidate(
        "offering.sections",
        "Available seats did not match capacity minus enlisted"
      );
    }
    if (
      (section.scheduleStatus === "parsed") !==
      Array.isArray(section.meetings)
    ) {
      this.invalidate(
        "offering.sections",
        "Schedule parse status conflicted with meetings"
      );
    }
    const key = JSON.stringify([
      identity.sectionCreationId,
      identity.batchCreationId,
    ]);
    if (seen.has(key)) {
      this.invalidate(
        "offering.sections",
        "Duplicate section identity within offering"
      );
    }
    seen.add(key);
  }
});

archersHubOfferingSchema.index(
  {
    "offering.identity.provider": 1,
    "offering.identity.requestCampusId": 1,
    "offering.identity.academicSessionId": 1,
    "offering.identity.courseCreationId": 1,
  },
  { unique: true, name: "unique_archershub_offering_scope" }
);
archersHubOfferingSchema.index({
  "offering.course.courseCode": 1,
  "offering.term.academicYear": 1,
  "offering.term.ordinal": 1,
});

export const ArchersHubOfferingModel: Model<IArchersHubOfferingItem> =
  model<IArchersHubOfferingItem>(
    "archershub-offering",
    archersHubOfferingSchema
  );
