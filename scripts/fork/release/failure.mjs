// Release preconditions abort with an actionable message instead of a crash dump.
// Programming bugs keep their stack trace; user-fixable state does not.
// Set PASEO_RELEASE_DEBUG=1 to see the stack for every release failure.
export class ReleaseFailure extends Error {
  name = "ReleaseFailure";
}

export function failRelease(message, options) {
  throw new ReleaseFailure(message, options);
}

// Re-raise a precondition error from a shared module as a release failure.
export function failReleaseFrom(error) {
  if (error instanceof ReleaseFailure) throw error;
  failRelease(error.message, { cause: error });
}

export function reportFailure(error) {
  if (error instanceof ReleaseFailure && process.env.PASEO_RELEASE_DEBUG !== "1") {
    console.error(`\n${error.message}`);
    return;
  }
  console.error(error);
}

export async function runRelease(action) {
  try {
    await action();
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  }
}
