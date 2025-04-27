import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { Calculator, Cuboid, Grid2x2 } from 'lucide-vue-next';
import HomeView from './views/HomeView.vue';
import AboutView from './views/AboutView.vue';
import GridView from './views/GridView.vue';
import TestView from './views/TestView.vue';

export interface CustomRoute {
  name: string;
  path: string;
  view_component: RouteComponent | (() => Promise<RouteComponent>);
  icon_component?: FunctionalComponent;
};

export const routes: CustomRoute[] = [
  {
    name: "3D Simulator",
    path: "/3d_calculator",
    view_component: HomeView,
    icon_component: Cuboid,
  },
  {
    name: "2D Calculator",
    path: "/2d_calculator",
    view_component: AboutView,
    icon_component: Calculator,
  },
  {
    name: "Mesher",
    path: "/mesher",
    view_component: GridView,
    icon_component: Grid2x2,
  },
  {
    name: "Test",
    path: "/test",
    view_component: TestView,
    icon_component: Calculator,
  },
];
