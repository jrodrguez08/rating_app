import { getServerAuth } from "@/lib/firebase/server";

export async function verifyVoterRequest(
  authorization: string | null,
): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (token === "") return null;
  try {
    return (await getServerAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}
