import {
  Firestore,
  Query,
  Transaction,
  type DocumentSnapshot,
  type QuerySnapshot,
} from "firebase-admin/firestore";
import { vi } from "vitest";

// Observe real SDK calls, including transaction retries. These are document-read
// estimates, not emulator billing: empty queries cost one, batch refs deduplicate.
export async function measureReads<T>(work: () => Promise<T>) {
  const queries = vi.spyOn(Query.prototype, "get");
  const batches = vi.spyOn(Firestore.prototype, "getAll");
  const transactionReads = vi.spyOn(Transaction.prototype, "get");
  const transactionBatches = vi.spyOn(Transaction.prototype, "getAll");
  try {
    const value = await work();
    let documents = 0;
    let queryCount = 0;
    const paths: string[] = [];
    const batchSizes: number[] = [];
    const snapshots = await Promise.all(
      [
        ...queries.mock.results,
        ...batches.mock.results,
        ...transactionReads.mock.results,
        ...transactionBatches.mock.results,
      ]
        .filter((result) => result.type === "return")
        .map(
          (result) =>
            result.value as Promise<
              DocumentSnapshot | QuerySnapshot | DocumentSnapshot[]
            >,
        ),
    );
    for (const snapshot of snapshots) {
      if (Array.isArray(snapshot)) {
        batchSizes.push(snapshot.length);
        const uniquePaths = [...new Set(snapshot.map((doc) => doc.ref.path))];
        documents += uniquePaths.length;
        paths.push(...uniquePaths);
      } else if ("docs" in snapshot) {
        queryCount += 1;
        documents += Math.max(1, snapshot.size);
        paths.push(...snapshot.docs.map((doc) => doc.ref.path));
      } else {
        documents += 1;
        paths.push(snapshot.ref.path);
      }
    }
    return { value, documents, queries: queryCount, paths, batchSizes };
  } finally {
    queries.mockRestore();
    batches.mockRestore();
    transactionReads.mockRestore();
    transactionBatches.mockRestore();
  }
}
