import { type Bound } from "../../utility/dim_types.ts";
import { type MeshSegment } from "../../app/mesher/mesher.ts";

export interface MeshLines {
  region_lines: number[];
  grid_lines: number[];
  scale: number;
  unpadded_boundary: Bound<number>;
  padded_boundary: Partial<Bound<number>>;
  mesh_segments: MeshSegment[];
  flip?: boolean;
}
