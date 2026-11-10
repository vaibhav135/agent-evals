<script setup lang="ts">
import { computed } from 'vue';
import type { ExperimentAnalysis } from '@agent-evals/shared';
import { verdictSummary } from '../format';
import CiBar from './CiBar.vue';

const props = defineProps<{ analysis: ExperimentAnalysis; running: boolean }>();
const v = computed(() => verdictSummary(props.analysis));
const tone = computed(
  () =>
    ({
      good: 'border-emerald-300 bg-emerald-50',
      bad: 'border-rose-300 bg-rose-50',
      neutral: 'border-stone-300 bg-white',
    })[v.value.tone],
);
</script>

<template>
  <section class="rounded-lg border p-4" :class="tone">
    <div class="flex flex-wrap items-baseline gap-x-3">
      <h2 class="text-xl font-semibold">{{ v.headline }}</h2>
      <span v-if="running" class="text-sm text-sky-700">(provisional: runs still in progress)</span>
    </div>
    <p class="mt-1 text-stone-700">{{ v.detail }}</p>
    <div v-if="analysis.ci && analysis.delta !== null" class="mt-4 max-w-xl">
      <CiBar :ci="analysis.ci" :delta="analysis.delta" />
    </div>
    <p class="mt-3 text-xs text-stone-500">
      Paired by task: for each task, B's pass rate over its trials minus A's. The interval is a percentile bootstrap
      over tasks ({{ analysis.resamples.toLocaleString() }} resamples, seed {{ analysis.seed }}), so it reflects which
      tasks happened to be in the suite, not just trial noise. "Better" or "worse" only when the interval excludes 0.
    </p>
  </section>
</template>
