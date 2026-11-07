import { readFirebaseAdminRuntimeConfig } from "@/lib/server/environment";

function isLoopback(host: string | undefined): boolean {
  const port = /^(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/.exec(
    host ?? "",
  )?.[1];
  return port !== undefined && Number(port) <= 65535;
}

export function wrappedLocalEnabled(): boolean {
  if (
    process.env.VERCEL ||
    process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT !== "local"
  )
    return false;
  const config = readFirebaseAdminRuntimeConfig();
  return (
    config.emulator &&
    /^demo-[a-z0-9][a-z0-9-]{0,24}$/.test(config.projectId) &&
    isLoopback(config.firestoreEmulatorHost) &&
    isLoopback(config.authEmulatorHost)
  );
}
