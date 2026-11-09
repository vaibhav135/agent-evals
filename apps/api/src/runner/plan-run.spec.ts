import { describe, expect, it } from 'vitest';
import { planRun, type RunConfig, type RunPlan, type RunTask } from './plan-run';

const sandbox = { kind: 'docker', image: 'python:3.13-slim' } as const;
const paths = { runDir: '/runs/r1', skillsSourceDir: '/repo/suites/skills', sandbox };
const knownSkills = new Set(['crm-lead-handling', 'other-skill']);

const baseConfig: RunConfig = {
  model: 'claude-haiku-5.5',
  provider: 'anthropic',
  skills: [],
  skillMode: 'installed',
  memoryMode: 'off',
  memorySeed: null,
  toolsets: ['file', 'terminal'],
  maxIterations: 30,
  runBudgetS: 300,
};

const baseTask: RunTask = {
  sessions: [{ prompt: 'Score the leads in leads.csv' }],
  fixtures: { 'leads.csv': 'name,budget\nA,100\n' },
  maxIterations: 30,
  timeoutS: 300,
};

const plan = (config: Partial<RunConfig> = {}, task: Partial<RunTask> = {}) =>
  planRun({ ...baseConfig, ...config }, { ...baseTask, ...task }, paths, knownSkills);

const fileAt = (p: RunPlan, path: string) => p.files.find((f) => f.path === path)?.content;
const hermesConfig = (p: RunPlan) => JSON.parse(fileAt(p, '/runs/r1/home/config.yaml')!);

describe('layout', () => {
  it('puts everything under the run directory', () => {
    const p = plan();
    expect(p).toMatchObject({
      homeDir: '/runs/r1/home',
      workspaceDir: '/runs/r1/workspace',
      specPath: '/runs/r1/spec.json',
      outputPath: '/runs/r1/result.json',
    });
    expect(p.spec).toMatchObject({ workspace: '/runs/r1/workspace', outputPath: '/runs/r1/result.json' });
  });

  it('writes the driver spec as a file', () => {
    const p = plan();
    expect(JSON.parse(fileAt(p, '/runs/r1/spec.json')!)).toEqual(p.spec);
  });

  it('passes model, provider and sessions through in order', () => {
    const sessions = [{ prompt: 'remember: my name is Asha' }, { prompt: 'what is my name?' }];
    expect(plan({}, { sessions }).spec).toMatchObject({ model: 'claude-haiku-5.5', provider: 'anthropic', sessions });
  });
});

describe('single-variable guarantee', () => {
  it('baseline and +skill differ ONLY in the skill files (installed mode)', () => {
    const baseline = plan();
    const withSkill = plan({ skills: ['crm-lead-handling'] });
    expect(withSkill.spec).toEqual(baseline.spec); // same toolsets, limits, prompts
    expect(withSkill.files).toEqual(baseline.files); // same config.yaml, fixtures, spec
    expect(baseline.copies).toEqual([]);
    expect(withSkill.copies).toEqual([
      { from: '/repo/suites/skills/crm-lead-handling', to: '/runs/r1/home/skills/custom/crm-lead-handling' },
    ]);
  });

  it('always enables the skills toolset, even if the config omits it (both arms get it)', () => {
    expect(plan({ toolsets: ['file'] }).spec.enabledToolsets).toContain('skills');
  });
});

describe('noise control', () => {
  it('never enables delegation and always disables it (sub-agents bypass skip_background_review, #141318)', () => {
    const p = plan({ toolsets: ['file', 'delegation'] });
    expect(p.spec.enabledToolsets).not.toContain('delegation');
    expect(p.spec.disabledToolsets).toContain('delegation');
  });

  it('turns off skill-creation and memory nudges', () => {
    const cfg = hermesConfig(plan());
    expect(cfg.skills.creation_nudge_interval).toBe(0);
    expect(cfg.memory.nudge_interval).toBe(0);
  });

  it('caps iterations and time at the stricter of task and config', () => {
    const p = plan({ maxIterations: 30, runBudgetS: 300 }, { maxIterations: 12, timeoutS: 600 });
    expect(p.spec.maxIterations).toBe(12);
    expect(p.spec.runBudgetSeconds).toBe(300);
  });
});

describe('memory modes', () => {
  it('off: memory explicitly disabled (Hermes defaults it ON), toolset off, no MEMORY.md', () => {
    const p = plan({ memoryMode: 'off' });
    expect(p.spec.skipMemory).toBe(true);
    expect(p.spec.enabledToolsets).not.toContain('memory');
    expect(p.spec.disabledToolsets).toContain('memory');
    expect(hermesConfig(p).memory).toMatchObject({ memory_enabled: false, user_profile_enabled: false });
    expect(fileAt(p, '/runs/r1/home/memories/MEMORY.md')).toBeUndefined();
  });

  it('on: memory tool and store enabled, starts empty', () => {
    const p = plan({ memoryMode: 'on' });
    expect(p.spec.skipMemory).toBe(false);
    expect(p.spec.enabledToolsets).toContain('memory');
    expect(p.spec.disabledToolsets).not.toContain('memory');
    expect(hermesConfig(p).memory).toMatchObject({ memory_enabled: true, user_profile_enabled: true });
    expect(fileAt(p, '/runs/r1/home/memories/MEMORY.md')).toBeUndefined();
  });

  it('seeded: like on, plus MEMORY.md with the seed verbatim', () => {
    const seed = 'Client prefers WhatsApp follow-ups§Agency timezone is IST';
    const p = plan({ memoryMode: 'seeded', memorySeed: seed });
    expect(p.spec.skipMemory).toBe(false);
    expect(fileAt(p, '/runs/r1/home/memories/MEMORY.md')).toBe(seed);
  });

  it('seeded without a seed is a config error', () => {
    expect(() => plan({ memoryMode: 'seeded', memorySeed: null })).toThrow(/seed/i);
    expect(() => plan({ memoryMode: 'seeded', memorySeed: '  ' })).toThrow(/seed/i);
  });
});

describe('skills', () => {
  it('installed mode: copied, not auto-loaded (the agent must discover it)', () => {
    expect(hermesConfig(plan({ skills: ['crm-lead-handling'] })).skills.auto_load).toBeUndefined();
  });

  it('pinned mode: copied AND auto-loaded into the system prompt', () => {
    const p = plan({ skills: ['crm-lead-handling'], skillMode: 'pinned' });
    expect(hermesConfig(p).skills.auto_load).toEqual(['crm-lead-handling']);
    expect(p.copies).toHaveLength(1);
  });

  it('rejects a skill that does not exist (fail fast, not a silently skill-less arm)', () => {
    expect(() => plan({ skills: ['crm-lead-handlng'] })).toThrow(/crm-lead-handlng/);
  });
});

describe('fixtures', () => {
  it('writes fixtures into the workspace, including nested paths', () => {
    const p = plan({}, { fixtures: { 'leads.csv': 'a', 'data/old/contacts.csv': 'b' } });
    expect(fileAt(p, '/runs/r1/workspace/leads.csv')).toBe('a');
    expect(fileAt(p, '/runs/r1/workspace/data/old/contacts.csv')).toBe('b');
  });

  it('normalises harmless relative segments', () => {
    const p = plan({}, { fixtures: { 'a/../b.txt': 'x' } });
    expect(fileAt(p, '/runs/r1/workspace/b.txt')).toBe('x');
  });

  it.each(['../escape.txt', 'a/../../escape.txt', '/etc/passwd', ''])(
    'rejects a fixture path that is empty or escapes the workspace: %j',
    (bad) => {
      expect(() => plan({}, { fixtures: { [bad]: 'x' } })).toThrow(/fixture/i);
    },
  );
});

describe('sandbox', () => {
  // Without this the agent's file and terminal tools see the whole host: in the
  // pilot the baseline found suites/skills/.../SKILL.md in the repo and read it.
  it('docker: tools run in a throwaway container that sees only the workspace', () => {
    expect(hermesConfig(plan()).terminal).toEqual({
      backend: 'docker',
      docker_image: 'python:3.13-slim',
      // The workspace (and nothing else) is bind-mounted at /workspace.
      docker_mount_cwd_to_workspace: true,
      cwd: '/runs/r1/workspace',
      // A fresh container per run: no state shared between runs or arms.
      container_persistent: false,
      docker_persist_across_processes: false,
      // Tasks need no network; also stops fetching answers from elsewhere.
      docker_network: false,
    });
  });

  it('local: explicit opt-out runs tools on the host, in the workspace', () => {
    const p = planRun(baseConfig, baseTask, { ...paths, sandbox: { kind: 'local' } }, knownSkills);
    expect(hermesConfig(p).terminal).toEqual({ backend: 'local', cwd: '/runs/r1/workspace' });
  });
});
