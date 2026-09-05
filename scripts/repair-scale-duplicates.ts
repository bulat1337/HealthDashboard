import path from 'node:path';
import { repairScaleDuplicates } from '../server/health-ingest.js';

const dataDir = process.env.HEALTH_DATA_DIR || path.resolve('data/xiaomi-body-scale');
const dataFile = process.env.HEALTH_DATA_FILE || path.join(dataDir, 'xiaomi-body-scale-data.json');
// Stop the bridge before --write; a backup of the canonical JSON is created automatically.
console.log(JSON.stringify(repairScaleDuplicates({dataDir, dataFile}, process.argv.includes('--write'))));
