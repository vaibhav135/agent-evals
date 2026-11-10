<script setup lang="ts">
/**
 * One session's messages as Hermes recorded them (OpenAI-style: role,
 * content, tool_calls, and `tool` messages carrying results). Typed loosely
 * on purpose: this is Hermes's format, stored verbatim, not our contract.
 */
interface ToolCall { id?: string; function?: { name?: string; arguments?: string } }
interface Message { role?: string; content?: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }

defineProps<{ messages: unknown[] }>();

const text = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'object' && p && 'text' in p ? String(p.text) : '')).join('');
  return c === null || c === undefined ? '' : JSON.stringify(c, null, 2);
};
const pretty = (args?: string) => {
  try {
    return JSON.stringify(JSON.parse(args ?? ''), null, 2);
  } catch {
    return args ?? '';
  }
};
const asMessage = (m: unknown) => m as Message;
</script>

<template>
  <ol class="space-y-2">
    <li v-for="(raw, i) in messages" :key="i">
      <template v-for="m in [asMessage(raw)]" :key="i">
        <div v-if="m.role === 'system'">
          <details class="rounded border border-stone-200 bg-stone-100 px-3 py-1.5 text-xs">
            <summary class="cursor-pointer text-stone-600">system prompt ({{ text(m.content).length.toLocaleString() }} chars)</summary>
            <pre class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap">{{ text(m.content) }}</pre>
          </details>
        </div>
        <div v-else-if="m.role === 'tool'">
          <details class="ml-6 rounded border border-stone-200 bg-white px-3 py-1.5 text-xs">
            <summary class="cursor-pointer text-stone-600">tool result · {{ text(m.content).slice(0, 120) }}</summary>
            <pre class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap">{{ text(m.content) }}</pre>
          </details>
        </div>
        <div v-else class="rounded border px-3 py-2" :class="m.role === 'user' ? 'border-sky-200 bg-sky-50' : 'border-stone-200 bg-white'">
          <div class="text-[11px] font-medium tracking-wide text-stone-500 uppercase">{{ m.role }}</div>
          <p v-if="text(m.content)" class="mt-1 text-sm whitespace-pre-wrap">{{ text(m.content) }}</p>
          <div v-for="(tc, j) in m.tool_calls ?? []" :key="j" class="mt-2 rounded bg-stone-900 px-2 py-1.5 text-xs text-stone-100">
            <span class="font-mono text-amber-300">{{ tc.function?.name }}</span>
            <pre class="mt-1 max-h-60 overflow-auto font-mono whitespace-pre-wrap">{{ pretty(tc.function?.arguments) }}</pre>
          </div>
        </div>
      </template>
    </li>
  </ol>
</template>
