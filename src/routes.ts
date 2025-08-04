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
    type: "group" as const,
    name: "3D Solvers",
    icon_component: LayersIcon,
    endpoints: [
      {
        type: "endpoint" as const,
        name: "3D FDTD",
        route: {
          name: "3d_fdtd",
          path: "/3d/fdtd",
          view_component: () => import("./views/app_3d/App3DView.vue"),
        },
      },
      {
        type: "endpoint" as const,
        name: "3D Via",
        route: {
          name: "",
          path: "/3d/via",
          view_component: () => import("./views/via_3d/Via3DView.vue"),
        },
      },
    ],
  },
  {
    type: "group" as const,
    name: "2D Electrostatic Solvers",
    icon_component: CircuitBoardIcon,
    endpoints: [
      {
        type: "endpoint" as const,
        name: "Transmission Line Impedance Calculator",
        route: {
          name: "2d_transmission_line_calculator",
          path: "/2d/transmission_line_calculator",
          view_component: () => import("./views/stackup_2d/StackupCalculator.vue"),
        },
      },
      {
        type: "endpoint" as const,
        name: "Transmission Line Templates",
        route: {
          name: "2d_transmission_line_templates",
          path: "/2d/transmission_line_templates",
          view_component: () => import("./views/stackup_2d/TemplatesView.vue"),
        },
      },
      {
        type: "endpoint" as const,
        name: "Single Ended Via Impedance Calculator",
        route: {
          name: "2d_via",
          path: "/2d/via",
          view_component: () => import("./views/via_2d/Via2DView.vue"),
        },
      },
    ],
  },
  {
    type: "group" as const,
    name: "Benchmarks",
    icon_component: TimerIcon,
    endpoints: [
      {
        type: "endpoint" as const,
        name: "GPU Benchmark",
        route: {
          name: "gpu_benchmark",
          path: "/benchmark/gpu",
          view_component: () => import("./views/gpu_benchmark/BenchmarkView.vue"),
        },
      }
    ],
  },
].filter(item => item !== false);

export const default_route_name = "2d_transmission_line_templates";

export const routes = navigation_tree
  .flatMap((item) => {
    switch (item.type) {
      case "endpoint": return [item];
      case "group": return item.endpoints;
    }
  })
  .map((endpoint) => endpoint.route);

export const endpoints_table = new Map<string, NavigationEndpoint>();
for (const item of navigation_tree) {
  switch (item.type) {
    case "endpoint": {
      endpoints_table.set(item.route.name, item);
      break;
    }
    case "group": {
      for (const endpoint of item.endpoints) {
        endpoints_table.set(endpoint.route.name, endpoint);
      }
      break;
    }
  }
}
