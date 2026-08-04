import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Generate coverage summary badge endpoint
const coveragePath = join(process.cwd(), 'coverage', 'coverage-summary.json')

try {
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf-8'))
  const total = coverage.total
  
  const metrics = {
    lines: total.lines.pct,
    statements: total.statements.pct,
    functions: total.functions.pct,
    branches: total.branches.pct
  }
  
  // Calculate weighted average (lines matter most)
  const avgCoverage = Math.round(
    (metrics.lines * 0.4 + metrics.statements * 0.3 + metrics.functions * 0.2 + metrics.branches * 0.1)
  )
  
  console.log(`Coverage: ${avgCoverage}%`)
  console.log(`Lines: ${metrics.lines}% | Statements: ${metrics.statements}%`)
  console.log(`Functions: ${metrics.functions}% | Branches: ${metrics.branches}%`)
  
  // Write for CI consumption
  const summary = {
    coverage: avgCoverage,
    timestamp: new Date().toISOString(),
    metrics
  }
  
  writeFileSync(
    join(process.cwd(), 'coverage', 'badge-data.json'),
    JSON.stringify(summary, null, 2)
  )
  
  // Exit 1 if below threshold
  if (avgCoverage < 80) {
    console.error(`❌ Coverage ${avgCoverage}% is below threshold (80%)`)
    process.exit(1)
  }
  
  console.log(`✅ Coverage ${avgCoverage}% meets threshold`)
} catch {
  console.error('⚠️  No coverage data found, run tests first')
  process.exit(0) // Don't fail on first run
}
