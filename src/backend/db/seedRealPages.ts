export { seed20OfficialPages, OFFICIAL_20_TARGETS } from './seed20Pages.js';
import { seed20OfficialPages } from './seed20Pages.js';
import { closeDatabase } from './index.js';

if (process.argv[1] && process.argv[1].endsWith('seedRealPages.ts')) {
  seed20OfficialPages()
    .then((result) => {
      console.log('\n=================== 20-PAGE SEEDING REPORT ===================');
      console.log(`Total Targets: ${result.totalTargets} | Seeded: ${result.seeded}\n`);
      console.table(
        result.reports.map((r) => ({
          '#': r.index,
          Name: r.name,
          Category: r.category,
          Schedule: r.schedule,
          'Monitor ID': r.monitorExternalId,
          'Monitor Status': r.monitorStatus,
          'Browser Status': r.browserStatus,
          'Version ID': r.baselineVersionId ? r.baselineVersionId.slice(0, 8) + '...' : 'none',
        }))
      );
      closeDatabase().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Reset and seed failed:', err);
      process.exit(1);
    });
}
