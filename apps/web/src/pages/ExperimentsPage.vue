<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ExperimentSummary } from '@agent-evals/shared';
import { api } from '../api';
import { usd } from '../format';
import StatusBadge from '../components/StatusBadge.vue';

const router = useRouter();
const qc = useQueryClient();

const experiments = useQuery({
  queryKey: ['experiments'],
  queryFn: api.experiments,
  // Keep progress bars moving while anything is in flight.
  refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'running') ? 3000 : false),
});
const suites = useQuery({ queryKey: ['suites'], queryFn: api.suites });
const configs = useQuery({ queryKey: ['configs'], queryFn: api.configs });

const form = reactive({ name: '', suite: '', configA: '', configB: '', trialsPerTask: 5 });
// Sensible defaults once the catalog loads: the main experiment's arms.
watch([suites.data, configs.data], ([s, c]) => {
  if (s?.length && !form.suite) form.suite = s.find((x) => x.slug === 'crm-leads')?.slug ?? s[0]!.slug;
  if (c?.length && !form.configA) form.configA = c.find((x) => x.slug === 'haiku-baseline')?.slug ?? c[0]!.slug;
  if (c?.length && !form.configB) form.configB = c.find((x) => x.slug === 'haiku-crm-skill')?.slug ?? c[c.length - 1]!.slug;
});

const selectedSuite = computed(() => suites.data.value?.find((s) => s.slug === form.suite));
const totalRuns = computed(() => (selectedSuite.value?.taskCount ?? 0) * 2 * form.trialsPerTask);
const formError = ref<string | null>(null);

const launch = useMutation({
  mutationFn: async () => {
    const name = form.name.trim() || `${form.configA} vs ${form.configB} on ${form.suite}`;
    const created = await api.create({ ...form, name });
    return api.start(created.id);
  },
  onSuccess: (exp) => {
    qc.invalidateQueries({ queryKey: ['experiments'] });
    router.push({ name: 'results', params: { id: exp.id } });
  },
  onError: (e) => (formError.value = (e as Error).message),
});

function submit() {
  formError.value = null;
  if (form.configA === form.configB) {
    formError.value = 'Pick two different configs: comparing a config with itself only measures noise.';
    return;
  }
  launch.mutate();
}

const finished = (e: ExperimentSummary) => e.progress.total - e.progress.queued - e.progress.running;
const armSlug = (e: ExperimentSummary, label: 'A' | 'B') => e.arms.find((a) => a.label === label)?.config.slug ?? '?';
</script>

<template>
  <div class="grid gap-8 lg:grid-cols-[1fr_20rem]">
    <section>
      <h1 class="mb-3 text-lg font-semibold">Experiments</h1>
      <p v-if="experiments.isPending.value" class="text-stone-500">Loading…</p>
      <p v-else-if="experiments.error.value" class="text-rose-700">Could not load experiments: {{ experiments.error.value.message }}</p>
      <p v-else-if="!experiments.data.value?.length" class="text-stone-500">No experiments yet. Launch one on the right.</p>
      <ul v-else class="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        <li v-for="e in experiments.data.value" :key="e.id">
          <RouterLink :to="{ name: 'results', params: { id: e.id } }" class="block px-4 py-3 hover:bg-stone-50">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ e.name }}</span>
              <StatusBadge :status="e.status" />
            </div>
            <div class="mt-1 flex flex-wrap gap-x-4 text-xs text-stone-500">
              <span><b class="text-stone-700">A</b> {{ armSlug(e, 'A') }} · <b class="text-stone-700">B</b> {{ armSlug(e, 'B') }}</span>
              <span>suite {{ e.suite.slug }}</span>
              <span>{{ e.trialsPerTask }} trial(s)/task</span>
              <span>{{ finished(e) }}/{{ e.progress.total }} runs</span>
              <span>{{ usd(e.costUsd) }}</span>
              <span>{{ new Date(e.createdAt).toLocaleString() }}</span>
            </div>
            <div v-if="e.status === 'running'" class="mt-2 h-1 overflow-hidden rounded bg-stone-100">
              <div class="h-full bg-sky-500 transition-all" :style="{ width: `${(finished(e) / e.progress.total) * 100}%` }" />
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>

    <aside class="space-y-6">
      <form class="space-y-3 rounded-lg border border-stone-200 bg-white p-4" @submit.prevent="submit">
        <h2 class="font-semibold">New experiment</h2>
        <label class="block text-sm">
          <span class="text-stone-600">Suite</span>
          <select v-model="form.suite" class="mt-1 w-full rounded border border-stone-300 px-2 py-1">
            <option v-for="s in suites.data.value" :key="s.slug" :value="s.slug">{{ s.name }} ({{ s.taskCount }} tasks)</option>
          </select>
        </label>
        <label class="block text-sm">
          <span class="text-stone-600">Config A (baseline)</span>
          <select v-model="form.configA" class="mt-1 w-full rounded border border-stone-300 px-2 py-1">
            <option v-for="c in configs.data.value" :key="c.slug" :value="c.slug">{{ c.name }}</option>
          </select>
        </label>
        <label class="block text-sm">
          <span class="text-stone-600">Config B (candidate)</span>
          <select v-model="form.configB" class="mt-1 w-full rounded border border-stone-300 px-2 py-1">
            <option v-for="c in configs.data.value" :key="c.slug" :value="c.slug">{{ c.name }}</option>
          </select>
        </label>
        <label class="block text-sm">
          <span class="text-stone-600">Trials per task</span>
          <input v-model.number="form.trialsPerTask" type="number" min="1" max="20" class="mt-1 w-full rounded border border-stone-300 px-2 py-1" />
        </label>
        <label class="block text-sm">
          <span class="text-stone-600">Name (optional)</span>
          <input v-model="form.name" class="mt-1 w-full rounded border border-stone-300 px-2 py-1" placeholder="auto" />
        </label>
        <p class="text-xs text-stone-500">{{ totalRuns }} runs (tasks × 2 arms × trials). Each makes real model calls.</p>
        <p v-if="formError" class="text-sm text-rose-700">{{ formError }}</p>
        <button
          type="submit"
          :disabled="launch.isPending.value || !form.suite"
          class="w-full rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ launch.isPending.value ? 'Starting…' : 'Create and start' }}
        </button>
      </form>

      <section class="text-sm">
        <h2 class="mb-2 font-semibold">Configs</h2>
        <p class="mb-2 text-xs text-stone-500">Defined in <code>configs/*.yaml</code>, loaded at API start.</p>
        <ul class="space-y-2">
          <li v-for="c in configs.data.value" :key="c.slug" class="rounded border border-stone-200 bg-white px-3 py-2">
            <div class="font-medium">{{ c.name }}</div>
            <div class="text-xs text-stone-500">{{ c.description }}</div>
            <div class="mt-1 font-mono text-[11px] text-stone-600">
              {{ c.model }} · tools {{ c.toolsets.join('+') }} · skills {{ c.skills.join(', ') || 'none' }} ({{ c.skillMode }}) · memory {{ c.memoryMode }}
            </div>
          </li>
        </ul>
      </section>
    </aside>
  </div>
</template>
