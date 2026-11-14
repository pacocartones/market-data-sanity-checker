import process from 'node:process'
import console from 'node:console'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'pacocartones/market-data-sanity-checker'
export function automationContext(kind, env = process.env) {
  const events = kind === 'docs' ? ['push', 'workflow_dispatch'] : kind === 'scoreboard' ? ['schedule', 'workflow_dispatch'] : []
  const flag = kind === 'docs' ? env.DOCS_AUTOMATION_READY : env.SCOREBOARD_AUTOMATION_READY
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' ||
      !events.includes(env.GITHUB_EVENT_NAME) || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') || flag !== 'true' ||
      (kind === 'scoreboard' && !/^[A-Za-z0-9._-]{1,128}$/.test(env.SCOREBOARD_APP_CLIENT_ID ?? ''))) {
    throw new Error('automation: rejected context or activation is pending')
  }
  return { repository: REPOSITORY, sha: env.GITHUB_SHA }
}

// Credentials are explicit. There is no ambient-token fallback or arbitrary host.
export function githubRequest(token) {
  if (!token) throw new Error('automation: rejected missing credential')
  return async (method, path, body, allowNotFound = false) => {
    if (!['GET', 'POST'].includes(method) ||
        !(path.startsWith('/repos/' + REPOSITORY + '/') || path === '/graphql' ||
          (method === 'GET' && path === '/repos/' + REPOSITORY) ||
          (method === 'GET' && /^\/users\/[a-z0-9-]+%5Bbot%5D$/i.test(path)))) {
      throw new Error('automation: rejected API target')
    }
    const response = await globalThis.fetch('https://api.github.com' + path, {
      method, redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (allowNotFound && response.status === 404) return null
    if (!response.ok) throw new Error('automation: GitHub request failed (' + response.status + ')')
    const data = await response.json()
    if (path === '/graphql' && data.errors?.length) throw new Error('automation: ref update rejected')
    return data
  }
}
export async function assertCurrentMain(context, request) {
  const ref = await request('GET', '/repos/' + REPOSITORY + '/git/ref/heads/main')
  if (ref?.object?.sha !== context.sha) throw new Error('automation: main advanced; start a new run')
}
export function reportFailure(error) {
  const message = error instanceof Error ? error.message : 'automation failed'
  console.error('automation: ' + JSON.stringify(message).replaceAll('#', '\\u0023'))
  process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--check-main')) throw new Error('automation: rejected arguments')
    const context = automationContext(process.argv[2])
    if (process.argv[3]) await assertCurrentMain(context, githubRequest(process.env.GH_TOKEN))
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'sha=' + context.sha + '\n')
    console.log(JSON.stringify(context))
  } catch (error) { reportFailure(error) }
}
