"use client";

import { useEffect } from "react";

import { reportVoterIdentityFailure } from "@/lib/firebase/voter-identity-diagnostics";
import { ensureAnonymousVoter } from "@/lib/firebase/voter-auth";

export function VoterIdentityInitializer() {
  useEffect(() => {
    let active = true;
    void ensureAnonymousVoter().catch((error: unknown) => {
      if (active) reportVoterIdentityFailure(error);
    });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
