const pending: (() => void)[] = [];

export function cleanupAfterTests(cleanup: () => void) {
  pending.push(cleanup);
}

export function runCleanups() {
  const errors: unknown[] = [];
  for (const cleanup of pending.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, `${errors.length} test cleanup(s) failed`);
}
