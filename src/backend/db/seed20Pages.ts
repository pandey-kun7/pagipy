import { pageService } from '../services/pageService.js';
import { runCoordinator } from '../services/runCoordinator.js';
import { monitorAdapter } from '../adapters/tinyfish/monitorAdapter.js';
import { fetchAdapter, PreflightResult } from '../adapters/tinyfish/fetchAdapter.js';
import { query, closeDatabase } from './index.js';
import { logger } from '../utils/logger.js';
import { runMigrations } from './migrate.js';
import { PageRecord } from '../../shared/types.js';

export interface OfficialTarget {
  index: number;
  name: string;
  url: string;
  category: string;
  schedule_type: 'hourly' | 'daily' | 'weekly';
  schedule_timezone: string;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  monitor_objective: string;
  backupUrl?: string;
  backupName?: string;
}

export const OFFICIAL_20_TARGETS: OfficialTarget[] = [
  {
    index: 1,
    name: 'GitHub Copilot plans',
    url: 'https://github.com/features/copilot/plans',
    category: 'SaaS pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track plan names, monthly prices, included credits/usage, model access, feature entitlements, and plan limits.',
  },
  {
    index: 2,
    name: 'Claude pricing',
    url: 'https://claude.com/pricing',
    category: 'SaaS pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track Free/Pro/Max and team plan prices, annual-vs-monthly billing, usage limits, and included features.',
  },
  {
    index: 3,
    name: 'Gemini API pricing',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    category: 'API pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track model names, input/output/caching rates, free-tier limits, effective dates, and pricing notes.',
  },
  {
    index: 4,
    name: 'Cloudflare Workers pricing',
    url: 'https://developers.cloudflare.com/workers/platform/pricing/',
    category: 'Developer platform pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track plan minimums, included request/CPU/storage quotas, overage rates, and billing-model changes.',
  },
  {
    index: 5,
    name: 'Stripe India pricing',
    url: 'https://stripe.com/in/pricing',
    category: 'Payments pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track domestic/international card rates, conversion surcharges, MDR notes, product fees, and pricing conditions.',
  },
  {
    index: 6,
    name: 'Notion pricing',
    url: 'https://www.notion.com/pricing',
    category: 'SaaS pricing',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track plan prices, billing period, seats, AI features, storage/history limits, and plan entitlements.',
  },
  {
    index: 7,
    name: 'GitHub Changelog',
    url: 'https://github.blog/changelog/',
    category: 'Product changelog',
    schedule_type: 'hourly',
    schedule_timezone: 'Asia/Kolkata',
    monitor_objective: 'Track new release/improvement/retirement entries, dates, titles, affected products, and substantive descriptions. Ignore rotating UI and pagination noise.',
  },
  {
    index: 8,
    name: 'Cloudflare Changelog',
    url: 'https://developers.cloudflare.com/changelog/',
    category: 'Product changelog',
    schedule_type: 'hourly',
    schedule_timezone: 'Asia/Kolkata',
    monitor_objective: 'Track new product updates, release dates, feature changes, deprecations, quota changes, and breaking changes. Ignore navigation and search UI noise.',
  },
  {
    index: 9,
    name: 'OpenAI Terms of Use',
    url: 'https://openai.com/policies/terms-of-use/',
    category: 'Terms of service',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track effective dates and changes to account rules, content rights, paid plans, cancellation/refunds, restrictions, termination, and liability.',
  },
  {
    index: 10,
    name: 'OpenAI US Privacy Policy',
    url: 'https://openai.com/policies/privacy-policy/',
    category: 'Privacy policy',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track data categories, collection/use, sharing, retention, controls, opt-outs, user rights, and effective dates.',
  },
  {
    index: 11,
    name: 'Anthropic Legal Center',
    url: 'https://www.anthropic.com/legal',
    category: 'Terms and policies index',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track newly published, revised, or withdrawn legal documents; titles, jurisdictions, document dates, and links. Follow only public linked documents if supported.',
  },
  {
    index: 12,
    name: 'Stripe Services Agreement — India',
    url: 'https://stripe.com/in/legal/ssa/in',
    category: 'Business terms',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track agreement date, service definitions, fees, reserves, disputes, termination, data/security obligations, and material clause changes.',
  },
  {
    index: 13,
    name: 'UK visa fees',
    url: 'https://www.gov.uk/government/publications/visa-regulations-revised-table',
    category: 'Immigration fees',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track new fee-table versions, effective dates, visitor/work/student/settlement fee changes, and linked updated documents.',
  },
  {
    index: 14,
    name: 'Canada immigration fee list',
    url: 'https://ircc.canada.ca/English/information/fees/fees.asp',
    category: 'Immigration fees',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track application categories, visitor/study/work/PR/biometrics fees, amounts, and fee notes.',
    backupUrl: 'https://ircc.canada.ca/english/information/fees/fee-changes.asp',
    backupName: 'Canada immigration fee changes',
  },
  {
    index: 15,
    name: 'Australia current visa pricing',
    url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing/',
    category: 'Immigration fees',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track visa subclass charges, additional applicant charges, surcharges, estimator notes, and pricing changes.',
    backupUrl: 'https://www.indianvisaonline.gov.in/evisa/',
    backupName: 'India e-Visa official page',
  },
  {
    index: 16,
    name: 'HDFC ERGO health policy wordings',
    url: 'https://www.hdfcergo.com/download/policy-wordings/health',
    category: 'Insurance coverage documents',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track new/revised/withdrawn health policy wordings, product/UIN labels, effective-period notes, riders, and regulatory notices.',
    backupUrl: 'https://www.newindia.co.in/health-insurance/health-insurance-policy',
    backupName: 'New India Assurance Mediclaim policy',
  },
  {
    index: 17,
    name: 'HDFC ERGO motor policy wordings',
    url: 'https://www.hdfcergo.com/download/policy-wordings/motor',
    category: 'Insurance coverage documents',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track motor policy and add-on wording changes, third-party/own-damage labels, product availability, and effective dates.',
  },
  {
    index: 18,
    name: 'HDFC ERGO travel policy wordings',
    url: 'https://www.hdfcergo.com/download/policy-wordings/travel',
    category: 'Insurance coverage documents',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track travel product wording changes, plan names, coverage documents, eligibility notes, and effective dates.',
  },
  {
    index: 19,
    name: 'Tata AIG downloads',
    url: 'https://www.tataaig.com/downloads',
    category: 'Insurance product documents',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track new/revised health and other insurance products, UINs, add-ons/riders, policy-document links, and document dates.',
  },
  {
    index: 20,
    name: 'Bajaj General health insurance documents',
    url: 'https://www.bajajgeneralinsurance.com/health-insurance-plans/health-insurance-documents.html',
    category: 'Insurance coverage documents',
    schedule_type: 'daily',
    schedule_timezone: 'Asia/Kolkata',
    schedule_hour: 9,
    schedule_minute: 0,
    monitor_objective: 'Track health product names, policy wordings, customer information sheets, premium charts, brochures, and newly introduced products.',
    backupUrl: 'https://www.icicilombard.com/downloads?download=true',
    backupName: 'ICICI Lombard downloads',
  },
];

export interface SeedReportItem {
  index: number;
  name: string;
  url: string;
  finalUrl?: string;
  category: string;
  schedule: string;
  pageId: string;
  monitorExternalId: string;
  baselineRunId?: string;
  baselineVersionId?: string;
  monitorStatus: string;
  browserStatus: string;
  screenshotPath?: string | null;
  preflightSuccess: boolean;
  notes?: string;
}

/**
 * Idempotently seeds the 20 official public pages, preflights each URL,
 * creates/links real TinyFish Monitor resources, and executes a staggered baseline run.
 */
export async function seed20OfficialPages(): Promise<{
  totalTargets: number;
  seeded: number;
  reports: SeedReportItem[];
}> {
  await runMigrations();

  logger.info('Starting idempotent seeding of the 20 official public pages...');
  const reports: SeedReportItem[] = [];

  for (const target of OFFICIAL_20_TARGETS) {
    logger.info(`[${target.index}/20] Processing target: ${target.name}`, { url: target.url });

    let activeUrl = target.url;
    let activeName = target.name;

    // 1. Preflight check using TinyFish Fetch
    const preflight = await fetchAdapter.preflightUrl(activeUrl);
    if (!preflight.success && target.backupUrl) {
      logger.warn(`Primary target ${target.name} preflight failed, testing backup ${target.backupName}`, {
        primaryUrl: target.url,
        backupUrl: target.backupUrl,
        error: preflight.errorMessage,
      });
      const backupPreflight = await fetchAdapter.preflightUrl(target.backupUrl);
      if (backupPreflight.success) {
        activeUrl = target.backupUrl;
        activeName = target.backupName || activeName;
      }
    }

    // 2. Check if page already exists in PostgreSQL (idempotent lookup)
    const existing = await query<PageRecord>(
      `SELECT * FROM pages WHERE submitted_url = $1 OR canonical_url = $1 LIMIT 1`,
      [activeUrl]
    );

    let page: PageRecord;
    if (existing.rowCount && existing.rowCount > 0) {
      page = existing.rows[0];
      logger.info(`Page already exists in database (ID: ${page.id})`, { name: page.name });
    } else {
      page = await pageService.createPage({
        name: activeName,
        url: activeUrl,
        category: target.category,
        monitor_objective: target.monitor_objective,
        schedule_type: target.schedule_type,
        schedule_timezone: target.schedule_timezone,
        schedule_hour: target.schedule_hour,
        schedule_minute: target.schedule_minute,
      });
      logger.info(`Created page record in database (ID: ${page.id})`, { name: page.name });
    }

    // 3. Ensure TinyFish Monitor resource exists
    let monitorExternalId = page.monitor_external_id;
    if (!monitorExternalId) {
      const setup = await monitorAdapter.setupMonitor({
        pageId: page.id,
        url: page.canonical_url,
        objective: page.monitor_objective,
      });
      if (setup.monitorExternalId) {
        monitorExternalId = setup.monitorExternalId;
        page.monitor_external_id = monitorExternalId;
        await query(`UPDATE pages SET monitor_external_id = $1 WHERE id = $2`, [
          monitorExternalId,
          page.id,
        ]);
        logger.info(`Linked TinyFish Monitor ID to page`, {
          pageId: page.id,
          monitorId: monitorExternalId,
        });
      }
    }

    // 4. Check if baseline version already exists
    const versionsRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM page_versions WHERE page_id = $1`,
      [page.id]
    );
    const hasVersions = parseInt(versionsRes.rows[0]?.count || '0', 10) > 0;

    let baselineRunId: string | undefined;
    let baselineVersionId: string | undefined;
    let monitorStatus = 'not_needed';
    let browserStatus = 'not_needed';
    let screenshotPath: string | undefined;

    if (!hasVersions) {
      logger.info(`Executing initial paired baseline run for ${page.name}...`);
      try {
        const run = await runCoordinator.triggerManualRun(page.id);
        baselineRunId = run.id;
        monitorStatus = run.monitor_status;
        browserStatus = run.browser_status;
        baselineVersionId = run.version_id || undefined;
        screenshotPath = run.screenshot_artifact_path || undefined;

        logger.info(`Baseline paired run finished`, {
          pageId: page.id,
          runId: run.id,
          status: run.status,
          versionId: run.version_id || undefined,
        });
      } catch (runErr) {
        logger.error(`Baseline run error for ${page.name}`, runErr, { pageId: page.id });
        monitorStatus = 'failed';
        browserStatus = 'failed';
      }

      // Small pause between targets to stagger CDP sessions and avoid concurrency spikes
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      logger.info(`Page already has captured versions; skipping redundant baseline run`, {
        pageId: page.id,
      });
      // Fetch latest version and run
      const latestVerRes = await query<{ id: string; screenshot_artifact_path: string }>(
        `SELECT id, screenshot_artifact_path FROM page_versions WHERE page_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [page.id]
      );
      if (latestVerRes.rowCount) {
        baselineVersionId = latestVerRes.rows[0].id;
        screenshotPath = latestVerRes.rows[0].screenshot_artifact_path;
        monitorStatus = 'succeeded';
        browserStatus = 'succeeded';
      }
    }

    reports.push({
      index: target.index,
      name: page.name,
      url: page.canonical_url,
      finalUrl: preflight.finalUrl,
      category: target.category,
      schedule: target.schedule_type === 'hourly' ? 'Hourly' : `Daily at 09:00 ${target.schedule_timezone}`,
      pageId: page.id,
      monitorExternalId: monitorExternalId || 'pending_setup',
      baselineRunId,
      baselineVersionId,
      monitorStatus,
      browserStatus,
      screenshotPath,
      preflightSuccess: preflight.success,
    });
  }

  return {
    totalTargets: OFFICIAL_20_TARGETS.length,
    seeded: reports.length,
    reports,
  };
}

if (process.argv[1] && process.argv[1].endsWith('seed20Pages.ts')) {
  seed20OfficialPages()
    .then((result) => {
      console.log('\n=================== 20-PAGE SEEDING REPORT ===================');
      console.log(`Total Targets: ${result.totalTargets} | Seeded & Active: ${result.seeded}\n`);
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
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
