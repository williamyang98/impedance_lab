import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { CuboidIcon, PencilIcon, Grid2x2Icon } from 'lucide-vue-next';

import { App3DView } from './views/app_3d';
import Stackup2DEditor from './views/stackup_2d/StackupRefactor.vue';
import Stackup2DTemplates from './views/stackup_2d/TemplatesView.vue';

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
    icon_component: CuboidIcon,
  },
  {
    name: "Stackup 2D",
    path: "/stackup_2d/editor",
    view_component: Stackup2DEditor,
    icon_component: PencilIcon,
  },
  {
    name: "Stackup 2D Templates",
    path: "/stackup_2d/templates",
    view_component: Stackup2DTemplates,
    icon_component: Grid2x2Icon,
  },
];
