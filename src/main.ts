import './main.css'

import { createRouter, createWebHashHistory } from 'vue-router'
import { createApp } from 'vue'
import { routes } from './routes.ts';
import App from './App.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: routes.map((route) => {
    return {
      path: route.path,
      name: route.name,
      component: route.view_component,
    }
  }),
})

const app = createApp(App)
app.use(router)
app.mount('#app')
