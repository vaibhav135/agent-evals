import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunPlan } from './plan-run';

/** Executes a RunPlan on disk. All decisions were made (and tested) in planRun. */
export async function writePlan(plan: RunPlan): Promise<void> {
  await mkdir(plan.homeDir, { recursive: true });
  await mkdir(plan.workspaceDir, { recursive: true });
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }
  for (const copy of plan.copies) {
    await cp(copy.from, copy.to, { recursive: true });
  }
}
