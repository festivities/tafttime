import dotenv from "dotenv";
import mongoose from "mongoose";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ArchersHubOfferingModel } from "@repo/common/models/archershub-offering";
import { CatalogClassModel } from "@repo/common/models/catalog-class";
import { ClassModel } from "@repo/common/models/class";
import { CourseModel } from "@repo/common/models/course";
import { NewEnrollmentHistoryModel } from "@repo/common/models/enrollment-history";
import { SectionModel } from "@repo/common/models/section";
import { TermModel } from "@repo/common/models/term";

import {
  type ProjectCollectionStore,
  type ProjectStores,
  type ProjectedScope,
  type ProjectionSkip,
  describeProjectedScope,
  projectArchersHubOffering,
  replaceCatalogClasses,
  writeProjectedScope,
} from "./lib/archershub-project";
import { buildCatalogClasses } from "./lib/catalog-denormalize";

const modelStore = (model: {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  insertMany(docs: unknown[]): Promise<unknown>;
  replaceOne(
    filter: Record<string, unknown>,
    doc: unknown,
    options: { upsert: boolean }
  ): Promise<unknown>;
}): ProjectCollectionStore => ({
  deleteMany: (filter) => model.deleteMany(filter),
  insertMany: (docs) => model.insertMany(docs),
  replaceOne: (filter, doc, options) => model.replaceOne(filter, doc, options),
});

const realStores = (): ProjectStores => ({
  terms: modelStore(TermModel),
  courses: modelStore(CourseModel),
  classes: modelStore(ClassModel),
  sections: modelStore(SectionModel),
  enrollments: modelStore(NewEnrollmentHistoryModel),
  catalogClasses: modelStore(CatalogClassModel),
});

async function main(): Promise<void> {
  dotenv.config();
  const { values } = parseArgs({
    options: {
      "mongodb-uri": { type: "string" },
      course: { type: "string" },
    },
  });
  const uri = values["mongodb-uri"] ?? process.env.MONGODB_URI;
  if (!uri) throw new Error("Pass --mongodb-uri <uri> or set MONGODB_URI");

  await mongoose.connect(uri);
  try {
    const offerings = await ArchersHubOfferingModel.find(
      values.course
        ? { "offering.identity.courseCreationId": values.course }
        : {}
    ).lean();
    if (offerings.length === 0) {
      throw new Error("No ArchersHub offerings found to project");
    }

    const stores = realStores();
    const byTerm = new Map<
      string,
      { year: number; semester: string; scopes: ProjectedScope[] }
    >();
    const skipped: ProjectionSkip[] = [];
    for (const offering of offerings) {
      try {
        const projected = projectArchersHubOffering(offering);
        const key = `${projected.year} ${projected.semester}`;
        const group = byTerm.get(key) ?? {
          year: projected.year,
          semester: projected.semester,
          scopes: [],
        };
        group.scopes.push(projected);
        byTerm.set(key, group);
      } catch (error) {
        skipped.push({
          scope: offering.offering.identity.courseCreationId,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const terms = [];
    for (const { year, semester, scopes } of byTerm.values()) {
      const latestRetrievedAt = scopes
        .map((scope) => scope.term.retrievedAt as string)
        .sort()
        .at(-1) as string;
      for (const scope of scopes) {
        scope.term.retrievedAt = latestRetrievedAt;
        await writeProjectedScope(stores, scope);
      }
      const built = await buildCatalogClasses(year, semester);
      if (built.length === 0) {
        throw new Error(
          `Built zero catalog classes for ${year} ${semester}; preserving previous rows`
        );
      }
      const catalogClasses = await replaceCatalogClasses(
        stores.catalogClasses,
        year,
        semester,
        built
      );
      terms.push({
        year,
        semester,
        scopes: scopes.map(describeProjectedScope),
        catalogClasses,
      });
    }

    console.log(JSON.stringify({ terms, skipped }, null, 2));
    if (skipped.length > 0) {
      throw new Error(`${skipped.length} offering(s) skipped`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
