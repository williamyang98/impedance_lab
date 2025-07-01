import './main.css'

import { createRouter, createWebHashHistory } from 'vue-router'
import { createApp } from 'vue'
import { routes, default_route_name } from './routes.ts';
import App from './App.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    ...routes.map((route) => {
      return {
        path: route.path,
        name: route.name,
        component: route.view_component,
      }
    }),
    { path: "/:pathMatch(.*)*", redirect: { name: default_route_name } },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
