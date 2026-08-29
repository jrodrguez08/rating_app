"use client";

import { useEffect } from "react";

import { ensureAnonymousVoter } from "@/lib/firebase/voter-auth";

export function VoterIdentityInitializer() {
  useEffect(() => {
    void ensureAnonymousVoter().catch(() => {
      console.error("Unable to prepare the voter session.");
    });
  }, []);

  return null;
}
