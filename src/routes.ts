import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { LayersIcon, CircuitBoardIcon } from 'lucide-vue-next';

export interface CustomRoute {
  name: string;
  path: string;
  view_component: RouteComponent | (() => Promise<RouteComponent>);
}

export interface NavigationEndpoint {
  readonly type: "endpoint";
  name: string;
  icon_component?: FunctionalComponent;
  route: CustomRoute;
}

export interface NavigationGroup {
  readonly type: "group";
  name: string;
  icon_component?: FunctionalComponent;
  endpoints: NavigationEndpoint[];
}

export type NavigationItem = NavigationEndpoint | NavigationGroup;

export const navigation_tree: NavigationItem[] = [
  import.meta.env.DEV && {
    type: "endpoint" as const,
    name: "3D Simulator",
    icon_component: LayersIcon,
    route: {
      name: "3d_calculator",
      path: "/3d_calculator",
      view_component: () => import("./views/app_3d/App3DView.vue"),
    },
  },
  {
    type: "group" as const,
    name: "2D Stackup",
    icon_component: CircuitBoardIcon,
    endpoints: [
      {
        type: "endpoint" as const,
        name: "Impedance Calculator",
        route: {
          name: "stackup_2d_editor",
          path: "/stackup_2d/editor",
          view_component: () => import("./views/stackup_2d/StackupCalculator.vue"),
        },
      },
      {
        type: "endpoint" as const,
        name: "Example Stackups",
        route: {
          name: "stackup_2d_templates",
          path: "/stackup_2d/templates",
          view_component: () => import("./views/stackup_2d/TemplatesView.vue"),
        },
      },
    ],
  },
].filter(item => item !== false);

export const default_route_name = "stackup_2d_templates";

export const routes = navigation_tree
  .flatMap((item) => {
    switch (item.type) {
      case "endpoint": return [item];
      case "group": return item.endpoints;
    }
  })
  .map((endpoint) => endpoint.route);
