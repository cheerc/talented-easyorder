export type ClearFirestoreDiagnostic = (
  attempt: 1 | 2,
  classification: 'http-500-unknown' | 'non-retriable',
  error: unknown,
) => void;

function isHttp500Unknown(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  try {
    const body = JSON.parse(error.message) as { error?: { code?: unknown; status?: unknown } };
    return body.error?.code === 500 && body.error.status === 'UNKNOWN';
  } catch {
    return false;
  }
}

export function createInitialFirestoreCleaner(
  clearFirestore: () => Promise<void>,
  onDiagnostic: ClearFirestoreDiagnostic,
): () => Promise<void> {
  let initialResetComplete = false;
  let initialResetFailed = false;
  let initialResetError: unknown;

  return async () => {
    if (initialResetFailed) throw initialResetError;
    if (initialResetComplete) {
      await clearFirestore();
      return;
    }

    try {
      await clearFirestore();
      initialResetComplete = true;
    } catch (error) {
      initialResetFailed = true;
      initialResetError = error;
      if (isHttp500Unknown(error)) onDiagnostic(1, 'http-500-unknown', error);
      throw error;
    }
  };
}
