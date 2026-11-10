<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

// Colour by meaning, not by name: green = evidence of success, red = evidence
// of failure, amber = excluded from the statistics, grey = not finished.
const tone = computed(() => {
  switch (props.status) {
    case 'passed':
    case 'completed':
      return 'bg-emerald-100 text-emerald-800';
    case 'failed':
    case 'agent_error':
    case 'timeout':
      return 'bg-rose-100 text-rose-800';
    case 'infra_error':
    case 'cancelled':
      return 'bg-amber-100 text-amber-800';
    case 'running':
      return 'bg-sky-100 text-sky-800';
    default:
      return 'bg-stone-100 text-stone-700';
  }
});
</script>

<template>
  <span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap" :class="tone">
    {{ status.replace('_', ' ') }}
  </span>
</template>
