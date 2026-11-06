import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export interface SearchCandidate {
  title: string;
  url: string;
  category: string;
  description: string;
  source: string;
}

export class TinyFishSearchAdapter {
  private readonly apiKey: string;

  constructor(apiKey = config.tinyfishApiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Searches for official public pages by topic/category for user discovery.
   * Users review the candidates and manually choose which to monitor.
   */
  async searchOfficialPages(queryStr: string): Promise<SearchCandidate[]> {
    logger.info('Searching official candidates for query', { query: queryStr });

    const q = queryStr.toLowerCase().trim();

    // Curated catalog of official public pages matching key monitoring categories
    const catalog: SearchCandidate[] = [
      {
        title: 'GitHub Copilot Plans & Pricing',
        url: 'https://github.com/features/copilot/plans',
        category: 'SaaS pricing',
        description: 'Official GitHub Copilot seat tiers, monthly pricing, model access, and feature limits.',
        source: 'github.com',
      },
      {
        title: 'Claude Pricing & Plans',
        url: 'https://claude.com/pricing',
        category: 'SaaS pricing',
        description: 'Anthropic Claude Free, Pro, and Team plan pricing, annual billing, and rate limits.',
        source: 'claude.com',
      },
      {
        title: 'Google Gemini API Pricing',
        url: 'https://ai.google.dev/gemini-api/docs/pricing',
        category: 'API pricing',
        description: 'Google AI Gemini model token pricing, free-tier quotas, and effective date notes.',
        source: 'ai.google.dev',
      },
      {
        title: 'Cloudflare Workers Platform Pricing',
        url: 'https://developers.cloudflare.com/workers/platform/pricing/',
        category: 'Developer platform pricing',
        description: 'Workers Free and Paid plan limits, request quotas, and CPU execution pricing.',
        source: 'cloudflare.com',
      },
      {
        title: 'Stripe India Pricing',
        url: 'https://stripe.com/in/pricing',
        category: 'Payments pricing',
        description: 'Stripe India domestic and international transaction fees, MDR, and currency surcharges.',
        source: 'stripe.com',
      },
      {
        title: 'Notion Plans & Pricing',
        url: 'https://www.notion.com/pricing',
        category: 'SaaS pricing',
        description: 'Notion Plus, Business, and Enterprise seat pricing, AI add-on costs, and storage limits.',
        source: 'notion.com',
      },
      {
        title: 'GitHub Changelog',
        url: 'https://github.blog/changelog/',
        category: 'Product changelog',
        description: 'Official continuous stream of GitHub product releases, deprecations, and new features.',
        source: 'github.blog',
      },
      {
        title: 'Cloudflare Developers Changelog',
        url: 'https://developers.cloudflare.com/changelog/',
        category: 'Product changelog',
        description: 'Continuous technical changelog for Cloudflare services, APIs, and breaking updates.',
        source: 'cloudflare.com',
      },
      {
        title: 'OpenAI Terms of Use',
        url: 'https://openai.com/policies/terms-of-use/',
        category: 'Terms of service',
        description: 'OpenAI official terms of use, content ownership, paid service terms, and liability limits.',
        source: 'openai.com',
      },
      {
        title: 'OpenAI US Privacy Policy',
        url: 'https://openai.com/policies/privacy-policy/',
        category: 'Privacy policy',
        description: 'OpenAI data collection, retention, model training usage, and privacy disclosure.',
        source: 'openai.com',
      },
      {
        title: 'Anthropic Legal Center',
        url: 'https://www.anthropic.com/legal',
        category: 'Terms and policies index',
        description: 'Index of Anthropic terms, commercial policies, and acceptable use guidelines.',
        source: 'anthropic.com',
      },
      {
        title: 'Stripe Services Agreement — India',
        url: 'https://stripe.com/in/legal/ssa/in',
        category: 'Business terms',
        description: 'Official legal terms and merchant agreement for Stripe operations in India.',
        source: 'stripe.com',
      },
      {
        title: 'UK Visa Regulations Revised Fee Table',
        url: 'https://gov.uk/government/publications/visa-regulations-revised-table',
        category: 'Immigration fees',
        description: 'Official UK Home Office statutory visa and immigration fee schedules.',
        source: 'gov.uk',
      },
      {
        title: 'Canada Immigration and Citizenship Fee List',
        url: 'https://ircc.canada.ca/English/information/fees/fees.asp',
        category: 'Immigration fees',
        description: 'Official Government of Canada IRCC fees for study, work, visitor, and PR applications.',
        source: 'canada.ca',
      },
      {
        title: 'Australia Current Visa Pricing',
        url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing/',
        category: 'Immigration fees',
        description: 'Department of Home Affairs statutory base application charges and subclass fees.',
        source: 'homeaffairs.gov.au',
      },
      {
        title: 'HDFC ERGO Health Policy Wordings',
        url: 'https://www.hdfcergo.com/download/policy-wordings/health',
        category: 'Insurance coverage documents',
        description: 'Regulatory policy wordings, UINs, and rider disclosures for HDFC ERGO health plans.',
        source: 'hdfcergo.com',
      },
      {
        title: 'HDFC ERGO Motor Policy Wordings',
        url: 'https://www.hdfcergo.com/download/policy-wordings/motor',
        category: 'Insurance coverage documents',
        description: 'Official policy documents, add-on terms, and wordings for motor insurance.',
        source: 'hdfcergo.com',
      },
      {
        title: 'HDFC ERGO Travel Policy Wordings',
        url: 'https://www.hdfcergo.com/download/policy-wordings/travel',
        category: 'Insurance coverage documents',
        description: 'Official travel insurance wordings, schedule of benefits, and exclusions.',
        source: 'hdfcergo.com',
      },
      {
        title: 'Tata AIG Insurance Downloads & Wordings',
        url: 'https://www.tataaig.com/downloads',
        category: 'Insurance product documents',
        description: 'Official Tata AIG customer forms, prospectus documents, and policy wordings.',
        source: 'tataaig.com',
      },
      {
        title: 'Bajaj General Health Insurance Documents',
        url: 'https://www.bajajgeneralinsurance.com/health-insurance-plans/health-insurance-documents.html',
        category: 'Insurance coverage documents',
        description: 'Customer Information Sheets, premium charts, and wordings for Bajaj Allianz health plans.',
        source: 'bajajgeneralinsurance.com',
      },
    ];

    if (!q) return catalog;

    return catalog.filter((item) =>
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q)
    );
  }
}

export const searchAdapter = new TinyFishSearchAdapter();
