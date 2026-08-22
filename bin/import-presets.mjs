#!/usr/bin/env node
import { importAllPresets } from '../src/presets.js';

try {
  const result = importAllPresets();
  for (const source of result.sources) console.log(`${source.source}: ${source.fileCount} presets imported`);
} catch (error) {
  console.error(`freechain preset import failed: ${error.message}`);
  process.exitCode = 1;
}
