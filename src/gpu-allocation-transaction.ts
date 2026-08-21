export interface GpuAllocationErrorScopeHost {
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

/**
 * Tracks resources created by one fallible GPU allocation attempt.
 *
 * WebGPU allocation failures are reported asynchronously through error scopes:
 * createTexture/createBuffer can return an invalid object without throwing. A
 * JavaScript try/catch is therefore not a transaction boundary by itself.
 */
export class GpuAllocationTransaction {
  private rollbackActions: Array<() => void> = [];

  deferRollback(action: () => void): void {
    this.rollbackActions.push(action);
  }

  commit(): void {
    this.rollbackActions.length = 0;
  }

  rollback(): void {
    let firstError: unknown = null;
    for (let index = this.rollbackActions.length - 1; index >= 0; index -= 1) {
      try {
        this.rollbackActions[index]();
      } catch (error) {
        firstError ??= error;
      }
    }
    this.rollbackActions.length = 0;
    if (firstError !== null) {
      throw firstError;
    }
  }
}

/**
 * Runs one candidate allocation under both WebGPU error filters.
 *
 * The validation scope is nested inside the out-of-memory scope, so pop order
 * is validation then OOM. Cleanup runs for synchronous exceptions, rejected
 * promises and errors reported only when the scopes are popped.
 */
export async function runGpuAllocationTransaction<T>(
  host: GpuAllocationErrorScopeHost,
  label: string,
  operation: (transaction: GpuAllocationTransaction) => T | Promise<T>,
): Promise<T> {
  const transaction = new GpuAllocationTransaction();
  host.pushErrorScope("out-of-memory");
  host.pushErrorScope("validation");

  let result!: T;
  let operationError: unknown = null;
  try {
    result = await operation(transaction);
  } catch (error) {
    operationError = error;
  }

  let validationError: unknown = null;
  let outOfMemoryError: unknown = null;
  try {
    validationError = await host.popErrorScope();
  } catch (error) {
    validationError = error;
  }
  try {
    outOfMemoryError = await host.popErrorScope();
  } catch (error) {
    outOfMemoryError = error;
  }

  const reportedErrors = [validationError, outOfMemoryError].filter(
    (error): error is NonNullable<typeof error> => error !== null,
  );
  const failure = operationError ?? (
    reportedErrors.length > 0
      ? new Error(`${label}: ${reportedErrors.map(errorMessage).join(" · ")}`)
      : null
  );
  if (failure !== null) {
    try {
      transaction.rollback();
    } catch (rollbackError) {
      throw new Error(
        `${errorMessage(failure)}; cleanup failed: ${errorMessage(rollbackError)}`,
      );
    }
    throw failure;
  }

  transaction.commit();
  return result;
}
