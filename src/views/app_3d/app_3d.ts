import { SimulationSetup, type SimulationSource } from "./grid.ts";
import { type Size3D } from "../../wgpu_kernels/fdtd_3d/index.ts";

export function create_simulation_setup(adapter: GPUAdapter, device: GPUDevice): SimulationSetup {
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
  const separation_height = 5;
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
    .fill(4.1);
  // single ended transmission line
  cpu.sigma_k
    .lo([z_start+plane_height+separation_height, Math.floor(Ny/2-signal_width/2), plane_border])
    .hi([signal_height, signal_width, Nx-plane_border*2])
    .fill(1e8);

  // source
  const source: SimulationSource = {
    signal: [],
    offset: { x: 0, y: 0, z: 0 },
    size: { x: 0, y: 0, z: 0 },
  };
  const period = 256;
  for (let i = 0; i < period; i++) {
    const dt = Math.PI*i/period;
    const amplitude = Math.sin(dt)**2;
    source.signal.push(amplitude);
  }
  source.offset = { z: z_start+plane_height, y: Math.floor(Ny/2-signal_width/2), x: Math.floor(Nx/2) };
  source.size = { z: separation_height, y: signal_width, x: 1 };
  setup.sources.push(source);

  // terminator resistors
  {
    // const resistance = 78.338/2; // w=10
    const resistance = 53.864/2; // w=20
    const thickness = 1;
    const area = (signal_width*dxyz)*(thickness*dxyz);
    const length = separation_height*dxyz;
    const sigma = length/(resistance*area);
    cpu.sigma_k
      .lo([z_start+plane_height,Math.floor(Ny/2-signal_width/2),plane_border])
      .hi([separation_height,signal_width,thickness])
      .fill(sigma);
    cpu.sigma_k
      .lo([z_start+plane_height, Math.floor(Ny/2-signal_width/2), Nx-plane_border-thickness])
      .hi([separation_height, signal_width, thickness])
      .fill(sigma);
  }
  cpu.bake_materials();

  return setup;
};
