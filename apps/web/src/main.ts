import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import { router } from './router';
import './style.css';

const queryClient = new QueryClient({
  // Finished experiments never change; running ones poll explicitly.
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
});

createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount('#app');
