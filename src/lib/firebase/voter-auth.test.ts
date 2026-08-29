import { FirebaseError } from "firebase/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInAnonymously = vi.fn();
const getBrowserAuth = vi.fn();

vi.mock("firebase/auth", () => ({ signInAnonymously }));
vi.mock("./browser", () => ({ getBrowserAuth }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("ensureAnonymousVoter", () => {
  it("reuses the initialized authenticated user", async () => {
    getBrowserAuth.mockReturnValue({
      authStateReady: vi.fn().mockResolvedValue(undefined),
      currentUser: { uid: "existing-voter" },
    });
    const { ensureAnonymousVoter } = await import("./voter-auth");

    await expect(ensureAnonymousVoter()).resolves.toEqual({
      voterId: "existing-voter",
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("signs in anonymously when initialization has no user", async () => {
    const auth = {
      authStateReady: vi.fn().mockResolvedValue(undefined),
      currentUser: null,
    };
    getBrowserAuth.mockReturnValue(auth);
    signInAnonymously.mockResolvedValue({ user: { uid: "new-voter" } });
    const { ensureAnonymousVoter } = await import("./voter-auth");

    await expect(ensureAnonymousVoter()).resolves.toEqual({
      voterId: "new-voter",
    });
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(signInAnonymously).toHaveBeenCalledWith(auth);
  });

  it("shares one sign-in across concurrent callers", async () => {
    let finishSignIn: ((value: { user: { uid: string } }) => void) | undefined;
    getBrowserAuth.mockReturnValue({
      authStateReady: vi.fn().mockResolvedValue(undefined),
      currentUser: null,
    });
    signInAnonymously.mockReturnValue(
      new Promise((resolve) => {
        finishSignIn = resolve;
      }),
    );
    const { ensureAnonymousVoter } = await import("./voter-auth");
    const first = ensureAnonymousVoter();
    const second = ensureAnonymousVoter();
    finishSignIn?.({ user: { uid: "stable-voter" } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { voterId: "stable-voter" },
      { voterId: "stable-voter" },
    ]);
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it.each([
    ["auth/network-request-failed", "unavailable"],
    ["auth/operation-not-allowed", "disabled"],
  ])("maps %s without exposing its raw message", async (firebaseCode, code) => {
    getBrowserAuth.mockReturnValue({
      authStateReady: vi.fn().mockResolvedValue(undefined),
      currentUser: null,
    });
    signInAnonymously.mockRejectedValue(
      new FirebaseError(firebaseCode, "sensitive provider detail"),
    );
    const { ensureAnonymousVoter, VoterIdentityError } =
      await import("./voter-auth");

    const error = await ensureAnonymousVoter().catch((caught) => caught);
    expect(error).toBeInstanceOf(VoterIdentityError);
    expect(error).toMatchObject({ code });
    expect(error.message).toBe("Unable to prepare voter identity.");
    expect(error.message).not.toContain("sensitive");
  });
});
