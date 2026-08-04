export {
  marketDataSetSchema,
  barSchema,
  dividendSchema,
  splitSchema,
  fundamentalsSchema,
  identifiersSchema,
  currencySchema,
} from './schema/market-data'
export type { MarketDataSet, Bar, Dividend, Split, Fundamentals, Identifiers } from './schema/market-data'

export { ingestFile, parseOhlcvCsv, parseMarketDataJson, IngestError } from './ingest/index'
export type { IngestOptions } from './ingest/index'

export { checkMarketData } from './checker'
export { runRules, buildDataProfile } from './rules/engine'
export { registry } from './rules/registry'
export type { Rule, RuleMeta, RuleContext, CheckerConfig, RuleOverride } from './rules/types'

export { compareDatasets } from './compare/comparator'
export type { ComparisonReport } from './compare/comparator'
export { runCompareRules, buildCompareContext } from './compare/engine'
export { compareRegistry } from './compare/registry'
export type { CompareRule, CompareRuleMeta, CompareConfig } from './compare/types'

export {
  connectors,
  connectorStatus,
  getConnector,
  ConnectorError,
  yahoo,
  alphaVantage,
  parseYahooChart,
  parseAlphaVantageDaily,
} from './connectors/index'
export type { Connector, FetchOptions } from './connectors/index'

export { computeSanityScore, summarize, SEVERITY_PENALTY } from './scoring/score'

export { renderCheckHtml, renderCompareHtml } from './report/html'

export {
  appendHistory,
  readHistory,
  formatHistory,
  historyEntryFromReport,
  DEFAULT_HISTORY_DIR,
} from './history/store'
export type { HistoryEntry } from './history/store'

export { loadConfig, ConfigError } from './config'
export type { MdscConfig } from './config'

export { SEVERITY_ORDER } from './report/types'
export type {
  Finding,
  SanityReport,
  Severity,
  RecommendedAction,
  QualityDimension,
} from './report/types'
