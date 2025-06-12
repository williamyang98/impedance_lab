import { LinearMeshSegment, OpenGeometricMeshSegment, ClosedGeometricMeshSegment } from "./mesher.ts";
import { LinesBuilder } from "./lines_builder.ts";

export type RegionMeshSegment =
  { type: "linear", segment: LinearMeshSegment } |
  { type: "open_geometric", segment: OpenGeometricMeshSegment } |
  { type: "closed_geometric", segment: ClosedGeometricMeshSegment };

export interface RegionSpecification {
  size: number;
  total_grid_lines?: number;
}

export function generate_region_mesh_segments(
  regions: RegionSpecification[],
  min_region_subdivisions?: number, max_ratio?: number,
): RegionMeshSegment[] {
  min_region_subdivisions = min_region_subdivisions ?? 3;
  max_ratio = max_ratio ?? 0.5;

  const a_min = regions.map(region => region.size/min_region_subdivisions);

  const segments: RegionMeshSegment[] = [];
  const N = regions.length;
  for (let i = 0; i < N; i++) {
    const region = regions[i];
    const a_mid = a_min[i];
    let a_left = (i > 0) ? a_min[i-1] : null;
    let a_right = (i < (N-1)) ? a_min[i+1] : null;

    a_left = (a_left !== null && a_mid !== null) ? Math.min(a_left, a_mid) : null;
    a_right = (a_right !== null && a_mid !== null) ? Math.min(a_right, a_mid) : null;

    const A = region.size;
    const total_grid_lines = region.total_grid_lines;

    if ((a_left === null && a_right === null) || (total_grid_lines !== undefined)) {
      const n = total_grid_lines || min_region_subdivisions;
      const a = A/n;
      segments.push({ type: "linear", segment: new LinearMeshSegment(a, n) });
    } else if (a_left === null && a_right !== null) {
      const segment = OpenGeometricMeshSegment.search_best_fit(A, a_right, 1+max_ratio, min_region_subdivisions);
      segment.is_reversed = true;
      segments.push({ type: "open_geometric", segment });
    } else if (a_left !== null && a_right === null) {
      const segment = OpenGeometricMeshSegment.search_best_fit(A, a_left, 1+max_ratio, min_region_subdivisions);
      segment.is_reversed = false;
      segments.push({ type: "open_geometric", segment });
    } else if (a_left !== null && a_right !== null) {
      const n_lower = min_region_subdivisions-1;
      let n_upper_estimate = undefined;
      {
        // compute upper bound for N assuming symmetric geometric spline with equal size
        const A_half = A/2;
        const r_max = 1.0+max_ratio;
        const a_min = Math.min(a_left, a_right);
        const n_half_estimate = OpenGeometricMeshSegment.calculate_n(A_half, r_max, a_min);
        n_upper_estimate = n_half_estimate*2;
      }
      const n_upper = Math.max(min_region_subdivisions, Math.ceil(n_upper_estimate));
      const segment = ClosedGeometricMeshSegment.search_lowest_maximum_ratio(A, a_left, a_right, n_lower, n_upper);
      segments.push({ type: "closed_geometric", segment });
    }
  }
  return segments;
}

export class RegionToGridMap {
  region_lines_builder: LinesBuilder;
  region_segments: RegionMeshSegment[];
  region_lines: number[];
  grid_segments: number[];
  grid_lines: number[];
  region_to_grid_index: number[];

  constructor(region_lines_builder: LinesBuilder, region_segments: RegionMeshSegment[]) {
    if (!region_lines_builder.is_sorted) {
      throw Error("Region lines must be sorted before creating region to grid map");
    }
    if ((region_lines_builder.lines.length-1) != region_segments.length) {
      throw Error(`Number of region lines (${region_lines_builder.lines.length})-1 does not correspond to number region segments (${region_segments.length})`);
    }

    const total_region_segments = region_segments.length;
    const total_grid_segments = region_segments
      .map(s => s.segment.get_total_elements())
      .reduce((a,b) => a+b, 0);

    const region_lines = Array.from({ length: total_region_segments+1 }, _ => 0);
    {
      let region_line: number = 0;
      for (let i = 0; i < total_region_segments; i++) {
        region_lines[i] = region_line;
        const region_segment = region_segments[i];
        region_line += region_segment.segment.get_size();
      }
      region_lines[total_region_segments] = region_line;
    }

    const grid_segments = Array.from({ length: total_grid_segments }, _ => 0);
    {
      let offset: number = 0;
      for (const { segment } of region_segments) {
        const region_grid_segments = segment.generate_deltas();
        for (let i = 0; i < region_grid_segments.length; i++) {
          grid_segments[offset+i] = region_grid_segments[i];
        }
        offset += region_grid_segments.length;
      }
    }

    const grid_lines = Array.from({ length: total_grid_segments+1 }, _ => 0);
    {
      let grid_line = 0;
      for (let i = 0; i < total_grid_segments; i++) {
        grid_lines[i] = grid_line;
        const grid_segment = grid_segments[i];
        grid_line += grid_segment;
      }
      grid_lines[total_grid_segments] = grid_line;
    }

    const region_to_grid_index = Array.from({ length: total_region_segments+1 }, _ => 0);
    {
      let grid_index = 0;
      for (let i = 0; i < total_region_segments; i++) {
        region_to_grid_index[i] = grid_index;
        const region_grid_elements = region_segments[i].segment.get_total_elements();
        grid_index += region_grid_elements;
      }
      region_to_grid_index[total_region_segments] = grid_index;
    }

    this.region_lines_builder = region_lines_builder;
    this.region_segments = region_segments;
    this.region_lines = region_lines;
    this.grid_segments = grid_segments;
    this.grid_lines = grid_lines;
    this.region_to_grid_index = region_to_grid_index;
  }

  id_to_grid_index(id: number): number {
    const region_index = this.id_to_region_index(id);
    const grid_index = this.region_to_grid_index[region_index];
    return grid_index;
  }

  id_to_region_index(id: number): number {
    const region_index = this.region_lines_builder.get_index(id);
    return region_index;
  }

  get total_grid_segments(): number {
    return this.grid_segments.length;
  }

  get total_grid_lines(): number {
    return this.grid_lines.length;
  }

  get total_region_segments(): number {
    return this.region_segments.length;
  }

  get total_region_lines(): number {
    return this.region_lines.length;
  }
}
