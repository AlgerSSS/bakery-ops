import {
  MongoClient,
  MongoServerError,
  type Collection,
} from "mongodb";
import { z } from "zod";

import type { HbtiCode } from "@/content/types";
import type {
  CompletionAcquisition,
  CompletionRecord,
  CompletionStore,
  CompletionStoreKey,
  IssuedCompletionRecord,
  PreparedCompletionRecord,
  ProcessingCompletionRecord,
  ReviewCompletionRecord,
} from "@/lib/store/completion-store";

const hbtiCodeSchema = z
  .string()
  .regex(/^[IH][LS][BD][AT]$/) as z.ZodType<HbtiCode>;

const completionSnapshotSchema = z.strictObject({
  code: hbtiCodeSchema,
  visitTime: z.enum(["morning", "night"]),
  category: z.enum(["drink", "dessert", "bakery"]),
  color: z.string().min(1).max(32),
  gender: z.string().min(1).max(32).optional(),
  age: z.string().min(1).max(32).optional(),
});

const completionRecordSchema = z.union([
  z.discriminatedUnion("phase", [
    z.strictObject({
      status: z.literal("processing"),
      phase: z.literal("locked"),
      attemptId: z.uuid(),
      startedAt: z.iso.datetime(),
      completion: completionSnapshotSchema,
    }),
    z.strictObject({
      status: z.literal("processing"),
      phase: z.literal("prepared"),
      attemptId: z.uuid(),
      startedAt: z.iso.datetime(),
      preparedAt: z.iso.datetime(),
      lastReconciledAt: z.iso.datetime().optional(),
      completion: completionSnapshotSchema,
      baselineCouponIds: z.array(z.string().min(1)),
      rewardContext: z.strictObject({
        memberId: z.string().min(1),
        templateId: z.string().min(1),
        templateName: z.string().min(1),
      }),
    }),
  ]),
  z.strictObject({
    status: z.literal("issued"),
    completion: completionSnapshotSchema,
    reward: z.strictObject({
      couponTemplateName: z.string().min(1),
      newCouponId: z.string().min(1),
      usableCouponCountBefore: z.number().int().nonnegative(),
      usableCouponCountAfter: z.number().int().positive(),
      confirmedAt: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    status: z.literal("review"),
    completion: completionSnapshotSchema,
    reason: z.enum([
      "ambiguous_give",
      "give_rejected",
      "readback_unavailable",
      "readback_mismatch",
      "stale_reconciliation",
    ]),
    markedAt: z.iso.datetime(),
  }),
]);

interface CompletionDocument {
  _id: string;
  expiresAt: Date;
  status: CompletionRecord["status"];
  completion: CompletionRecord["completion"];
  phase?: ProcessingCompletionRecord["phase"];
  attemptId?: string;
  startedAt?: string;
  preparedAt?: string;
  lastReconciledAt?: string;
  baselineCouponIds?: readonly string[];
  rewardContext?: PreparedCompletionRecord["rewardContext"];
  reward?: IssuedCompletionRecord["reward"];
  reason?: ReviewCompletionRecord["reason"];
  markedAt?: string;
}

export interface PreparedCompletionEntry {
  key: CompletionStoreKey;
  record: PreparedCompletionRecord;
}

export class MongoCompletionStore implements CompletionStore {
  constructor(
    private readonly collection: Collection<CompletionDocument>,
  ) {}

  async get(key: CompletionStoreKey): Promise<CompletionRecord | null> {
    const document = await this.collection.findOne({ _id: documentId(key) });
    if (!document) {
      return null;
    }
    const { _id, expiresAt, ...record } = document;
    if (
      _id !== documentId(key) ||
      !(expiresAt instanceof Date) ||
      Number.isNaN(expiresAt.getTime())
    ) {
      throw new Error("Completion document identity mismatch.");
    }
    return completionRecordSchema.parse(record);
  }

  async acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
  ): Promise<CompletionAcquisition> {
    const _id = documentId(key);
    try {
      await this.collection.insertOne({ _id, ...withRetention(record) });
      return { acquired: true };
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }

    const existing = await this.get(key);
    if (existing === null) {
      throw new Error("Completion lock disappeared during acquisition.");
    }
    return { acquired: false, record: existing };
  }

  async markIssued(
    key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord,
  ): Promise<void> {
    await this.finalize(key, attemptId, record);
  }

  async markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: ReviewCompletionRecord,
  ): Promise<void> {
    await this.finalize(key, attemptId, record);
  }

  async markPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    record: PreparedCompletionRecord,
  ): Promise<void> {
    const result = await this.collection.replaceOne(
      {
        _id: documentId(key),
        status: "processing",
        phase: "locked",
        attemptId,
      },
      withRetention(record),
    );
    if (result.matchedCount !== 1) {
      throw new Error("Completion lock ownership changed.");
    }
  }

  async clearLocked(
    key: CompletionStoreKey,
    attemptId: string,
  ): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: documentId(key),
      status: "processing",
      phase: "locked",
      attemptId,
    });
    return result.deletedCount === 1;
  }

  async listPreparedBefore(
    preparedBefore: string,
    limit: number,
  ): Promise<PreparedCompletionEntry[]> {
    if (
      !Number.isFinite(Date.parse(preparedBefore)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new Error("Invalid prepared-completion query.");
    }
    const documents = await this.collection
      .find({
        status: "processing",
        phase: "prepared",
        preparedAt: { $lte: preparedBefore },
      })
      .sort({ lastReconciledAt: 1, preparedAt: 1 })
      .limit(limit)
      .toArray();

    return documents.map((document) => {
      const { _id, expiresAt, ...candidate } = document;
      if (
        !(expiresAt instanceof Date) ||
        Number.isNaN(expiresAt.getTime())
      ) {
        throw new Error("Completion document retention is invalid.");
      }
      const record = completionRecordSchema.parse(candidate);
      if (record.status !== "processing" || record.phase !== "prepared") {
        throw new Error("Prepared completion query returned another state.");
      }
      return { key: keyFromDocumentId(_id), record };
    });
  }

  async touchPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    reconciledAt: string,
  ): Promise<void> {
    if (!Number.isFinite(Date.parse(reconciledAt))) {
      throw new Error("Invalid prepared reconciliation timestamp.");
    }
    await this.collection.updateOne(
      {
        _id: documentId(key),
        status: "processing",
        phase: "prepared",
        attemptId,
      },
      { $set: { lastReconciledAt: reconciledAt } },
    );
  }

  private async finalize(
    key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord | ReviewCompletionRecord,
  ): Promise<void> {
    const _id = documentId(key);
    const result = await this.collection.replaceOne(
      { _id, status: "processing", attemptId },
      withRetention(record),
    );
    if (result.matchedCount !== 1) {
      throw new Error("Completion was not in the processing state.");
    }
  }
}

let mongoClientPromise: Promise<MongoClient> | undefined;
let completionIndexesPromise: Promise<void> | undefined;

export async function createCompletionStoreFromEnv(): Promise<MongoCompletionStore> {
  const collection = await getCompletionCollection();
  return new MongoCompletionStore(collection);
}

export async function checkCompletionStoreFromEnv(): Promise<void> {
  const client = await getMongoClient();
  await getCompletionCollection();
  await client.db("admin").command({ ping: 1 });
}

async function getCompletionCollection(): Promise<
  Collection<CompletionDocument>
> {
  const client = await getMongoClient();
  const collection = client
    .db("hotcrush_hbti")
    .collection<CompletionDocument>("completions");
  completionIndexesPromise ??= Promise.all([
    collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collection.createIndex({
      status: 1,
      phase: 1,
      lastReconciledAt: 1,
      preparedAt: 1,
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      completionIndexesPromise = undefined;
      throw error;
    });
  await completionIndexesPromise;
  return collection;
}

async function getMongoClient(): Promise<MongoClient> {
  const connectionString = requireEnvironmentVariable("MONGODB_URI");
  if (
    !connectionString.startsWith("mongodb://") &&
    !connectionString.startsWith("mongodb+srv://")
  ) {
    throw new Error("MONGODB_URI is invalid.");
  }

  mongoClientPromise ??= new MongoClient(connectionString, {
    appName: "hotcrush-hbti",
    maxPoolSize: 5,
    maxIdleTimeMS: 10_000,
    serverSelectionTimeoutMS: 8_000,
    retryWrites: true,
    writeConcern: {
      w: "majority",
      j: true,
    },
  })
    .connect()
    .catch((error) => {
      mongoClientPromise = undefined;
      throw error;
    });

  return mongoClientPromise;
}

function withRetention(
  record:
    | ProcessingCompletionRecord
    | IssuedCompletionRecord
    | ReviewCompletionRecord,
): Omit<CompletionDocument, "_id"> {
  return {
    ...record,
    expiresAt: new Date(Date.now() + 548 * 24 * 60 * 60 * 1_000),
  };
}

function documentId(key: CompletionStoreKey): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key.campaignVersion) ||
    !/^[a-f0-9]{64}$/.test(key.memberHash)
  ) {
    throw new Error("Invalid completion-store key.");
  }
  return `${key.campaignVersion}:${key.memberHash}`;
}

function keyFromDocumentId(id: string): CompletionStoreKey {
  const match =
    /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([a-f0-9]{64})$/.exec(id);
  if (!match) {
    throw new Error("Invalid completion document identity.");
  }
  return {
    campaignVersion: match[1],
    memberHash: match[2],
  };
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
