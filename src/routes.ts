import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { Cuboid, Pencil } from 'lucide-vue-next';
import { App3DView } from './views/app_3d';
import Stackup2D from './views/stackup_2d/StackupRefactor.vue';

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
    view_component: App3DView,
    icon_component: Cuboid,
  },
  {
    name: "Stackup 2D",
    path: "/stackup_2d",
    view_component: Stackup2D,
    icon_component: Pencil,
  },
];
