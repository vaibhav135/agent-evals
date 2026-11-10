<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';
import { seconds, usd } from '../format';
import GraderList from '../components/GraderList.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Transcript from '../components/Transcript.vue';

const props = defineProps<{ id: string }>();
const run = useQuery({
  queryKey: ['run', () => props.id],
  queryFn: () => api.run(props.id),
  refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.status ?? '') ? 3000 : false),
});

/** One sentence answering "why did this run pass or fail?". */
const why = computed(() => {
  const r = run.data.value;
  if (!r) return '';
  const required = r.graders.filter((g) => g.required);
  const failed = required.filter((g) => !g.passed);
  switch (r.status) {
    case 'passed':
      return `Passed: all ${required.length} required grader(s) passed.`;
    case 'failed':
      return `Failed: ${failed.length} of ${required.length} required grader(s) failed. First: ${failed[0]?.reason ?? '—'}`;
    case 'timeout':
      return 'Timed out: the run exceeded its time budget and was stopped. Counted as a failure.';
    case 'agent_error':
      return `Agent error (${r.errorKind}): counted as a failure. ${r.errorMessage ?? ''}`;
    case 'infra_error':
      return `Infrastructure error (${r.errorKind}) after ${r.attempt} attempt(s): excluded from the statistics. ${r.errorMessage ?? ''}`;
    default:
      return `Not finished yet (${r.status}).`;
  }
});

const descriptions = computed(() => run.data.value?.task.graders.map((g) => g.description) ?? []);
const totalTokens = computed(() => {
  const t = run.data.value?.tokens;
  return t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0;
});
</script>

<template>
  <div v-if="run.isPending.value" class="text-stone-500">Loading…</div>
  <div v-else-if="run.error.value" class="text-rose-700">{{ run.error.value.message }}</div>
  <div v-else-if="run.data.value" class="space-y-6">
    <section>
      <RouterLink :to="{ name: 'results', params: { id: run.data.value.experimentId } }" class="text-sm text-stone-500 hover:underline">
        ← Experiment results
      </RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-3">
        <h1 class="text-lg font-semibold">{{ run.data.value.task.name }}</h1>
        <StatusBadge :status="run.data.value.status" />
        <span class="text-sm text-stone-500">arm {{ run.data.value.arm }} · {{ run.data.value.config.name }} · trial {{ run.data.value.trialIndex + 1 }}</span>
      </div>
      <p class="mt-2 rounded border border-stone-200 bg-white px-3 py-2 text-sm">{{ why }}</p>
      <p class="mt-2 text-xs text-stone-500 tabular-nums">
        {{ seconds(run.data.value.durationMs) }} · {{ usd(run.data.value.costUsd) }} · {{ totalTokens.toLocaleString() }} tokens
        ({{ run.data.value.tokens.input.toLocaleString() }} in, {{ run.data.value.tokens.output.toLocaleString() }} out,
        {{ run.data.value.tokens.cacheRead.toLocaleString() }} cache read, {{ run.data.value.tokens.cacheWrite.toLocaleString() }} cache write)
        · {{ run.data.value.turns ?? '—' }} turns · {{ run.data.value.toolCalls ?? '—' }} tool calls · score {{ run.data.value.score?.toFixed(2) ?? '—' }}
        <span v-if="run.data.value.attempt > 1"> · attempt {{ run.data.value.attempt }}</span>
      </p>
    </section>

    <section>
      <h2 class="mb-2 font-semibold">Graders</h2>
      <p v-if="!run.data.value.graders.length" class="text-sm text-stone-500">Not graded (the run did not produce a result).</p>
      <GraderList v-else :graders="run.data.value.graders" :descriptions="descriptions" />
    </section>

    <section v-for="s in run.data.value.sessions" :key="s.idx" class="space-y-2">
      <h2 class="font-semibold">
        Session {{ s.idx + 1 }}<span v-if="run.data.value.sessions.length > 1"> of {{ run.data.value.sessions.length }}</span>
        <span class="text-xs font-normal text-stone-500"> · {{ seconds(s.durationMs) }} · tools available: {{ s.availableTools.join(', ') || '—' }}</span>
      </h2>
      <div class="rounded border border-stone-200 bg-white px-3 py-2 text-sm">
        <div class="text-[11px] font-medium tracking-wide text-stone-500 uppercase">Final response</div>
        <p class="mt-1 whitespace-pre-wrap">{{ s.finalResponse ?? '(none)' }}</p>
      </div>
      <details v-if="s.memorySnapshot && run.data.value.config.memoryMode !== 'off'" class="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm" open>
        <summary class="cursor-pointer font-medium">Memory after this session</summary>
        <div v-for="(content, file) in s.memorySnapshot" :key="file" class="mt-2">
          <div class="font-mono text-xs text-stone-500">{{ file }}</div>
          <pre class="text-xs whitespace-pre-wrap">{{ content || '(empty)' }}</pre>
        </div>
      </details>
      <details class="rounded border border-stone-200 bg-stone-50 px-3 py-2">
        <summary class="cursor-pointer text-sm font-medium">Transcript ({{ s.messages.length }} messages)</summary>
        <div class="mt-3"><Transcript :messages="s.messages" /></div>
      </details>
    </section>

    <section class="grid gap-3 md:grid-cols-2">
      <details class="rounded border border-stone-200 bg-white px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium">Config snapshot (as run)</summary>
        <pre class="mt-2 overflow-auto text-xs">{{ JSON.stringify(run.data.value.config, null, 2) }}</pre>
      </details>
      <details class="rounded border border-stone-200 bg-white px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium">Task snapshot (as graded)</summary>
        <pre class="mt-2 max-h-96 overflow-auto text-xs">{{ JSON.stringify(run.data.value.task, null, 2) }}</pre>
      </details>
    </section>
  </div>
</template>
