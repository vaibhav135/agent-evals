import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'experiments', component: () => import('./pages/ExperimentsPage.vue') },
    { path: '/experiments/:id', name: 'results', component: () => import('./pages/ResultsPage.vue'), props: true },
    { path: '/runs/:id', name: 'run', component: () => import('./pages/RunPage.vue'), props: true },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
