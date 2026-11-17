import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Observation = { from: string; viewers: number };
export type Comparable = { name?: string; day_start: string; hourly: Observation[] };
export type Case = { known?: { hour: number; viewers: number }[]; comparables?: Comparable[] };
export type Forecast = { hours: { hour: number; q: number[] }[] };
export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
const KERNEL = [[0, 1], [1, 0.6], [-1, 0.6], [2, 0.3], [-2, 0.3]];
const SIMILARITY_TEMPERATURE = 0.75;
const HOUR_MS = 3_600_000;

export function weightedQuantile(
  pairs: { value: number; weight: number }[],
  tau: number,
  fallbackValue: number,
): number {
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  const threshold = tau * total;
  let accumulated = 0;
  let selected = fallbackValue;
  for (const pair of pairs) {
    accumulated += pair.weight;
    if (accumulated >= threshold) {
      selected = pair.value;
      break;
    }
  }
  return selected;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Release-day timestamps only; duplicate timestamps keep the last file row. */
export function releaseDayViewers(c: Comparable): Map<number, number> {
  const result = new Map<number, number>();
  const start = Date.parse(c.day_start);
  if (!Number.isFinite(start)) return result;
  for (const row of c.hourly ?? []) {
    const offset = (Date.parse(row.from) - start) / HOUR_MS;
    if (Number.isInteger(offset) && offset >= 0 && offset < 24) {
      result.set(offset + 1, row.viewers);
    }
  }
  return result;
}

function roundedBounded(value: number): number {
  // Clamping also prevents overflow and rounding tiny positive values to zero.
  return Math.round(Math.min(1e9, Math.max(0.01, value)) * 100) / 100;
}

/** Pure, deterministic weighted log-ratio forecast, shared with backtesting. */
export function forecast(input: Case): Forecast {
  const known = input.known?.find(row => row.hour === 1 && positive(row.viewers));
  const p1 = known ? Math.max(1, known.viewers) : 1;
  const logP1 = Math.log(p1);
  const shapes: { ratios: Map<number, number>; weight: number; order: number }[] = [];
  for (const [order, c] of (input.comparables ?? []).entries()) {
    const values = releaseDayViewers(c);
    const v1 = values.get(1);
    if (!positive(v1)) continue;
    const logV1 = Math.log(v1);
    const weight = Math.exp(-Math.abs(logP1 - logV1) / SIMILARITY_TEMPERATURE);
    const ratios = new Map<number, number>();
    for (let h = 2; h <= 24; h++) {
      const value = values.get(h);
      if (positive(value)) ratios.set(h, Math.log(value) - logV1);
    }
    shapes.push({ ratios, weight, order });
  }

  const hours: Forecast['hours'] = [];
  for (let hour = 2; hour <= 24; hour++) {
    const pairs: { value: number; weight: number; order: number; kernelOrder: number }[] = [];
    for (const shape of shapes) {
      for (const [kernelOrder, [d, kw]] of KERNEL.entries()) {
        const hh = hour + d;
        const value = shape.ratios.get(hh);
        if (hh >= 2 && hh <= 24 && value !== undefined) {
          pairs.push({ value, weight: shape.weight * kw, order: shape.order, kernelOrder });
        }
      }
    }
    pairs.sort((a, b) => a.value - b.value || a.order - b.order || a.kernelOrder - b.kernelOrder);
    const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
    let q: number[];
    if (pairs.length < 3 || !(total > 0) || !Number.isFinite(total)) {
      q = Z.map(z => roundedBounded(p1 * Math.exp(z * 0.15 * Math.sqrt(hour - 1))));
    } else {
      q = LEVELS.map(tau =>
        roundedBounded(p1 * Math.exp(weightedQuantile(pairs, tau, pairs[pairs.length - 1].value)))
      );
    }
    hours.push({ hour, q });
  }
  return { hours };
}

export function run(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir).filter(name => name.endsWith('.in')).sort();
  for (const file of files) {
    const input = JSON.parse(readFileSync(join(inputDir, file), 'utf8')) as Case;
    const output = join(outputDir, file.slice(0, -3) + '.out');
    const temporary = output + '.tmp';
    writeFileSync(temporary, JSON.stringify(forecast(input)), 'utf8');
    renameSync(temporary, output);
  }
}

// Importing this module for backtesting must not read or write case directories.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
