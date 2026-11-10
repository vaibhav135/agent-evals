<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { TaskComparisonRow } from '@agent-evals/shared';
import { api, pollWhileActive } from '../api';
import { pct, pts, seconds, usd } from '../format';
import StatusBadge from '../components/StatusBadge.vue';
import VerdictCard from '../components/VerdictCard.vue';

const props = defineProps<{ id: string }>();
const qc = useQueryClient();

const experiment = useQuery({
  queryKey: ['experiment', () => props.id],
  queryFn: () => api.experiment(props.id),
  refetchInterval: (q) => pollWhileActive(q.state.data?.status),
});
const running = computed(() => experiment.data.value?.status === 'running');
const analysis = useQuery({
  queryKey: ['analysis', () => props.id],
  queryFn: () => api.analysis(props.id),
  refetchInterval: () => (running.value ? 3000 : false),
});

// Clicking a cell in the task table lists that task's runs for that arm.
const selected = ref<{ task: string; arm: 'A' | 'B' } | null>(null);
const runs = useQuery({
  queryKey: ['runs', () => props.id, () => selected.value?.task, () => selected.value?.arm],
  queryFn: () => api.runs(props.id, selected.value!),
  enabled: () => selected.value !== null,
  refetchInterval: () => (running.value ? 3000 : false),
});

const action = useMutation({
  mutationFn: (kind: 'start' | 'cancel') => (kind === 'start' ? api.start(props.id) : api.cancel(props.id)),
  onSuccess: () => qc.invalidateQueries(),
});

const arm = (label: 'A' | 'B') => experiment.data.value?.arms.find((a) => a.label === label)?.config;
const armStats = (label: 'A' | 'B') => analysis.data.value?.arms.find((a) => a.label === label);

// Group rows by category so "skill" and "control" read separately: the
// controls answer "did B cost anything elsewhere?".
const groups = computed(() => {
  const rows = analysis.data.value?.perTask ?? [];
  const by = new Map<string, TaskComparisonRow[]>();
  for (const r of rows) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return [...by.entries()].map(([category, rows]) => {
    const mean = (f: (r: TaskComparisonRow) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    return { category, rows, a: mean((r) => r.a.rate), b: mean((r) => r.b.rate), delta: mean((r) => r.delta) };
  });
});

const progress = computed(() => {
  const p = experiment.data.value?.progress;
  if (!p) return null;
  const done = p.total - p.queued - p.running;
  return { done, total: p.total, pctDone: p.total ? (done / p.total) * 100 : 0 };
});

const deltaClass = (d: number) => (d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-stone-500');
const isSelected = (task: string, a: 'A' | 'B') => selected.value?.task === task && selected.value?.arm === a;
const select = (task: string, a: 'A' | 'B') => (selected.value = isSelected(task, a) ? null : { task, arm: a });
</script>

<template>
  <div v-if="experiment.isPending.value" class="text-stone-500">Loading…</div>
  <div v-else-if="experiment.error.value" class="text-rose-700">{{ experiment.error.value.message }}</div>
  <div v-else-if="experiment.data.value" class="space-y-6">
    <!-- Header -->
    <section>
      <RouterLink to="/" class="text-sm text-stone-500 hover:underline">← Experiments</RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-3">
        <h1 class="text-lg font-semibold">{{ experiment.data.value.name }}</h1>
        <StatusBadge :status="experiment.data.value.status" />
        <button
          v-if="experiment.data.value.status === 'pending'"
          class="rounded bg-stone-900 px-2 py-1 text-xs text-white"
          @click="action.mutate('start')"
        >Start</button>
        <button
          v-if="running"
          class="rounded border border-stone-300 px-2 py-1 text-xs"
          @click="action.mutate('cancel')"
        >Cancel</button>
      </div>
      <p class="mt-1 text-xs text-stone-500">
        Suite <b>{{ experiment.data.value.suite.slug }}</b> · {{ experiment.data.value.trialsPerTask }} trial(s) per task ·
        Hermes @ {{ experiment.data.value.hermesCommit.slice(0, 7) }} · total cost {{ usd(experiment.data.value.costUsd) }}
      </p>
      <div v-if="progress && running" class="mt-2 max-w-xl">
        <div class="h-1.5 overflow-hidden rounded bg-stone-100">
          <div class="h-full bg-sky-500 transition-all" :style="{ width: `${progress.pctDone}%` }" />
        </div>
        <p class="mt-1 text-xs text-stone-500">{{ progress.done }} / {{ progress.total }} runs finished</p>
      </div>
    </section>

    <template v-if="analysis.data.value">
      <VerdictCard :analysis="analysis.data.value" :running="running" />

      <!-- Arms -->
      <section class="overflow-x-auto">
        <table class="w-full min-w-[40rem] rounded-lg border border-stone-200 bg-white text-sm">
          <thead class="bg-stone-50 text-left text-xs text-stone-500">
            <tr>
              <th class="px-3 py-2">Arm</th><th class="px-3 py-2">Config</th><th class="px-3 py-2 text-right">Pass rate</th>
              <th class="px-3 py-2 text-right">Runs</th><th class="px-3 py-2 text-right">Cost</th>
              <th class="px-3 py-2 text-right">$/run</th><th class="px-3 py-2 text-right">Mean time</th><th class="px-3 py-2 text-right">Mean tokens</th>
            </tr>
          </thead>
          <tbody class="tabular-nums">
            <tr v-for="label in ['A', 'B'] as const" :key="label" class="border-t border-stone-100">
              <td class="px-3 py-2 font-semibold">{{ label }}</td>
              <td class="px-3 py-2">
                <div>{{ arm(label)?.name }}</div>
                <div class="font-mono text-[11px] text-stone-500">
                  {{ arm(label)?.model }} · skills {{ arm(label)?.skills.join(', ') || 'none' }} · memory {{ arm(label)?.memoryMode }}
                </div>
              </td>
              <td class="px-3 py-2 text-right font-medium">{{ pct(armStats(label)?.passRate) }}</td>
              <td class="px-3 py-2 text-right">{{ armStats(label)?.trials }}</td>
              <td class="px-3 py-2 text-right">{{ usd(armStats(label)?.costUsd) }}</td>
              <td class="px-3 py-2 text-right">{{ usd(armStats(label)?.meanCostPerRunUsd) }}</td>
              <td class="px-3 py-2 text-right">{{ seconds(armStats(label)?.meanDurationMs) }}</td>
              <td class="px-3 py-2 text-right">{{ armStats(label)?.meanTokens?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="mt-1 text-xs text-stone-500">
          Excluded from the statistics: {{ analysis.data.value.excluded.infraError }} infra error(s) (platform failures, not the
          agent's), {{ analysis.data.value.excluded.pending }} unfinished. Timeouts and agent errors count as failures.
          <span v-if="analysis.data.value.unpairedTaskSlugs.length">Unpaired tasks (left out): {{ analysis.data.value.unpairedTaskSlugs.join(', ') }}.</span>
        </p>
      </section>

      <!-- Per task -->
      <section class="overflow-x-auto">
        <h2 class="mb-2 font-semibold">Per task <span class="text-xs font-normal text-stone-500">click a cell to see its runs</span></h2>
        <table class="w-full min-w-[36rem] rounded-lg border border-stone-200 bg-white text-sm">
          <thead class="bg-stone-50 text-left text-xs text-stone-500">
            <tr><th class="px-3 py-2">Task</th><th class="px-3 py-2 text-right">A</th><th class="px-3 py-2 text-right">B</th><th class="px-3 py-2 text-right">Δ pts</th></tr>
          </thead>
          <tbody v-for="g in groups" :key="g.category" class="tabular-nums">
            <tr class="border-t border-stone-200 bg-stone-50 text-xs">
              <td class="px-3 py-1.5 font-semibold tracking-wide uppercase">{{ g.category }} · {{ g.rows.length }} tasks</td>
              <td class="px-3 py-1.5 text-right">{{ pct(g.a) }}</td>
              <td class="px-3 py-1.5 text-right">{{ pct(g.b) }}</td>
              <td class="px-3 py-1.5 text-right font-semibold" :class="deltaClass(g.delta)">{{ pts(g.delta) }}</td>
            </tr>
            <tr v-for="r in g.rows" :key="r.taskId" class="border-t border-stone-100">
              <td class="px-3 py-1.5">
                <div>{{ r.name }}</div>
                <div class="font-mono text-[11px] text-stone-500">{{ r.slug }}</div>
              </td>
              <td
                v-for="a in ['A', 'B'] as const"
                :key="a"
                class="cursor-pointer px-3 py-1.5 text-right hover:bg-stone-100"
                :class="isSelected(r.slug, a) && 'bg-sky-100'"
                @click="select(r.slug, a)"
              >{{ r[a === 'A' ? 'a' : 'b'].passes }}/{{ r[a === 'A' ? 'a' : 'b'].trials }}</td>
              <td class="px-3 py-1.5 text-right font-medium" :class="deltaClass(r.delta)">{{ pts(r.delta) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Runs of the selected cell -->
      <section v-if="selected" class="rounded-lg border border-sky-200 bg-white p-3">
        <h3 class="mb-2 text-sm font-semibold">Runs: {{ selected.task }} · arm {{ selected.arm }}</h3>
        <p v-if="runs.isPending.value" class="text-sm text-stone-500">Loading…</p>
        <ul v-else class="divide-y divide-stone-100 text-sm">
          <li v-for="r in runs.data.value" :key="r.id">
            <RouterLink :to="{ name: 'run', params: { id: r.id } }" class="flex flex-wrap items-center gap-3 px-1 py-1.5 hover:bg-stone-50">
              <span class="w-14 text-stone-500">trial {{ r.trialIndex + 1 }}</span>
              <StatusBadge :status="r.status" />
              <span class="text-xs text-stone-500 tabular-nums">score {{ r.score?.toFixed(2) ?? '—' }} · {{ seconds(r.durationMs) }} · {{ usd(r.costUsd) }}</span>
              <span v-if="r.attempt > 1" class="text-xs text-amber-700">attempt {{ r.attempt }}</span>
              <span v-if="r.errorKind" class="font-mono text-xs text-rose-700">{{ r.errorKind }}</span>
              <span class="ml-auto text-xs text-sky-700">inspect →</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
