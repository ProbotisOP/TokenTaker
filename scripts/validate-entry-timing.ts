import { readFileSync, writeFileSync } from 'node:fs';
import { EarlyEntryEngine } from '../src/trading/earlyEntryEngine.ts';
import { EarlyEntryEngine as LegacyEarlyEntryEngine } from '../tests/fixtures/legacyEarlyEntryEngine.ts';
import { auditEntryTiming, DEFAULT_AUDIT_CONFIG } from '../src/trading/entryTimingValidation.ts';

// Offline only: no wallet, coordinator, network client or live arming path is imported.
try {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  let allowSynthetic = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--allow-synthetic' && !allowSynthetic) { allowSynthetic = true; continue; }
    if (!['--input', '--output', '--config'].includes(arg) || options.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node --import tsx scripts/validate-entry-timing.ts --input capture.json [--config config.json] [--output report.json] [--allow-synthetic]');
    }
    options.set(arg, args[++i]);
  }
  if (!options.has('--input')) throw new Error('No genuine data supplied: --input capture.json is required; fixtures need --allow-synthetic.');
  const data: unknown = JSON.parse(readFileSync(options.get('--input')!, 'utf8'));
  const config = options.has('--config') ? JSON.parse(readFileSync(options.get('--config')!, 'utf8')) : DEFAULT_AUDIT_CONFIG;
  const report = auditEntryTiming(data, {
    candidate: (price, policy) => new EarlyEntryEngine(price, policy),
    baseline: (price, policy) => new LegacyEarlyEntryEngine(price, policy),
  }, config, allowSynthetic);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.has('--output')) writeFileSync(options.get('--output')!, json, { flag: 'wx' });
  else process.stdout.write(json);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
