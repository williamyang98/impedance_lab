export interface ComputeBenchmarkConfig {
  total_compute_units: number;
  total_warmup_steps: number;
  total_warm_steps: number;
  work_multiplier: number;
}

export interface MemoryBandwidthBenchmarkConfig {
  total_transfers: number;
}
