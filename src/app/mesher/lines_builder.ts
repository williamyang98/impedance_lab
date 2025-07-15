export class LinesBuilder {
  id_to_index: number[] = [];
  lines: number[] = [];
  is_sorted: boolean = false;
  scale: number = 1.0;

  push(line: number): number {
    const id = this.id_to_index.length;
    const N = this.lines.length;
    if (N > 0 && this.is_sorted && this.lines[N-1] > line) {
      this.is_sorted = false;
    }
    const index = this.lines.length;
    this.lines.push(line);
    this.id_to_index.push(index);
    return id;
  }

  sort() {
    if (this.is_sorted) return;
    const N = this.lines.length;
    const sort_indices: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      sort_indices[i] = i;
    }

    sort_indices.sort((a,b) => this.lines[a] - this.lines[b]);
    this.lines = sort_indices.map((i) => this.lines[i]);
    const new_id_to_index = new Array(N);
    for (let i = 0; i < N; i++) {
      const new_i = sort_indices[i];
      new_id_to_index[new_i] = this.id_to_index[i];
    }
    this.id_to_index = new_id_to_index;
    this.is_sorted = true;
  }

  get_index(id: number) {
    return this.id_to_index[id];
  }

  get_line(id: number) {
    const index = this.id_to_index[id];
    return this.lines[index];
  }

  to_regions(): number[] {
    this.sort();
    const N = this.lines.length;
    if (N < 2) throw Error(`Need at least 2 grid lines for a region`);
    const regions = new Array(N-1);
    for (let i = 0; i < (N-1); i++) {
      regions[i] = this.lines[i+1]-this.lines[i];
    }
    return regions;
  }

  merge(threshold: number) {
    this.sort();

    const N = this.lines.length;
    const merged_lines: number[] = [];
    const index_to_merged_index: number[] = Array.from({ length: N }, (_) => 0);
    let merge_line: number = -Infinity;
    for (let i = 0; i < N; i++) {
      const line = this.lines[i];
      const dist = Math.abs(line-merge_line);
      if (dist > threshold) {
        merge_line = line;
        merged_lines.push(merge_line);
      }
      const merge_index = merged_lines.length-1;
      if (merge_index < 0) {
        throw Error(`No merge lines to map to. Did you push -Infinity to the grid?`);
      }
      index_to_merged_index[i] = merge_index;
    }

    this.lines = merged_lines;
    for (let id = 0; id < this.id_to_index.length; id++) {
      const index = this.id_to_index[id];
      const merged_index = index_to_merged_index[index];
      this.id_to_index[id] = merged_index;
    }
  }

  apply_scale(scale: number) {
    for (let i = 0; i < this.lines.length; i++) {
      this.lines[i] *= scale;
    }
    this.scale *= scale;
  }
}
