import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAnonymousVoter: vi.fn(),
  reportVoterIdentityFailure: vi.fn(),
}));

vi.mock("@/lib/firebase/voter-auth", () => ({
  ensureAnonymousVoter: mocks.ensureAnonymousVoter,
}));
vi.mock("@/lib/firebase/voter-identity-diagnostics", () => ({
  reportVoterIdentityFailure: mocks.reportVoterIdentityFailure,
}));

import { VoterIdentityInitializer } from "./voter-identity-initializer";

describe("VoterIdentityInitializer", () => {
  it("logs one failure when Strict Mode supersedes its first effect", async () => {
    let rejectAttempt: ((error: Error) => void) | undefined;
    const attempt = new Promise<never>((_resolve, reject) => {
      rejectAttempt = reject;
    });
    mocks.ensureAnonymousVoter.mockReturnValue(attempt);

    render(
      <StrictMode>
        <VoterIdentityInitializer />
      </StrictMode>,
    );
    const error = new Error("auth failed");
    rejectAttempt?.(error);

    await waitFor(() =>
      expect(mocks.reportVoterIdentityFailure).toHaveBeenCalledOnce(),
    );
    expect(mocks.reportVoterIdentityFailure).toHaveBeenCalledWith(error);
  });
});
