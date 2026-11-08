import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // `error` covers the missing case; .min(1) covers `ANTHROPIC_API_KEY=` (empty).
  ANTHROPIC_API_KEY: z
    .string({ error: 'is required (the only provider this project is tested with)' })
    .min(1, 'is required (the only provider this project is tested with)'),
});

export type Env = z.infer<typeof EnvSchema>;

/** DI token for the validated environment. Inject with `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

/**
 * Validates raw environment variables. Throws one error listing every
 * problem at once, so a misconfigured deploy fails at startup with the
 * full picture rather than one variable at a time.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
