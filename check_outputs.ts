import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node check_outputs.ts <output-dir>');
const files = readdirSync(directory).filter(name => name.endsWith('.out')).sort();
if (files.length !== 4) throw new Error(`Expected 4 outputs, found ${files.length}`);
for (const file of files) {
  const path = join(directory, file);
  const size = statSync(path).size;
  if (size >= 65536) throw new Error(`${file}: file size ${size} is too large`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (Object.keys(parsed).length !== 1 || !Array.isArray(parsed.hours) || parsed.hours.length !== 23) {
    throw new Error(`${file}: invalid top-level shape`);
  }
  for (let index = 0; index < 23; index++) {
    const row = parsed.hours[index];
    if (Object.keys(row).sort().join(',') !== 'hour,q' || row.hour !== index + 2 || !Array.isArray(row.q) || row.q.length !== 5) {
      throw new Error(`${file}: invalid row at index ${index}`);
    }
    if (row.q.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9)) {
      throw new Error(`${file}: invalid quantile value at hour ${row.hour}`);
    }
    if (row.q.some((value: number, quantile: number) => quantile > 0 && value < row.q[quantile - 1])) {
      throw new Error(`${file}: quantiles not non-decreasing at hour ${row.hour}`);
    }
  }
  console.log(`${file}: OK (${size} bytes, 23 rows, 2..24)`);
}
console.log(`Validated ${files.length} output files.`);
