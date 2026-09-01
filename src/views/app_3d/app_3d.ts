import { SimulationSetup } from "../../app/fdtd_3d/grid.ts";
import { type GridBuilderConfig } from "../../app/electrostatic_3d/grid_builder.ts";
import { type Region, GridBuilder } from "../../app/fdtd_3d/grid_builder.ts";
import { Profiler } from "../../utility/profiler.ts";
import type { Vec3 } from "../../utility/dim_types.ts";

type Size3D = Vec3<number>;

function estimate_single_ended_impedance_ipc2141(er: number, h: number, w: number, t: number): number {
  // https://www.digikey.com.au/en/resources/conversion-calculators/conversion-calculator-pcb-trace-impedance
  // er = relative dielectric constant
  // h = height between trace and plane
  // w = trace width
  // t = trace height
  return 87/Math.sqrt(er+1.41)*Math.log(5.98*h/(0.8*w+t));
}

function estimate_differential_impedance_ipc2141(er: number, h: number, w: number, t: number, s: number): number {
  // https://www.digikey.com.au/en/resources/conversion-calculators/conversion-calculator-pcb-trace-impedance
  // er = relative dielectric constant
  // h = height between trace and plane
  // w = trace width
  // t = trace height
  // s = trace spacing
  return 174/Math.sqrt(er+1.41)*Math.log(5.98*h/(0.8*w+t))*(1-0.48*Math.exp(-0.96*s/h));
}

function create_sinc_pulse(period: number): number[] {
  const values = [];
  for (let i = 0; i < period; i++) {
    const dt = Math.PI*i/period;
    const amplitude = Math.sin(dt)**2;
    values.push(amplitude);
  }
  return values;
}

export function create_single_ended_setup_vargrid(
  gpu_adapter: GPUAdapter, gpu_device: GPUDevice,
  profiler?: Profiler
): GridBuilder {
  const plane_thickness = 0.035e-3;
  const dielectric_height = 0.25e-3;
  const trace_width = 0.3e-3;
  const trace_length = 5e-3;
  const trace_thickness = 0.035e-3;
  const dielectric_constant = 4.1;
  const terminator_thickness = 0.05e-3;
  const Z0_estimate = estimate_single_ended_impedance_ipc2141(dielectric_constant, dielectric_height, trace_width, trace_thickness);

  // TODO: actually set the conductivity scalar field correctly for non-uniform grid
  const terminator_conductivity = dielectric_height/(Z0_estimate*(terminator_thickness*trace_width));
  const copper_conductivity = 1e8;

  const grid_builder_config: GridBuilderConfig = {
    minimum_grid_resolution: 0.001e-3,
    padding_size_multiplier: {
      x: 1,
      y: 5,
      z: 3,
    },
    max_ratio: {
      x: 0.15,
      y: 0.15,
      z: 0.15,
    },
    min_subdivisions: {
      x: 3,
      y: 15,
      z: 3,
    },
  };

  const grid_builder_padding = {
    x: { min: true, max: true },
    y: { min: true, max: true },
    z: { min: false, max: true },
  };

  const regions: Region[] = [
    // copper plane
    {
      type: "conductive",
      conductivity: copper_conductivity,
      shapes: [
        {
          type: "cuboid",
          start: { z: -plane_thickness },
          end: { z: 0 },
          config: {
            min_gridlines: { z: 1 },
          },
        },
      ],
    },
    // signal trace
    {
      type: "conductive",
      conductivity: copper_conductivity,
      shapes: [
        {
          type: "cuboid",
          start: { x: -trace_length/2, y: -trace_width/2, z: dielectric_height },
          end: { x: trace_length/2, y: trace_width/2, z: dielectric_height+trace_thickness },
          config: {},
        },
      ],
    },
    // dielectric
    {
      type: "dielectric",
      permittivity: dielectric_constant,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0 },
          end: { z: dielectric_height },
          config: {},
        },
      ],
    },
    // terminator left
    {
      type: "conductive",
      conductivity: terminator_conductivity,
      shapes: [
        {
          type: "cuboid",
          start: { x: -trace_length/2, y: -trace_width/2, z: 0 },
          end: { x: -trace_length/2+terminator_thickness, y: trace_width/2, z: dielectric_height },
          config: {},
        },
      ],
    },
    // terminator right
    {
      type: "conductive",
      conductivity: terminator_conductivity,
      shapes: [
        {
          type: "cuboid",
          start: { x: trace_length/2-terminator_thickness, y: -trace_width/2, z: 0 },
          end: { x: trace_length/2, y: trace_width/2, z: dielectric_height },
          config: {},
        },
      ],
    },
    // current source
    {
      type: "current",
      current_id: 0,
      shape: {
        type: "cuboid",
        start: { x: -terminator_thickness/2, y: -trace_width/2, z: 0 },
        end: { x: terminator_thickness/2, y: trace_width/2, z: dielectric_height },
        config: {},
      },
    },
  ];

  const grid_builder = new GridBuilder(regions, grid_builder_config, grid_builder_padding, gpu_adapter, gpu_device, profiler)
  const setup = grid_builder.setup;

  const signals = {
    0: create_sinc_pulse(256),
  };
  setup.source_values = signals;
  setup.maximum_steps = 8192;
  setup.cpu.calculate_minimum_timestep();
  setup.cpu.bake_materials();

  return grid_builder;
}

export function create_single_ended_setup(adapter: GPUAdapter, device: GPUDevice): SimulationSetup {
  const size: Size3D = { x: 256, y: 128, z: 16 };
  const setup = new SimulationSetup(adapter, device, size);
  const cpu = setup.cpu;

  const { x: Nx, y: Ny, z: Nz } = size;
  cpu.epsilon_r.fill(1.0);
  cpu.mu_r.fill(1.0);
  cpu.sigma_k.fill(0.0);

  const dxyz = 1e-3;
  cpu.d.x.fill(dxyz);
  cpu.d.y.fill(dxyz);
  cpu.d.z.fill(dxyz);

  const plane_height = 1;
  const plane_border = 20;
  const signal_height = 1;
  const signal_width = 20;
  const separation_height = 10;
  const dielectric_constant = 4.1;
  const terminator_thickness = 2;

  const z_start = Math.floor(Nz/2 - (plane_height+separation_height+signal_height)/2);
  // ground plane
  cpu.sigma_k
    .lo([z_start, plane_border, plane_border])
    .hi([plane_height, Ny-plane_border*2, Nx-plane_border*2])
    .fill(1e8);
  // dielectric
  cpu.epsilon_r
    .lo([z_start+plane_height, plane_border, plane_border])
    .hi([separation_height, Ny-plane_border*2, Nx-plane_border*2])
    .fill(dielectric_constant);
  // single ended transmission line
  cpu.sigma_k
    .lo([z_start+plane_height+separation_height, Math.floor(Ny/2-signal_width/2), plane_border])
    .hi([signal_height, signal_width, Nx-plane_border*2])
    .fill(1e8);

  // source
  setup.source_values = {
    0: create_sinc_pulse(256),
  };
  setup.sources.push({
    current_id: 0,
    offset: { z: z_start+plane_height, y: Math.floor(Ny/2-signal_width/2), x: Math.floor(Nx/2) },
    size: { z: separation_height, y: signal_width, x: 1 },
  });

  // terminator resistors
  {
    const resistance = estimate_single_ended_impedance_ipc2141(dielectric_constant, separation_height, signal_width, signal_height);
    const area = (signal_width*dxyz)*(terminator_thickness*dxyz);
    const length = separation_height*dxyz;
    const sigma = length/(resistance*area);
    cpu.sigma_k
      .lo([z_start+plane_height,Math.floor(Ny/2-signal_width/2),plane_border])
      .hi([separation_height,signal_width,terminator_thickness])
      .fill(sigma);
    cpu.sigma_k
      .lo([z_start+plane_height, Math.floor(Ny/2-signal_width/2), Nx-plane_border-terminator_thickness])
      .hi([separation_height, signal_width, terminator_thickness])
      .fill(sigma);
  }
  cpu.calculate_minimum_timestep();
  cpu.bake_materials();
  setup.maximum_steps = 8192;

  return setup;
}

export function create_differential_setup(adapter: GPUAdapter, device: GPUDevice): SimulationSetup {
  const size: Size3D = { x: 256, y: 128, z: 16 };
  const setup = new SimulationSetup(adapter, device, size);
  const cpu = setup.cpu;

  const { x: Nx, y: Ny, z: Nz } = size;
  cpu.epsilon_r.fill(1.0);
  cpu.mu_r.fill(1.0);
  cpu.sigma_k.fill(0.0);

  const dxyz = 1e-3;
  cpu.d.x.fill(dxyz);
  cpu.d.y.fill(dxyz);
  cpu.d.z.fill(dxyz);

  const plane_height = 1;
  const plane_border = 20;
  const signal_height = 1;
  // let signal_width = 10;
  const signal_width = 20;
  const signal_spacing = 15;
  const separation_height = 10;
  const dielectric_constant = 4.1;
  const terminator_thickness = 2;

  const z_start = Math.floor(Nz/2 - (plane_height+separation_height+signal_height)/2);
  // ground plane
  cpu.sigma_k
    .lo([z_start, plane_border, plane_border])
    .hi([plane_height, Ny-plane_border*2, Nx-plane_border*2])
    .fill(1e8);
  // dielectric
  cpu.epsilon_r
    .lo([z_start+plane_height, plane_border, plane_border])
    .hi([separation_height, Ny-plane_border*2, Nx-plane_border*2])
    .fill(dielectric_constant);
  // differential transmission lines
  cpu.sigma_k
    .lo([z_start+plane_height+separation_height, Math.floor(Ny/2-signal_spacing/2-signal_width), plane_border])
    .hi([signal_height, signal_width, Nx-plane_border*2])
    .fill(1e8);
  cpu.sigma_k
    .lo([z_start+plane_height+separation_height, Math.floor(Ny/2+signal_spacing/2), plane_border])
    .hi([signal_height, signal_width, Nx-plane_border*2])
    .fill(1e8);

  // sources
  const signal = create_sinc_pulse(256);
  const signals = {
    0: signal.map(v => v),
    1: signal.map(v => -v),
  };
  setup.source_values = signals;
  setup.sources.push({
    current_id: 0,
    offset: { z: z_start+plane_height, y: Math.floor(Ny/2-signal_spacing/2-signal_width), x: Math.floor(Nx/2) },
    size: { z: separation_height, y: signal_width, x: 1 },
  });
  setup.sources.push({
    current_id: 1,
    offset: { z: z_start+plane_height, y: Math.floor(Ny/2+signal_spacing/2), x: Math.floor(Nx/2) },
    size: { z: separation_height, y: signal_width, x: 1 },
  });
  setup.maximum_steps = 8192;

  // terminator resistors
  {
    const resistance = estimate_differential_impedance_ipc2141(dielectric_constant, separation_height, signal_width, signal_height, signal_spacing);
    const area = (signal_width*dxyz)*(terminator_thickness*dxyz);
    const length = separation_height*dxyz;
    const sigma = length/(resistance*area);
    const add_terminator = (x: number, y: number) => {
      cpu.sigma_k
        .lo([z_start+plane_height,y,x])
        .hi([separation_height,signal_width,terminator_thickness])
        .fill(sigma);
    };
    add_terminator(plane_border, Math.floor(Ny/2-signal_spacing/2-signal_width));
    add_terminator(plane_border, Math.floor(Ny/2+signal_spacing/2));
    add_terminator(Nx-plane_border-terminator_thickness, Math.floor(Ny/2-signal_spacing/2-signal_width));
    add_terminator(Nx-plane_border-terminator_thickness, Math.floor(Ny/2+signal_spacing/2));
  }
  cpu.calculate_minimum_timestep();
  cpu.bake_materials();

  return setup;
};
