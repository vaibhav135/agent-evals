<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="border-b border-stone-200 bg-white">
    <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
      <RouterLink to="/" class="font-semibold tracking-tight">Agent Evals</RouterLink>
      <span class="text-sm text-stone-500">Is config B better than config A, and how sure are we?</span>
    </div>
  </header>
  <main class="mx-auto max-w-6xl px-4 py-6">
    <RouterView />
  </main>
</template>
