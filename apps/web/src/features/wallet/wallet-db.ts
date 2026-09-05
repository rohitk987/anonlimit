import type {
  ChallengeResponse,
  IssuanceResponse,
  Presentation,
  UseStatusResponse,
} from "@anonlimit/contracts";

const DATABASE_NAME = "anonlimit-wallet";
const DATABASE_VERSION = 1;
const CREDENTIALS_STORE = "credentials";
const OPERATIONS_STORE = "operations";

export interface WalletCredentialRecord {
  readonly id: "active";
  readonly credential: string;
  readonly demoRunId: string;
  readonly policy: IssuanceResponse["policy"];
  readonly nextSlot: number;
  readonly updatedAt: string;
}

export interface PendingOperationRecord {
  readonly operationId: string;
  readonly hiddenSlot: number;
  readonly action: Presentation["action"];
  readonly intentDigest: string;
  readonly nullifier: string;
  readonly envelope: Presentation;
  readonly challenge: ChallengeResponse;
  readonly state: "PENDING" | "SUCCEEDED" | "FAILED";
  readonly useId?: string;
  readonly result?: UseStatusResponse;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CREDENTIALS_STORE))
        database.createObjectStore(CREDENTIALS_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(OPERATIONS_STORE))
        database.createObjectStore(OPERATIONS_STORE, { keyPath: "operationId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("WALLET_STORAGE_UNAVAILABLE"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("WALLET_STORAGE_UNAVAILABLE"));
  });
}

export async function readCredential(): Promise<WalletCredentialRecord | null> {
  const database = await openDatabase();
  try {
    return (
      (await requestResult(
        database.transaction(CREDENTIALS_STORE).objectStore(CREDENTIALS_STORE).get("active")
      )) ?? null
    );
  } finally {
    database.close();
  }
}

export async function saveCredential(record: WalletCredentialRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(CREDENTIALS_STORE, "readwrite")
        .objectStore(CREDENTIALS_STORE)
        .put(record)
    );
  } finally {
    database.close();
  }
}

export async function readLatestOperation(): Promise<PendingOperationRecord | null> {
  const database = await openDatabase();
  try {
    const records = (await requestResult(
      database.transaction(OPERATIONS_STORE).objectStore(OPERATIONS_STORE).getAll()
    )) as PendingOperationRecord[];
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return records[0] ?? null;
  } finally {
    database.close();
  }
}

export async function saveOperation(record: PendingOperationRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database.transaction(OPERATIONS_STORE, "readwrite").objectStore(OPERATIONS_STORE).put(record)
    );
  } finally {
    database.close();
  }
}
