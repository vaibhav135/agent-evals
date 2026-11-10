<script setup lang="ts">
import type { RunDetail } from '@agent-evals/shared';

defineProps<{ graders: RunDetail['graders']; descriptions: (string | undefined)[] }>();
</script>

<template>
  <ul class="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
    <li v-for="g in graders" :key="g.idx" class="flex gap-3 px-3 py-2">
      <span class="mt-0.5 font-mono text-sm" :class="g.passed ? 'text-emerald-700' : 'text-rose-700'">
        {{ g.passed ? '✓' : '✗' }}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="font-mono text-xs text-stone-500">{{ g.type }}</span>
          <span v-if="descriptions[g.idx]" class="text-stone-600">{{ descriptions[g.idx] }}</span>
          <span
            class="rounded px-1 text-[11px]"
            :class="g.required ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600'"
            :title="g.required ? 'Must pass for the run to pass' : 'Diagnostic only: does not affect pass/fail'"
          >{{ g.required ? 'required' : 'diagnostic' }}</span>
        </div>
        <p class="mt-0.5 font-mono text-xs break-words text-stone-800">{{ g.reason }}</p>
      </div>
    </li>
  </ul>
</template>
