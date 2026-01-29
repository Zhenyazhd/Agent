#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SOLODIT_API_URL = "https://solodit.cyfrin.io/api/v1/solodit";

interface SoloditFinding {
  id: string;
  slug: string;
  title: string;
  content: string;
  summary: string | null;
  kind: string;
  impact: "HIGH" | "MEDIUM" | "LOW" | "GAS";
  quality_score: number;
  general_score: number;
  report_date: string | null;
  auditfirm_id: string | null;
  firm_name: string | null;
  firm_logo_square: string | null;
  auditfirms_auditfirm: {
    name: string | null;
    logo_square: string | null;
  };
  protocol_id: string | null;
  protocol_name: string | null;
  protocols_protocol: {
    name: string | null;
    protocols_protocolcategoryscore: Array<{
      protocols_protocolcategory: {
        title: string;
      };
      score: number;
    }>;
  };
  contest_id: string | null;
  contest_link: string | null;
  contest_prize_txt: string | null;
  sponsor_name: string | null;
  sponsor_link: string | null;
  finders_count: number;
  issues_issue_finders: Array<{
    wardens_warden: {
      handle: string;
    };
  }>;
  issues_issuetagscore: Array<{
    tags_tag: {
      title: string;
    };
  }>;
  source_link: string | null;
  github_link: string | null;
  pdf_link: string | null;
  pdf_page_from: number | null;
  bookmarked: false;
  read: false;
}

interface FindingsResponse {
  findings: SoloditFinding[];
  metadata: {
    totalResults: number;
    currentPage: number;
    pageSize: number;
    totalPages: number;
    elapsed: number;
  };
  rateLimit: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

interface LabelValue {
  value: string;
  label?: string;
}

interface FindingsFilters {
  keywords?: string;
  impact?: Array<"HIGH" | "MEDIUM" | "LOW" | "GAS">;
  firms?: LabelValue[];
  tags?: LabelValue[];
  protocol?: string;
  protocolCategory?: LabelValue[];
  forked?: LabelValue[];
  languages?: LabelValue[];
  user?: string;
  minFinders?: string;
  maxFinders?: string;
  reported?: {
    value: "30" | "60" | "90" | "after" | "alltime";
    label?: string;
  };
  reportedAfter?: string;
  qualityScore?: number;
  rarityScore?: number;
  sortField?: "Recency" | "Quality" | "Rarity";
  sortDirection?: "Desc" | "Asc";
}

interface FindingsRequest {
  page?: number;
  pageSize?: number;
  filters?: FindingsFilters;
}

const apiKey = process.env.SOLODIT_API_KEY || "";

if (!apiKey) {
  console.error("Warning: SOLODIT_API_KEY environment variable is not set");
}

async function makeRequest(
  endpoint: string,
  body: FindingsRequest
): Promise<FindingsResponse> {
  const response = await fetch(`${SOLODIT_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cyfrin-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  return (await response.json()) as FindingsResponse;
}

function formatFindingShort(f: SoloditFinding): string {
  const tags = f.issues_issuetagscore.map((t) => t.tags_tag.title).join(", ");
  return `### [${f.impact}] ${f.title}
    - Protocol: ${f.protocol_name ?? "N/A"}
    - Firm: ${f.firm_name ?? "N/A"}
    - Quality: ${f.quality_score}/5
    - Rarity: ${f.general_score}/5
    - Tags: ${tags || "N/A"}
    - Source: ${f.source_link ?? "N/A"}
  `;
  }

function formatFindingFull(finding: SoloditFinding): string {
  const tags = finding.issues_issuetagscore
    .map((t) => t.tags_tag.title)
    .join(", ");
  const finders = finding.issues_issue_finders
    .map((f) => f.wardens_warden.handle)
    .join(", ");

  return `## [${finding.impact}] ${finding.title}

      **ID:** ${finding.id}
      **Firm:** ${finding.firm_name || "N/A"}
      **Protocol:** ${finding.protocol_name || "N/A"}
      **Quality Score:** ${finding.quality_score}/5
      **Rarity Score:** ${finding.general_score}/5
      **Report Date:** ${finding.report_date || "N/A"}
      **Finders (${finding.finders_count}):** ${finders || "N/A"}
      **Tags:** ${tags || "N/A"}
      **Source:** ${finding.source_link || "N/A"}

      ### Content
      ${finding.content}

      ---`;
  }

function buildFilters(input: Partial<FindingsFilters>): FindingsFilters | undefined {
  const filters: FindingsFilters = {};

  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      // @ts-expect-error safe assignment
      filters[key] = value;
    }
  });

  return Object.keys(filters).length > 0 ? filters : undefined;
}

const server = new McpServer({
  name: "mcp-solodit-db",
  version: "1.0.0",
});

server.registerTool(
  "solodit_search_findings",
  {
    description: `Search for security audit findings in the Solodit database.
Supports filtering by keywords, impact level, audit firms, tags, protocols, languages, and more.
Returns paginated results with vulnerability details from smart contract audits across multiple platforms (Code4rena, Sherlock, Cyfrin, etc.).

Examples:
- High impact findings: use impact: ["HIGH"]
- Recent findings: use reported: "30" (or "60", "90") with sortField: "Recency"
- By vulnerability type: use tags: ["Reentrancy"] or other tag names
- By protocol: use protocol: "Uniswap" or other protocol name
- By audit firm: use firms: ["Cyfrin", "Sherlock"] or other firm names
- Raw JSON: use raw: true for programmatic processing`,
    inputSchema: z.object({
      keywords: z
        .string()
        .optional()
        .describe("Search keywords in title and content"),
      impact: z
        .array(z.enum(["HIGH", "MEDIUM", "LOW", "GAS"]))
        .optional()
        .describe("Filter by impact level (default: all)"),
      firms: z
        .array(z.string())
        .optional()
        .describe(
          'Filter by audit firm names (e.g., ["Cyfrin", "Sherlock", "Trail of Bits"])'
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          'Filter by vulnerability tags (e.g., ["Reentrancy", "Oracle", "Access Control"])'
        ),
      protocol: z
        .string()
        .optional()
        .describe("Filter by protocol name (partial match)"),
      protocolCategory: z
        .array(z.string())
        .optional()
        .describe(
          'Filter by protocol categories (e.g., ["DeFi", "NFT", "Lending", "DEX"])'
        ),
      languages: z
        .array(z.string())
        .optional()
        .describe(
          'Filter by programming languages (e.g., ["Solidity", "Rust", "Cairo"])'
        ),
      user: z
        .string()
        .optional()
        .describe("Filter by finder/auditor handle (partial match)"),
      reported: z
        .enum(["30", "60", "90", "alltime"])
        .optional()
        .describe("Filter by report date: 30/60/90 days or alltime (default: alltime)"),
      qualityScore: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe("Minimum quality score (0-5, default: 1)"),
      rarityScore: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe("Minimum rarity score (0-5, default: 1)"),
      sortField: z
        .enum(["Recency", "Quality", "Rarity"])
        .optional()
        .describe("Sort by field (default: Recency)"),
      sortDirection: z
        .enum(["Desc", "Asc"])
        .optional()
        .describe("Sort direction (default: Desc)"),
      page: z.number().min(1).default(1).describe("Page number (default: 1)"),
      pageSize: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Results per page (default: 20, max: 100)"),
      verbose: z
        .boolean()
        .optional()
        .default(false)
        .describe("Return full content for each finding (default: false, brief format)"),
      raw: z
        .boolean()
        .optional()
        .default(false)
        .describe("Return raw JSON response instead of formatted text (default: false)"),
    }),
  },
  async ({
    keywords,
    impact,
    firms,
    tags,
    protocol,
    protocolCategory,
    languages,
    user,
    reported,
    qualityScore,
    rarityScore,
    sortField,
    sortDirection,
    page,
    pageSize,
    verbose,
    raw,
  }) => {
    const requestBody: FindingsRequest = {
      page,
      pageSize,
      filters: buildFilters({
        keywords,
        impact,
        firms: firms?.map((f) => ({ value: f })),
        tags: tags?.map((t) => ({ value: t })),
        protocol,
        protocolCategory: protocolCategory?.map((c) => ({ value: c })),
        languages: languages?.map((l) => ({ value: l })),
        user,
        reported: reported ? { value: reported } : undefined,
        qualityScore,
        rarityScore,
        sortField,
        sortDirection,
      }),
    };

    const data = await makeRequest("/findings", requestBody);

    if (raw) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }

    const formatFn = verbose ? formatFindingFull : formatFindingShort;
    const formattedFindings = data.findings.map(formatFn).join("\n\n");

    const summary = `# Solodit Search Results

**Total Results:** ${data.metadata.totalResults}
**Page:** ${data.metadata.currentPage} of ${data.metadata.totalPages}
**Results on this page:** ${data.findings.length}
**Query Time:** ${data.metadata.elapsed.toFixed(3)}s
**Rate Limit:** ${data.rateLimit.remaining}/${data.rateLimit.limit} remaining

---

${formattedFindings}`;

    return {
      content: [
        {
          type: "text" as const,
          text: summary,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Solodit MCP Server running on stdio");
}

main().catch(console.error);
