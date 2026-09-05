import type {
  ChallengeResponse,
  IssuanceResponse,
  Presentation,
  UseResult,
  UseStatusResponse,
} from "@anonlimit/contracts";

const DATABASE_NAME = "anonlimit-wallet";
const DATABASE_VERSION = 1;
const CREDENTIALS_STORE = "credentials";
const OPERATIONS_STORE = "operations";

export interface WalletCredentialRecord {
  readonly id: "active";
  /** Local-only handle used to prevent one browser credential from retiring another's slot. */
  readonly walletCredentialId: string;
  readonly credential: string;
  readonly demoRunId: string;
  readonly policy: IssuanceResponse["policy"];
  readonly nextSlot: number;
  readonly preparedOperationId?: string;
  readonly updatedAt: string;
}

export interface PendingOperationRecord {
  readonly operationId: string;
  /** Optional only for records created before the Phase 5 wallet binding migration. */
  readonly walletCredentialId?: string;
  /** Optional only for records created before the Phase 5 wallet binding migration. */
  readonly demoRunId?: string;
  readonly dropAckArmed?: boolean;
  readonly hiddenSlot: number;
  readonly action: Presentation["action"];
  readonly intentDigest: string;
  readonly nullifier: string;
  readonly envelope: Presentation;
  readonly serializedEnvelope: string;
  readonly challenge: ChallengeResponse;
  readonly state: "PENDING" | "OUTCOME_UNKNOWN" | "SUCCEEDED" | "FAILED";
  readonly useId?: string;
  readonly result?: UseStatusResponse;
  readonly retryResult?: UseResult;
  readonly failureCode?: string;
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

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error("WALLET_STORAGE_UNAVAILABLE"));
    transaction.onerror = () => reject(new Error("WALLET_STORAGE_UNAVAILABLE"));
  });
}

export async function readCredential(): Promise<WalletCredentialRecord | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CREDENTIALS_STORE, "readwrite");
    const completed = transactionResult(transaction);
    const store = transaction.objectStore(CREDENTIALS_STORE);
    const stored = (await requestResult(store.get("active"))) as
      | (Omit<WalletCredentialRecord, "walletCredentialId"> & {
          readonly walletCredentialId?: string;
        })
      | undefined;
    if (!stored) {
      await completed;
      return null;
    }
    if (typeof stored.walletCredentialId === "string") {
      await completed;
      return stored as WalletCredentialRecord;
    }
    const migrated: WalletCredentialRecord = {
      ...stored,
      walletCredentialId: globalThis.crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    store.put(migrated);
    await completed;
    return migrated;
  } finally {
    database.close();
  }
}

export async function saveCredential(record: WalletCredentialRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CREDENTIALS_STORE, "readwrite");
    const completed = transactionResult(transaction);
    transaction.objectStore(CREDENTIALS_STORE).put(record);
    await completed;
  } finally {
    database.close();
  }
}

/**
 * Removes this browser's wallet only after the server has replaced the active demo run. Both
 * stores clear in one IndexedDB transaction, so a storage failure leaves the credential and its
 * saved operation available for a retry rather than clearing only part of the wallet.
 */
export async function clearWalletAfterDemoReset(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CREDENTIALS_STORE, OPERATIONS_STORE], "readwrite");
    const completed = transactionResult(transaction);
    transaction.objectStore(CREDENTIALS_STORE).clear();
    transaction.objectStore(OPERATIONS_STORE).clear();
    await completed;
  } finally {
    database.close();
  }
}

/** Prevents two first-load tabs from replacing each other's newly issued local credential. */
export async function saveCredentialIfAbsent(record: WalletCredentialRecord): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CREDENTIALS_STORE, "readwrite");
    const completed = transactionResult(transaction);
    const store = transaction.objectStore(CREDENTIALS_STORE);
    const existing = await requestResult(store.get("active"));
    if (existing) {
      await completed;
      return false;
    }
    store.put(record);
    await completed;
    return true;
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
    const transaction = database.transaction(OPERATIONS_STORE, "readwrite");
    const completed = transactionResult(transaction);
    transaction.objectStore(OPERATIONS_STORE).put(record);
    await completed;
  } finally {
    database.close();
  }
}

function credentialWithoutPreparedOperation(
  credential: WalletCredentialRecord,
  nextSlot: number
): WalletCredentialRecord {
  return {
    id: credential.id,
    walletCredentialId: credential.walletCredentialId,
    credential: credential.credential,
    demoRunId: credential.demoRunId,
    policy: credential.policy,
    nextSlot,
    updatedAt: new Date().toISOString(),
  };
}

function operationMatchesCredential(
  operation: PendingOperationRecord,
  credential: WalletCredentialRecord
): boolean {
  return (
    operation.walletCredentialId === credential.walletCredentialId &&
    operation.demoRunId === credential.demoRunId
  );
}

/**
 * Persists a terminal accepted operation and retires its reserved slot in one IndexedDB
 * transaction. The local credential/run binding prevents a stale tab from advancing a newly
 * issued credential.
 */
export async function completeAcceptedOperation(record: PendingOperationRecord): Promise<void> {
  if (
    (record.state !== "SUCCEEDED" && record.state !== "FAILED") ||
    (record.result?.status !== "SUCCEEDED" && record.result?.status !== "FAILED_FINAL")
  )
    throw new Error("WALLET_OPERATION_NOT_TERMINAL");
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CREDENTIALS_STORE, OPERATIONS_STORE], "readwrite");
    const completed = transactionResult(transaction);
    const credentialStore = transaction.objectStore(CREDENTIALS_STORE);
    const credential = (await requestResult(credentialStore.get("active"))) as
      WalletCredentialRecord | undefined;
    if (!credential || !operationMatchesCredential(record, credential)) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error("WALLET_CREDENTIAL_MISMATCH");
    }
    if (
      !Number.isSafeInteger(record.hiddenSlot) ||
      record.hiddenSlot < 0 ||
      record.hiddenSlot >= credential.policy.maxUses
    ) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error("WALLET_SLOT_INVALID");
    }
    const nextSlot = Math.max(credential.nextSlot, record.hiddenSlot + 1);
    transaction.objectStore(OPERATIONS_STORE).put(record);
    credentialStore.put(credentialWithoutPreparedOperation(credential, nextSlot));
    await completed;
  } finally {
    database.close();
  }
}

/** Clears a prepared operation only when the active local credential still owns it. */
export async function clearPreparedOperation(
  walletCredentialId: string,
  operationId: string
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CREDENTIALS_STORE, "readwrite");
    const completed = transactionResult(transaction);
    const store = transaction.objectStore(CREDENTIALS_STORE);
    const credential = (await requestResult(store.get("active"))) as
      WalletCredentialRecord | undefined;
    if (
      credential?.walletCredentialId === walletCredentialId &&
      credential.preparedOperationId === operationId
    )
      store.put(credentialWithoutPreparedOperation(credential, credential.nextSlot));
    await completed;
  } finally {
    database.close();
  }
}
