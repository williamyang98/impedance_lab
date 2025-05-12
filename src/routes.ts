import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { Calculator, Cuboid, Grid2x2, Pencil } from 'lucide-vue-next';
import { App3DView } from './views/app_3d';
import { App2DView } from './views/app_2d';
import { default as GridView } from './views/GridView.vue';
import { Editor } from './views/editor_2d';

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
    name: "2D Calculator",
    path: "/2d_calculator",
    view_component: App2DView,
    icon_component: Calculator,
  },
  {
    name: "Mesher",
    path: "/mesher",
    view_component: GridView,
    icon_component: Grid2x2,
  },
  {
    name: "Editor 2d",
    path: "/editor_2d",
    view_component: Editor,
    icon_component: Pencil,
  },
];
