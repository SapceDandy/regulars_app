import { configuration } from '../apps/web/config.js';
import { openStore } from '../packages/db/store.js';
import { seed } from '../packages/db/seed.js';
const c=configuration();const s=openStore(c.databasePath);
try {await seed(s,{mode:c.mode,configPath:c.env.VENUE_CONFIG_PATH,configJson:c.env.VENUE_CONFIG_JSON});}
finally {await s.close();}
console.log('Venue configuration initialized. Existing records were preserved.');
