import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { CuboidIcon, PencilIcon, Grid2x2Icon } from 'lucide-vue-next';

export interface CustomRoute {
  name: string;
  path: string;
  view_component: RouteComponent | (() => Promise<RouteComponent>);
  icon_component?: FunctionalComponent;
};

export const routes: CustomRoute[] = [
  import.meta.env.DEV && {
    name: "3D Simulator",
    path: "/3d_calculator",
    view_component: () => import("./views/app_3d/App3DView.vue"),
    icon_component: CuboidIcon,
  },
  {
    name: "Stackup 2D",
    path: "/stackup_2d/editor",
    view_component: () => import("./views/stackup_2d/StackupCalculator.vue"),
    icon_component: PencilIcon,
  },
  {
    name: "Stackup 2D Templates",
    path: "/stackup_2d/templates",
    view_component: () => import("./views/stackup_2d/TemplatesView.vue"),
    icon_component: Grid2x2Icon,
  },
].filter(route => route !== false);
