import dotenv from "dotenv";
import mongoose from "mongoose";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  ArchersHubOfferingModel,
  type IArchersHubOfferingItem,
} from "@repo/common/models/archershub-offering";

import { readArchersHubSnapshot } from "./archershub-snapshot";
import {
  type NormalizedArchersHubBundle,
  normalizeArchersHubSnapshot,
} from "./lib/archershub-normalizer";

export type OfferingStore = {
  findOneAndReplace: (
    filter: Record<string, unknown>,
    document: IArchersHubOfferingItem,
    options: { upsert: true; runValidators: true }
  ) => Promise<unknown>;
};

const defaultStore = ArchersHubOfferingModel as unknown as OfferingStore;

export function getArchersHubOfferingFilter(
  bundle: NormalizedArchersHubBundle
): Record<string, unknown> {
  const identity = bundle.offering.identity;
  return {
    "offering.identity.provider": identity.provider,
    "offering.identity.requestCampusId": identity.requestCampusId,
    "offering.identity.academicSessionId": identity.academicSessionId,
    "offering.identity.courseCreationId": identity.courseCreationId,
  };
}

export function toArchersHubOfferingDocument(
  bundle: NormalizedArchersHubBundle
): IArchersHubOfferingItem {
  const clone = structuredClone(bundle) as IArchersHubOfferingItem & {
    _id?: unknown;
    __v?: unknown;
  };
  delete clone._id;
  delete clone.__v;
  return clone;
}

export function summarizeArchersHubImport(bundle: NormalizedArchersHubBundle) {
  return {
    provider: bundle.provider,
    retrievedAt: bundle.retrievedAt,
    scope: { ...bundle.offering.identity },
    sectionCount: bundle.offering.sections.length,
  };
}

export async function importArchersHubBundle(
  bundle: NormalizedArchersHubBundle,
  store: OfferingStore = defaultStore
) {
  const document = toArchersHubOfferingDocument(bundle);
  await new ArchersHubOfferingModel(document).validate();
  await store.findOneAndReplace(getArchersHubOfferingFilter(bundle), document, {
    upsert: true,
    runValidators: true,
  });
  return summarizeArchersHubImport(bundle);
}

async function main(): Promise<void> {
  dotenv.config();
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      "mongodb-uri": { type: "string" },
    },
  });
  if (!values.input) throw new Error("Pass --input <snapshot-path>");
  const uri = values["mongodb-uri"] ?? process.env.MONGODB_URI;
  if (!uri) throw new Error("Pass --mongodb-uri <uri> or set MONGODB_URI");

  const snapshot = await readArchersHubSnapshot(values.input);
  const bundle = normalizeArchersHubSnapshot(snapshot);
  await mongoose.connect(uri);
  try {
    const summary = await importArchersHubBundle(bundle);
    console.log(JSON.stringify(summary, null, 2));
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
