// Schemas shared by the API (runtime validation) and the web app (types).
// Domain schemas (tasks, graders, configs, runs) land here as they are built.
import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
