// Point FreeChain's private data directory at a throwaway location.
//
// The Harness library lives in the platform's private app data. Without this,
// a test that starts a server would compose requests with whatever Harness the
// developer running the suite happens to have configured — so the suite would
// pass or fail depending on the machine it ran on. Import this for its side
// effect before importing anything that resolves the data directory.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freechain-test-data-'));
process.env.FREECHAIN_DATA_DIR = dir;
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

export const TEST_DATA_DIR = dir;
