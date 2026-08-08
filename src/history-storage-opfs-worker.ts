import { HISTORY_LOCAL_STORAGE_COMMIT_MAGIC } from "./history-storage-core";
import type {
  HistoryOpfsWorkerRequest,
  HistoryOpfsWorkerResponse,
} from "./history-storage-opfs-client";

interface SyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  getSize(): number;
  close(): void;
}

interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

interface OpenWriter {
  readonly sessionId: string;
  readonly segmentId: string;
  readonly directory: FileSystemDirectoryHandle;
  readonly access: SyncAccessHandle;
  offset: number;
}

type WorkerScope = {
  navigator: Navigator & {
    storage: StorageManager & { getDirectory(): Promise<FileSystemDirectoryHandle> };
  };
  onmessage: ((event: MessageEvent<HistoryOpfsWorkerRequest>) => void) | null;
  postMessage(message: HistoryOpfsWorkerResponse, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
const writers = new Map<string, OpenWriter>();
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const safeName = /^[a-zA-Z0-9_-]+$/;
const rootDirectoryName = "m1m4-history-v1";

scope.onmessage = (event): void => {
  const request = event.data;
  void handleRequest(request).catch((error) => {
    scope.postMessage({
      type: "error",
      id: request.id,
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function handleRequest(request: HistoryOpfsWorkerRequest): Promise<void> {
  if (request.type === "self-test") {
    try {
      await runSelfTest();
      scope.postMessage({ type: "self-test", id: request.id, supported: true, reason: null });
    } catch (error) {
      scope.postMessage({
        type: "self-test",
        id: request.id,
        supported: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (request.type === "begin") {
    validateName(request.sessionId, "sessione");
    validateName(request.segmentId, "segmento");
    if (writers.has(request.writerId)) throw new Error("Writer OPFS History duplicato.");
    const directory = await sessionDirectory(request.sessionId, true);
    const fileName = segmentFileName(request.segmentId);
    let access: SyncAccessHandle | null = null;
    try {
      const file = await directory.getFileHandle(fileName, { create: true });
      access = await (file as SyncFileHandle).createSyncAccessHandle();
      access.truncate(0);
      writers.set(request.writerId, {
        sessionId: request.sessionId,
        segmentId: request.segmentId,
        directory,
        access,
        offset: 0,
      });
    } catch (error) {
      try {
        access?.close();
      } finally {
        await directory.removeEntry(fileName).catch(() => undefined);
      }
      throw error;
    }
    scope.postMessage({ type: "ok", id: request.id });
    return;
  }
  if (request.type === "append") {
    const writer = requireWriter(request.writerId);
    const bytes = new Uint8Array(request.bytes);
    const offset = writer.offset;
    writeAll(writer.access, bytes, offset);
    writer.offset += bytes.byteLength;
    scope.postMessage({ type: "ok", id: request.id, offset });
    return;
  }
  if (request.type === "finish") {
    const writer = requireWriter(request.writerId);
    const footer = encoder.encode(request.footerJson);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, footer.byteLength, true);
    const magic = encoder.encode(HISTORY_LOCAL_STORAGE_COMMIT_MAGIC);
    writeAll(writer.access, footer, writer.offset);
    writer.offset += footer.byteLength;
    writeAll(writer.access, length, writer.offset);
    writer.offset += length.byteLength;
    writeAll(writer.access, magic, writer.offset);
    writer.offset += magic.byteLength;
    writer.access.flush();
    writer.access.close();
    writers.delete(request.writerId);
    scope.postMessage({ type: "ok", id: request.id });
    return;
  }
  if (request.type === "abort") {
    const writer = writers.get(request.writerId);
    if (writer) {
      try {
        writer.access.close();
      } finally {
        writers.delete(request.writerId);
        await writer.directory.removeEntry(segmentFileName(writer.segmentId)).catch(() => undefined);
      }
    }
    scope.postMessage({ type: "ok", id: request.id });
    return;
  }
  if (request.type === "verify") {
    const access = await openReadHandle(request.sessionId, request.segmentId);
    try {
      const footer = readAndValidateFooter(access);
      if (
        footer.segmentId !== request.segmentId
        || footer.commitNonce !== request.commitNonce
        || footer.descriptorSha256 !== request.descriptorSha256
      ) {
        throw new Error("Footer OPFS History non corrisponde al descriptor.");
      }
      for (const chunk of request.chunks) {
        assertBoundedRange(access.getSize(), chunk.fileOffset, chunk.storedBytes);
        const bytes = readExactly(access, chunk.fileOffset, chunk.storedBytes);
        const digest = await sha256Hex(bytes);
        if (digest !== chunk.storedSha256) {
          throw new Error("Hash chunk OPFS History non valido.");
        }
      }
    } finally {
      access.close();
    }
    scope.postMessage({ type: "ok", id: request.id });
    return;
  }
  if (request.type === "read") {
    const access = await openReadHandle(request.sessionId, request.segmentId);
    let bytes: Uint8Array;
    try {
      assertBoundedRange(access.getSize(), request.offset, request.length);
      bytes = readExactly(access, request.offset, request.length);
    } finally {
      access.close();
    }
    const output = bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : bytes.slice().buffer as ArrayBuffer;
    scope.postMessage({ type: "read", id: request.id, bytes: output }, [output]);
    return;
  }
  if (request.type === "delete-segment") {
    try {
      const directory = await sessionDirectory(request.sessionId, false);
      await directory.removeEntry(segmentFileName(request.segmentId));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    scope.postMessage({ type: "ok", id: request.id });
    return;
  }
  try {
    const root = await historyRoot(false);
    await root.removeEntry(request.sessionId, { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  scope.postMessage({ type: "ok", id: request.id });
}

async function runSelfTest(): Promise<void> {
  if (!scope.navigator.storage?.getDirectory) throw new Error("OPFS getDirectory assente.");
  const root = await historyRoot(true);
  const name = `probe-${crypto.randomUUID()}`;
  let access: SyncAccessHandle | null = null;
  try {
    const file = await root.getFileHandle(name, { create: true });
    access = await (file as SyncFileHandle).createSyncAccessHandle();
    const expected = new Uint8Array([0x4d, 0x31, 0x4d, 0x34]);
    writeAll(access, expected, 0);
    access.flush();
    const actual = readExactly(access, 0, expected.byteLength);
    if (actual.some((value, index) => value !== expected[index])) {
      throw new Error("Roundtrip OPFS non byte-identico.");
    }
  } finally {
    try {
      access?.close();
    } finally {
      await root.removeEntry(name).catch(() => undefined);
    }
  }
}

async function historyRoot(create: boolean): Promise<FileSystemDirectoryHandle> {
  const originRoot = await scope.navigator.storage.getDirectory();
  return await originRoot.getDirectoryHandle(rootDirectoryName, { create });
}

async function sessionDirectory(
  sessionId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  validateName(sessionId, "sessione");
  return await (await historyRoot(create)).getDirectoryHandle(sessionId, { create });
}

async function openReadHandle(sessionId: string, segmentId: string): Promise<SyncAccessHandle> {
  validateName(segmentId, "segmento");
  const directory = await sessionDirectory(sessionId, false);
  const file = await directory.getFileHandle(segmentFileName(segmentId));
  return await (file as SyncFileHandle).createSyncAccessHandle();
}

function requireWriter(writerId: string): OpenWriter {
  const writer = writers.get(writerId);
  if (!writer) throw new Error("Writer OPFS History non trovato.");
  return writer;
}

function segmentFileName(segmentId: string): string {
  validateName(segmentId, "segmento");
  return `${segmentId}.segment`;
}

function validateName(value: string, label: string): void {
  if (!safeName.test(value)) throw new Error(`Nome ${label} OPFS non valido.`);
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function writeAll(access: SyncAccessHandle, bytes: Uint8Array, offset: number): void {
  let written = 0;
  while (written < bytes.byteLength) {
    const count = access.write(bytes.subarray(written), { at: offset + written });
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("Scrittura OPFS parziale senza avanzamento.");
    }
    written += count;
  }
}

function readExactly(access: SyncAccessHandle, offset: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const count = access.read(bytes.subarray(read), { at: offset + read });
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("Lettura OPFS terminata prima dei byte attesi.");
    }
    read += count;
  }
  return bytes;
}

function readAndValidateFooter(access: SyncAccessHandle): {
  readonly segmentId: string;
  readonly commitNonce: string;
  readonly descriptorSha256: string;
} {
  const fileSize = access.getSize();
  const magic = encoder.encode(HISTORY_LOCAL_STORAGE_COMMIT_MAGIC);
  if (fileSize < magic.byteLength + 4) throw new Error("Footer OPFS History assente.");
  const actualMagic = readExactly(access, fileSize - magic.byteLength, magic.byteLength);
  if (actualMagic.some((value, index) => value !== magic[index])) {
    throw new Error("Magic commit OPFS History assente.");
  }
  const lengthBytes = readExactly(access, fileSize - magic.byteLength - 4, 4);
  const footerLength = new DataView(lengthBytes.buffer).getUint32(0, true);
  const footerOffset = fileSize - magic.byteLength - 4 - footerLength;
  if (footerLength <= 0 || footerLength > 1024 * 1024 || footerOffset < 0) {
    throw new Error("Lunghezza footer OPFS History non valida.");
  }
  const parsed = JSON.parse(decoder.decode(readExactly(access, footerOffset, footerLength))) as {
    magic?: unknown;
    segmentId?: unknown;
    commitNonce?: unknown;
    descriptorSha256?: unknown;
  };
  if (
    parsed.magic !== HISTORY_LOCAL_STORAGE_COMMIT_MAGIC
    || typeof parsed.segmentId !== "string"
    || typeof parsed.commitNonce !== "string"
    || typeof parsed.descriptorSha256 !== "string"
  ) {
    throw new Error("Footer OPFS History malformato.");
  }
  return {
    segmentId: parsed.segmentId,
    commitNonce: parsed.commitNonce,
    descriptorSha256: parsed.descriptorSha256,
  };
}

function assertBoundedRange(fileSize: number, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > fileSize
  ) {
    throw new Error("Range OPFS History fuori dal file.");
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.slice().buffer as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export {};
