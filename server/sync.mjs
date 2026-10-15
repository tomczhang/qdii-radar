import { openStore } from './store.mjs';
import { createMailService } from './mail.mjs';
import { seedRules, synchronize } from './service.mjs';
const store = openStore(); seedRules(store);
try { const result = await synchronize(store, createMailService(store), { noticesOnly: process.argv.includes('--notices-only') }); console.log(JSON.stringify(result, null, 2)); if (['partial', 'failed'].includes(result.status)) process.exitCode = 1; }
finally { store.close(); }
