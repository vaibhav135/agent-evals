<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { HealthResponse } from '@agent-evals/shared';

const health = ref<HealthResponse | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Validate at runtime with the same schema the API is typed against:
    // if the contract drifts, we fail loudly here instead of rendering junk.
    health.value = HealthResponse.parse(await res.json());
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <main>
    <h1>Agent Evals</h1>
    <p v-if="health">API: {{ health.status }} ({{ health.version }})</p>
    <p v-else-if="error">API unreachable: {{ error }}</p>
    <p v-else>Checking API…</p>
  </main>
</template>
