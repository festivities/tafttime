export type Course = {
  COURSE_CREATION_ID: number | string;
  COURSE_NAME: string;
};

export type ClassRow = {
  SESSION?: unknown;
  CAMPUS?: unknown;
  COURSE_CREATION_ID?: unknown;
  SECTION_CREATION_ID?: unknown;
  SECTION_NAME?: unknown;
  CAPACITY?: unknown;
  UPDATED_CAPACITY?: unknown;
  SUBJECT_NAME?: unknown;
  SUBJECT_TYPE?: unknown;
  CREDITS?: unknown;
  MAIN_TEACHER?: unknown;
  ADDITIONAL_TEACHER?: unknown;
  SCHEDULE?: unknown;
  ENLISTED?: unknown;
  APPROVED_COUNT?: unknown;
  START_DATE?: unknown;
  END_DATE?: unknown;
  BATCH_CREATION_ID?: unknown;
  SECTION_REMARK?: unknown;
  ROOOMNAME?: unknown;
  BATCHNAME?: unknown;
};

export type CourseListResponse = {
  CampusDrp?: unknown;
  SessionDrp?: unknown;
  CourseDrp?: unknown;
};

export type CourseFinderResult = {
  campus: string;
  academicSession: string;
  courses: Course[];
  matchedCourse: Course;
  classes: ClassRow[];
};
