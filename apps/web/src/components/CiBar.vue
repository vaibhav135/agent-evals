<script setup lang="ts">
import { computed } from 'vue';
import { ciBar, pts } from '../format';

const props = defineProps<{ ci: { low: number; high: number; level: number }; delta: number }>();
const bar = computed(() => ciBar(props.ci, props.delta));
</script>

<template>
  <!-- The interval on a −100…+100 pts axis: if the band crosses the zero line, the result is inconclusive. -->
  <div>
    <div class="relative h-6 rounded bg-stone-100">
      <div class="absolute inset-y-0 w-px bg-stone-400" :style="{ left: `${bar.zero}%` }" />
      <div class="absolute inset-y-1.5 rounded bg-stone-800/25" :style="{ left: `${bar.left}%`, width: `${Math.max(bar.width, 1)}%` }" />
      <div class="absolute inset-y-0.5 w-1 -translate-x-1/2 rounded bg-stone-900" :style="{ left: `${bar.point}%` }" />
    </div>
    <div class="mt-1 flex justify-between text-xs text-stone-500 tabular-nums">
      <span>−100 pts (B worse)</span>
      <span>0</span>
      <span>+100 pts (B better)</span>
    </div>
    <p class="mt-1 text-xs text-stone-500">
      Point estimate {{ pts(delta) }} pts; {{ Math.round(ci.level * 100) }}% CI {{ pts(ci.low) }} to {{ pts(ci.high) }}.
    </p>
  </div>
</template>
