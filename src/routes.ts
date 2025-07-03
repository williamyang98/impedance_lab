import type { FunctionalComponent } from 'vue';
import { type RouteComponent } from 'vue-router';
import { LayersIcon, CircuitBoardIcon, TimerIcon } from 'lucide-vue-next';

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
    name: "3D Stackup",
    icon_component: LayersIcon,
    route: {
      name: "3d_stackup",
      path: "/3d_stackup",
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
          name: "2d_stackup_editor",
          path: "/2d_stackup/editor",
          view_component: () => import("./views/stackup_2d/StackupCalculator.vue"),
        },
      },
      {
        type: "endpoint" as const,
        name: "Example Stackups",
        route: {
          name: "2d_stackup_templates",
          path: "/2d_stackup/templates",
          view_component: () => import("./views/stackup_2d/TemplatesView.vue"),
        },
      },
    ],
  },
  import.meta.env.DEV && {
    type: "group" as const,
    name: "Benchmarks",
    icon_component: TimerIcon,
    endpoints: [
      {
        type: "endpoint" as const,
        name: "GPU Benchmark",
        route: {
          name: "benchmark",
          path: "/benchmark",
          view_component: () => import("./views/gpu_benchmark/BenchmarkView.vue"),
        },
      }
    ],
  },
].filter(item => item !== false);

export const default_route_name = "2d_stackup_templates";

export const routes = navigation_tree
  .flatMap((item) => {
    switch (item.type) {
      case "endpoint": return [item];
      case "group": return item.endpoints;
    }
  })
  .map((endpoint) => endpoint.route);
