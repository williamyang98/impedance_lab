import {
  type SimulationSetup, SimulationSource, SimulationGrid,
} from "../engine/fdtd_3d.ts";

export const create_simulation_setup = (): SimulationSetup => {
  const grid_size: [number, number, number] = [16,128,256];
  const grid = new SimulationGrid(grid_size);

  const [Nx,Ny,Nz] = grid_size;
  grid.init_dt = 1e-12;
  grid.init_d_xyz = 1e-3;
  grid.init_epsilon_k.fill(1.0);
  grid.init_sigma_k.fill(0.0);
  grid.init_mu_k = 1.0;

  const plane_height = 1;
  const plane_border = 20;
  const signal_height = 1;
  // let signal_width = 10;
  const signal_width = 20;
  const separation_height = 5;
  const x_start = Math.floor(Nx/2 - (plane_height+separation_height+signal_height)/2);
  // ground plane
  grid.init_sigma_k
    .lo([x_start, plane_border, plane_border])
    .hi([plane_height, Ny-plane_border*2, Nz-plane_border*2])
    .fill(1e8);
  // dielectric
  grid.init_epsilon_k
    .lo([x_start+plane_height, plane_border, plane_border])
    .hi([separation_height, Ny-plane_border*2, Nz-plane_border*2])
    .fill(4.1);
  // single ended transmission line
  grid.init_sigma_k
    .lo([x_start+plane_height+separation_height, Math.floor(Ny/2-signal_width/2), plane_border])
    .hi([signal_height, signal_width, Nz-plane_border*2])
    .fill(1e8);
  // source
  const source = new SimulationSource();
  const period = 256;
  for (let i = 0; i < period; i++) {
    const dt = Math.PI*i/period;
    const amplitude = Math.sin(dt)**2;
    source.signal.push(amplitude);
  }
  source.offset = [x_start+plane_height, Math.floor(Ny/2-signal_width/2), Math.floor(Nz/2)];
  source.size = [separation_height, signal_width, 1];
  // terminator resistors
  {
    // let resistance = 78.338/2; // w=10
    const resistance = 53.864/2; // w=20
    const thickness = 1;
    const area = (signal_width*grid.init_d_xyz)*(thickness*grid.init_d_xyz);
    const length = separation_height*grid.init_d_xyz;
    const sigma = length/(resistance*area);
    grid.init_sigma_k
      .lo([x_start+plane_height,Math.floor(Ny/2-signal_width/2),plane_border])
      .hi([separation_height,signal_width,thickness])
      .fill(sigma);
    grid.init_sigma_k
      .lo([x_start+plane_height, Math.floor(Ny/2-signal_width/2), Nz-plane_border-thickness])
      .hi([separation_height, signal_width, thickness])
      .fill(sigma);
  }

  grid.bake();
  return {
    grid,
    sources: [source],
  };
};
