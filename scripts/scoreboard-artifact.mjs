import process from 'node:process'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { appendFile, lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { renderScoreboardReadme } from '../src/scoreboard/readme.ts'
import { automationContext, githubRequest, reportFailure } from './check-automation-context.mjs'

export const MAX_PAYLOAD = 3 * 1024 * 1024
export const FILES = ['README.md', 'datapackage.json', 'latest.csv', 'latest.json']
const LIMITS = { 'README.md': 262144, 'datapackage.json': 32768, 'latest.csv': 262144, 'latest.json': 1048576 }
// Trusted automation profile, also pinned in scoreboard.yml; never read caps from the payload.
const ATTEMPTS = { yahoo: 30, 'alpha-vantage': 25 }
const HEADER = 'generated_at,provider,symbol,sanity_score,critical,warning,info,rules'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
function requireThat(ok) { if (!ok) throw new Error('automation: rejected scoreboard data or provenance') }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exact(value, keys) { requireThat(record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) }
function integer(value, max = 1000000) { requireThat(Number.isInteger(value) && value >= 0 && value <= max) }
function score(value) { requireThat(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) }
function rule(value) { requireThat(typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value)) }
function provenance(env) {
  const context = automationContext('scoreboard', env)
  requireThat(/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '') && /^[1-9][0-9]{0,9}$/.test(env.GITHUB_RUN_ATTEMPT ?? '') &&
    /^[1-9][0-9]{0,19}$/.test(env.GITHUB_REPOSITORY_ID ?? ''))
  return { ...context, repositoryId: env.GITHUB_REPOSITORY_ID, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }
}
export function payloadName(context) { return 'scoreboard-' + context.runId + '-' + context.runAttempt + '.json' }
async function regularFile(path, limit) {
  const before = await lstat(path)
  requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= limit)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    requireThat(stat.isFile() && stat.nlink === 1 && stat.size <= limit && stat.ino === before.ino)
    const bytes = await handle.readFile()
    requireThat(bytes.length <= limit)
    return bytes
  } finally { await handle.close() }
}
async function directory(path, names) {
  const stat = await lstat(path)
  requireThat(stat.isDirectory() && !stat.isSymbolicLink())
  requireThat(isDeepStrictEqual((await readdir(path)).sort(), [...names].sort()))
}
function descriptor(created) {
  return { profile: 'tabular-data-package', name: 'market-data-provider-scoreboard',
    title: 'Market Data Provider Scoreboard', description: 'weekly audit of market data providers with mdsc sanity scores',
    homepage: 'https://github.com/pacocartones/market-data-sanity-checker', created,
    resources: [{ name: 'scoreboard', path: 'latest.csv', profile: 'tabular-data-resource',
      schema: { fields: ['generated_at', 'provider', 'symbol', 'sanity_score', 'critical', 'warning', 'info', 'rules'].map((name, index) => ({
        name, type: index === 0 ? 'datetime' : index >= 3 && index <= 6 ? 'integer' : 'string',
      })) } }] }
}
export function validateData(files) {
  const data = JSON.parse(files['latest.json'].toString('utf8'))
  exact(data, ['generated_at', 'basket', 'range', 'providers', 'excluded', 'comparisons'])
  requireThat(typeof data.generated_at === 'string' && new Date(data.generated_at).toISOString() === data.generated_at && data.range === '1y')
  requireThat(Array.isArray(data.basket) && data.basket.length === 30 && new Set(data.basket).size === 30)
  // This is the producer's fixed basket, not an allowlist supplied by the artifact.
  const expectedBasket = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','JPM','V','KO','PG','JNJ','XOM','WMT','BRK-B','GE','CAT','BA','HON','SPY','QQQ','IWM','DIA','VTI','GLD','TLT','EEM','ARKK','NFLX']
  requireThat(isDeepStrictEqual(data.basket, expectedBasket))
  const providers = new Set()
  requireThat(Array.isArray(data.providers) && data.providers.length > 0 && data.providers.length <= 2)
  for (const p of data.providers) {
    exact(p, ['provider','symbols_ok','symbols_failed','symbols_skipped','mean_score','min_score','worst_symbols','total_findings'])
    requireThat(['yahoo','alpha-vantage'].includes(p.provider) && !providers.has(p.provider))
    providers.add(p.provider)
    for (const count of [p.symbols_ok,p.symbols_failed,p.symbols_skipped]) integer(count,30)
    requireThat(p.symbols_ok > 0 && p.symbols_ok + p.symbols_failed + p.symbols_skipped === 30 &&
      p.symbols_skipped === 30 - ATTEMPTS[p.provider] &&
      p.symbols_failed / ATTEMPTS[p.provider] <= 0.2)
    score(p.mean_score); score(p.min_score); integer(p.min_score,100)
    exact(p.total_findings, ['critical','warning','info'])
    for (const count of Object.values(p.total_findings)) integer(count)
    requireThat(Array.isArray(p.worst_symbols) && p.worst_symbols.length === Math.min(5,p.symbols_ok))
    for (const item of p.worst_symbols) {
      exact(item,['symbol','score','rules'])
      requireThat(data.basket.includes(item.symbol) && Array.isArray(item.rules) && item.rules.length <= 10000)
      integer(item.score,100); item.rules.forEach(rule)
    }
  }
  requireThat(Array.isArray(data.excluded) && data.excluded.length <= 1)
  const excluded = new Set()
  for (const item of data.excluded) {
    exact(item,['provider','failed'])
    requireThat(['yahoo','alpha-vantage'].includes(item.provider) && !providers.has(item.provider) && !excluded.has(item.provider))
    excluded.add(item.provider); integer(item.failed,ATTEMPTS[item.provider])
    requireThat(item.failed / ATTEMPTS[item.provider] > 0.2)
  }
  requireThat(providers.size + excluded.size === 2)
  const csv = files['latest.csv'].toString('utf8')
  requireThat(csv.endsWith('\n') && !csv.includes('\r'))
  const lines = csv.slice(0,-1).split('\n')
  requireThat(lines.shift() === HEADER && lines.length === data.providers.length * 30)
  const rows = lines.map(line => {
    const cells = line.split(',')
    requireThat(cells.length === 8)
    const [date,provider,symbol,rawScore,critical,warning,info,rules] = cells
    requireThat(date === data.generated_at && providers.has(provider) && data.basket.includes(symbol))
    if (rules === 'FETCH_FAILED' || rules === 'SKIPPED_DAILY_CAP') {
      requireThat([rawScore,critical,warning,info].every(x=>x===''))
      return { provider,symbol,score:null,summary:null,rules,kind:rules }
    }
    const numbers = [rawScore,critical,warning,info]
    requireThat(numbers.every(x=>/^(0|[1-9][0-9]{0,6})$/.test(x)))
    const [value,c,w,i] = numbers.map(Number)
    integer(value,100); [c,w,i].forEach(x=>integer(x))
    const ids = rules ? rules.split(';') : []
    ids.forEach(rule); requireThat(ids.length <= 10000 && ids.length === c + w + i)
    return { provider,symbol,score:value,summary:{critical:c,warning:w,info:i},rules,kind:'ok' }
  })
  const seen = new Set()
  for (const row of rows) { const id=row.provider+':'+row.symbol; requireThat(!seen.has(id)); seen.add(id) }
  const skipped = []
  const canonicalRows = []
  for (const p of data.providers) {
    const own = rows.filter(r=>r.provider===p.provider)
    const good = own.filter(r=>r.kind==='ok')
    const failed = own.filter(r=>r.kind==='FETCH_FAILED')
    const omitted = own.filter(r=>r.kind==='SKIPPED_DAILY_CAP')
    requireThat(good.length===p.symbols_ok && failed.length===p.symbols_failed && omitted.length===p.symbols_skipped)
    const ordered = group => [...group].sort((a,b)=>data.basket.indexOf(a.symbol)-data.basket.indexOf(b.symbol))
    requireThat(isDeepStrictEqual(ordered(omitted).map(r=>r.symbol), data.basket.slice(ATTEMPTS[p.provider])))
    canonicalRows.push(...ordered(good),...ordered(failed),...ordered(omitted))
    if(omitted.length) skipped.push({provider:p.provider,symbols:ordered(omitted).map(r=>r.symbol)})
    const scores=good.map(r=>r.score)
    requireThat(p.mean_score===Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)) && p.min_score===Math.min(...scores))
    for(const severity of ['critical','warning','info']) requireThat(p.total_findings[severity]===good.reduce((sum,r)=>sum+r.summary[severity],0))
    const worst=ordered(good).sort((a,b)=>a.score-b.score).slice(0,5).map(r=>({symbol:r.symbol,score:r.score,rules:r.rules?r.rules.split(';'):[]}))
    requireThat(isDeepStrictEqual(p.worst_symbols,worst))
  }
  requireThat(isDeepStrictEqual(rows,canonicalRows))
  requireThat(Array.isArray(data.comparisons) && data.comparisons.length <= 30 && (data.providers.length>1 || data.comparisons.length===0))
  const compared = new Set()
  for(const item of data.comparisons) {
    exact(item,['symbol','consistency_score','compared_dates','findings'])
    requireThat(data.basket.includes(item.symbol) && !compared.has(item.symbol))
    compared.add(item.symbol); score(item.consistency_score); integer(item.compared_dates,100000)
    requireThat(data.providers.every(p=>rows.some(r=>r.provider===p.provider&&r.symbol===item.symbol&&r.kind==='ok')))
    requireThat(Array.isArray(item.findings) && item.findings.length <= 10000)
    for(const finding of item.findings) {
      exact(finding, finding.where===undefined?['rule','severity']:['rule','severity','where'])
      rule(finding.rule); requireThat(['critical','warning','info'].includes(finding.severity))
      if(finding.where!==undefined) {
        requireThat(record(finding.where) && Object.keys(finding.where).length<=20)
        for(const [key,value]of Object.entries(finding.where)) {
          requireThat(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key))
          requireThat(typeof value==='number'?Number.isFinite(value)&&Math.abs(value)<=1e12:
            typeof value==='string'&&/^[A-Za-z0-9_.:+ -]{0,128}$/.test(value))
        }
        if(finding.where.date!==undefined) requireThat(typeof finding.where.date==='string' && /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+Z-]+)?$/.test(finding.where.date))
      }
    }
  }
  const expectedReadme=renderScoreboardReadme({generatedAt:data.generated_at,basketSize:30,providers:data.providers,excluded:data.excluded,skipped,comparisons:data.comparisons})
  requireThat(files['README.md'].toString('utf8')===expectedReadme)
  requireThat(isDeepStrictEqual(JSON.parse(files['datapackage.json'].toString('utf8')),descriptor(data.generated_at)))
  return data
}
export async function pack(source,target,env=process.env) {
  const context=provenance(env)
  await directory(source,FILES)
  const files={}
  for(const name of FILES) files[name]=await regularFile(join(source,name),LIMITS[name])
  validateData(files)
  const manifest={version:1,...context,files:FILES.map(name=>({name,size:files[name].length,sha256:sha256(files[name])}))}
  const payload=Buffer.from(JSON.stringify({manifest,contents:Object.fromEntries(FILES.map(name=>[name,files[name].toString('base64')]))}))
  requireThat(payload.length<=MAX_PAYLOAD)
  await mkdir(target)
  await writeFile(join(target,payloadName(context)),payload,{flag:'wx'})
  return {payloadSha256:sha256(payload)}
}
export async function loadArtifact(target,env,expectedDigest) {
  const context=provenance(env)
  requireThat(/^[0-9a-f]{64}$/.test(expectedDigest??''))
  await directory(target,[payloadName(context)])
  const payload=await regularFile(join(target,payloadName(context)),MAX_PAYLOAD)
  requireThat(sha256(payload)===expectedDigest)
  const envelope=JSON.parse(payload.toString('utf8'))
  exact(envelope,['manifest','contents'])
  const m=envelope.manifest
  exact(m,['version','repository','repositoryId','sha','runId','runAttempt','files'])
  requireThat(m.version===1 && ['repository','repositoryId','sha','runId','runAttempt'].every(key=>m[key]===context[key]))
  exact(envelope.contents,FILES)
  requireThat(Array.isArray(m.files)&&m.files.length===FILES.length)
  const files={}
  for(const [index,name]of FILES.entries()) {
    const entry=m.files[index]
    exact(entry,['name','size','sha256'])
    requireThat(entry.name===name && Number.isInteger(entry.size) && entry.size>=0 && entry.size<=LIMITS[name] &&
      /^[0-9a-f]{64}$/.test(entry.sha256) && typeof envelope.contents[name]==='string' &&
      envelope.contents[name].length<=Math.ceil(LIMITS[name]/3)*4)
    const bytes=Buffer.from(envelope.contents[name],'base64')
    requireThat(bytes.toString('base64')===envelope.contents[name] && bytes.length===entry.size && sha256(bytes)===entry.sha256)
    files[name]=bytes
  }
  validateData(files)
  return {context,files}
}
export async function checkArtifactMetadata(id,env,digest,request) {
  const context=provenance(env)
  requireThat(/^[1-9][0-9]{0,19}$/.test(id??'') && /^[0-9a-f]{64}$/.test(digest??''))
  const artifact=await request('GET','/repos/'+context.repository+'/actions/artifacts/'+id)
  requireThat(String(artifact.id)===id && artifact.name===payloadName(context) && artifact.expired===false &&
    Number.isInteger(artifact.size_in_bytes)&&artifact.size_in_bytes>0&&artifact.size_in_bytes<=MAX_PAYLOAD &&
    String(artifact.workflow_run?.id)===context.runId && artifact.workflow_run?.head_sha===context.sha &&
    String(artifact.workflow_run?.repository_id)===context.repositoryId &&
    String(artifact.workflow_run?.head_repository_id)===context.repositoryId && artifact.workflow_run?.head_branch==='main' &&
    artifact.digest==='sha256:'+digest)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [mode,source,target]=process.argv.slice(2)
    let result
    if(mode==='pack') result=await pack(source,target,process.env)
    else if(mode==='validate') result=await loadArtifact(source,process.env,process.env.SCOREBOARD_PAYLOAD_SHA256)
    else if(mode==='check-artifact') { await checkArtifactMetadata(process.env.SCOREBOARD_ARTIFACT_ID,process.env,process.env.SCOREBOARD_PAYLOAD_SHA256,githubRequest(process.env.GH_TOKEN)); result={checked:true} }
    else throw new Error('automation: rejected arguments')
    if(mode==='pack'&&process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,'payload-sha256='+result.payloadSha256+'\n')
    console.log(JSON.stringify(mode==='validate'?{valid:true}:result))
  } catch(error) { reportFailure(error) }
}
