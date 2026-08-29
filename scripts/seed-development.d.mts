export function ensureDevelopmentTeam(options?: {
  emulatorHost?: string;
  projectId?: string;
}): Promise<{ created: boolean; teamId: string }>;
