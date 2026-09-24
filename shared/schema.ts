/**
 * The Beacon ontology: every object type, its properties, the links the UI
 * traverses, and the action names. The Postgres DDL, the server repository,
 * API validation, and the frontend's typed hooks all derive from this one
 * declaration — the role Foundry's Ontology Manager played in the original.
 */

export type PropType = "string" | "integer" | "double" | "boolean" | "timestamp" | "string[]";

export interface ObjectTypeDef {
  readonly apiName: string;
  readonly table: string;
  readonly primaryKey: string;
  readonly properties: Readonly<Record<string, PropType>>;
}

export const OBJECT_TYPES = {
  Firm: {
    apiName: "Firm",
    table: "firm",
    primaryKey: "firmId",
    properties: {
      firmId: "string",
      firmName: "string",
      source: "string",
      firmType: "string",
      hqCountry: "string",
      geography: "string",
      geographicFootprint: "string",
      geoScore: "integer",
      sector: "string",
      employees: "integer",
      employeeGroup: "string",
      firmAge: "integer",
      coverageModel: "string",
      servicesFit: "string",
      mdPedigree: "string",
      balanceSheetPrincipal: "string",
      dealSizeMUsd: "double",
      dealsPerMdL3y: "double",
      feeGeneratingCount: "integer",
      hasSTOrBalanceSheet: "boolean",
      advisoryConflict: "boolean",
      webActivity: "boolean",
      solvent: "boolean",
      lifecycleState: "string",
      currentStage: "string",
      currentStep: "string",
      disposition: "string",
      lastReviewed: "timestamp",
      scoreAtQualification: "double",
      tierAtQualification: "string",
      qualifiedAt: "timestamp",
      enrichedBy: "string",
      enrichedAt: "timestamp",
      outcome: "string",
      outcomeObservedAt: "timestamp",
      discoveredViaSearchId: "string",
    },
  },
  Mandate: {
    apiName: "Mandate",
    table: "mandate",
    primaryKey: "mandateId",
    properties: {
      mandateId: "string",
      title: "string",
      intentStatement: "string",
      archetype: "string",
      priority: "string",
      active: "boolean",
      createdAt: "timestamp",
      geographies: "string[]",
      industries: "string[]",
      products: "string[]",
      sizeMaxUsdM: "integer",
    },
  },
  Search: {
    apiName: "Search",
    table: "search",
    primaryKey: "searchId",
    properties: {
      searchId: "string",
      name: "string",
      mandateId: "string",
      geographies: "string[]",
      industries: "string[]",
      seedFirms: "string[]",
      exclusions: "string[]",
      breadth: "string",
      runAt: "timestamp",
      runBy: "string",
      status: "string",
      resultCount: "integer",
    },
  },
  SearchList: {
    apiName: "SearchList",
    table: "search_list",
    primaryKey: "searchId",
    properties: {
      searchId: "string",
      name: "string",
      mandateId: "string",
      filtersJson: "string",
      resultCount: "integer",
      requestedMore: "boolean",
      createdAt: "timestamp",
    },
  },
  SearchMembership: {
    apiName: "SearchMembership",
    table: "search_membership",
    primaryKey: "membershipId",
    properties: { membershipId: "string", searchId: "string", firmId: "string" },
  },
  ResearchFinding: {
    apiName: "ResearchFinding",
    table: "research_finding",
    primaryKey: "findingId",
    properties: {
      findingId: "string",
      firmId: "string",
      axis: "string",
      value: "string",
      normalizedScore: "integer",
      provider: "string",
      sourceType: "string",
      sourceUrl: "string",
      sourceExcerpt: "string",
      confidence: "double",
      confidenceTier: "string",
      findingStatus: "string",
      verifiedByHuman: "boolean",
      verifiedBy: "string",
      verifiedAt: "timestamp",
      conflictGroupId: "string",
      retrievedAt: "timestamp",
    },
  },
  QualificationScore: {
    apiName: "QualificationScore",
    table: "qualification_score",
    primaryKey: "scoreId",
    properties: {
      scoreId: "string",
      firmId: "string",
      model: "string",
      weightedTotal: "double",
      maxPossible: "double",
      pct: "double",
      tier: "string",
      confidence: "double",
      axisScoresJson: "string",
      thesisVersion: "string",
      rubricVersion: "string",
      computedBy: "string",
      computedAt: "timestamp",
    },
  },
  ReviewDecision: {
    apiName: "ReviewDecision",
    table: "review_decision",
    primaryKey: "decisionId",
    properties: {
      decisionId: "string",
      firmId: "string",
      decisionType: "string",
      rejectionRationale: "string",
      scoreAtDecision: "double",
      tierAtDecision: "string",
      analystCategorization: "string",
      fieldsEnteredManually: "string",
      agentValuesOverridden: "string",
      decidedBy: "string",
      decidedAt: "timestamp",
    },
  },
  DriftEvent: {
    apiName: "DriftEvent",
    table: "drift_event",
    primaryKey: "driftEventId",
    properties: {
      driftEventId: "string",
      firmId: "string",
      priorTier: "string",
      priorScore: "double",
      newTier: "string",
      newScore: "double",
      changedAxes: "string",
      driftReason: "string",
      driftStatus: "string",
      resolution: "string",
      resolvedAt: "timestamp",
      resolvedBy: "string",
      detectedAt: "timestamp",
    },
  },
  ProposedRule: {
    apiName: "ProposedRule",
    table: "proposed_rule",
    primaryKey: "proposedRuleId",
    properties: {
      proposedRuleId: "string",
      predicateAxis: "string",
      ruleOperator: "string",
      ruleThreshold: "string",
      ruleModel: "string",
      rationaleClusterSummary: "string",
      supportingFirmCount: "integer",
      supportingDecisionIds: "string",
      projectedScreenCount: "integer",
      ruleStatus: "string",
      ruleDecidedBy: "string",
      ruleDecidedAt: "timestamp",
      mandateScope: "string",
    },
  },
  HardScreenConfig: {
    apiName: "HardScreenConfig",
    table: "hard_screen_config",
    primaryKey: "configRuleId",
    properties: {
      configRuleId: "string",
      configAxis: "string",
      configOperator: "string",
      configThreshold: "string",
      configModel: "string",
      configVersion: "integer",
      configActive: "boolean",
      configAuthor: "string",
      configCreatedAt: "timestamp",
      sourceProposedRuleId: "string",
    },
  },
} as const satisfies Record<string, ObjectTypeDef>;

export type ObjectTypeName = keyof typeof OBJECT_TYPES;

type PropsOf<N extends ObjectTypeName> = (typeof OBJECT_TYPES)[N]["properties"];
type TsOf<P> = P extends "string" | "timestamp"
  ? string
  : P extends "integer" | "double"
    ? number
    : P extends "boolean"
      ? boolean
      : P extends "string[]"
        ? string[]
        : never;

/** Writable shape: every property optional; `null` clears a column. */
export type Props<N extends ObjectTypeName> = {
  -readonly [K in keyof PropsOf<N>]?: TsOf<PropsOf<N>[K]> | null;
};

/** Read shape as it crosses the wire: absent means null, plus identity fields. */
export type ObjectOf<N extends ObjectTypeName> = {
  -readonly [K in keyof PropsOf<N>]?: TsOf<PropsOf<N>[K]>;
} & { $apiName: N; $primaryKey: string };

export function isObjectTypeName(name: string): name is ObjectTypeName {
  return Object.prototype.hasOwnProperty.call(OBJECT_TYPES, name);
}

export interface LinkDef {
  source: ObjectTypeName;
  name: string;
  target: ObjectTypeName;
  joinTable: string;
  sourceColumn: string;
  targetColumn: string;
}

/** Only the links the UI traverses (useLinks calls in Home, MandatePage, Desk). */
export const LINKS: readonly LinkDef[] = [
  {
    source: "Search",
    name: "firms",
    target: "Firm",
    joinTable: "search_membership",
    sourceColumn: "searchId",
    targetColumn: "firmId",
  },
  {
    source: "SearchList",
    name: "firms",
    target: "Firm",
    joinTable: "search_list_firm",
    sourceColumn: "searchId",
    targetColumn: "firmId",
  },
];

export function findLink(source: string, name: string): LinkDef | undefined {
  return LINKS.find((l) => l.source === source && l.name === name);
}

export const ACTION_NAMES = [
  "runMandateSearch",
  "runSearch",
  "runAgentEnrichment",
  "enrichFirm",
  "verifyFinding",
  "resolveConflict",
  "qualifyFirm",
  "rejectFirm",
  "advanceStage",
  "setFirmOutcome",
  "reEngageFirm",
  "keepPassed",
  "clusterRejections",
  "approveRule",
  "dismissRule",
  "unapproveRule",
  "amendRuleThreshold",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export function isActionName(name: string): name is ActionName {
  return (ACTION_NAMES as readonly string[]).includes(name);
}
