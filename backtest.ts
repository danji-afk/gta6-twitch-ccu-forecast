import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forecast, LEVELS, releaseDayViewers } from './main.ts';
import type { Comparable } from './main.ts';

type InputCase = { comparables: Comparable[] };

export function runBacktest(directory = '/tmp/gta6-twitch-ccu-forecast-01-kit/input'): number {
  const files = readdirSync(directory).filter(name => /^p0.*\.in$/.test(name)).sort();
  let totalLoss = 0;
  let count = 0;
  for (const file of files) {
    const input = JSON.parse(readFileSync(join(directory, file), 'utf8')) as InputCase;
    const comparables = input.comparables ?? [];
    for (let held = 0; held < comparables.length; held++) {
      const target = comparables[held];
      const actual = releaseDayViewers(target);
      const anchor = actual.get(1);
      if (typeof anchor !== 'number' || !Number.isFinite(anchor) || anchor <= 0) continue;
      const pseudo = forecast({
        known: [{ hour: 1, viewers: anchor }],
        comparables: comparables.filter((_, index) => index !== held),
      });
      for (const row of pseudo.hours) {
        const y = actual.get(row.hour);
        if (typeof y !== 'number' || !Number.isFinite(y) || y <= 0) continue;
        const logY = Math.log(y);
        for (let i = 0; i < LEVELS.length; i++) {
          const q = row.q[i];
          const d = logY - Math.log(q);
          const tau = LEVELS[i];
          totalLoss += 2 * Math.max(tau * d, (tau - 1) * d);
          count++;
        }
      }
    }
  }
  const mean = count ? totalLoss / count : 0;
  console.log(`Leave-one-out mean pinball loss: ${mean.toFixed(6)} (n=${count})`);
  return mean;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBacktest(process.argv[2] || '/tmp/gta6-twitch-ccu-forecast-01-kit/input');
}
