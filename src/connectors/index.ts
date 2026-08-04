import { ConnectorError, type Connector } from './types'
import { yahoo } from './yahoo'
import { alphaVantage } from './alphavantage'

export { ConnectorError }
export type { Connector, FetchOptions } from './types'
export { yahoo, parseYahooChart } from './yahoo'
export { alphaVantage, parseAlphaVantageDaily } from './alphavantage'

/** The connector registry: provider name → connector. */
export const connectors: Record<string, Connector> = {
  yahoo,
  'alpha-vantage': alphaVantage,
}

/** Lists provider names with whether they are usable right now. */
export function connectorStatus(): Array<{ name: string; available: boolean; requires: string }> {
  return Object.values(connectors).map((connector) => ({
    name: connector.name,
    available: connector.available(),
    requires: connector.requires,
  }))
}

/** Resolves a connector by name or throws with the catalog of options. */
export function getConnector(name: string): Connector {
  const connector = connectors[name.toLowerCase()]
  if (!connector) {
    const known = Object.keys(connectors).join(', ')
    throw new ConnectorError(`Unknown provider "${name}". Available providers: ${known}`)
  }
  if (!connector.available()) {
    throw new ConnectorError(`Provider "${name}" is not available: it requires ${connector.requires}`)
  }
  return connector
}
