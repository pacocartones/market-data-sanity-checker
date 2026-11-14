import process from 'node:process'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { automationContext, assertCurrentMain, githubRequest, reportFailure, REPOSITORY } from './check-automation-context.mjs'
import { FILES, loadArtifact } from './scoreboard-artifact.mjs'

const PREFIX = '/repos/' + REPOSITORY
const BOT = 'refs/heads/bot/scoreboard'
const leaseMutation = 'mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }'
function requireThat(ok) { if (!ok) throw new Error('automation: publication rejected') }
function sha(value) { requireThat(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)); return value }
function gitBlob(bytes) { return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') }

export async function publish(bundle,digest,env=process.env,request) {
  // Do not fall back to GH_TOKEN/GITHUB_TOKEN or a PAT on any error path.
  requireThat(typeof env.SCOREBOARD_APP_TOKEN==='string' && env.SCOREBOARD_APP_TOKEN.length>0 &&
    /^[a-z0-9][a-z0-9-]{0,99}$/.test(env.SCOREBOARD_APP_SLUG??''))
  const context=automationContext('scoreboard',env)
  const {files}=await loadArtifact(bundle,env,digest)
  const api=request??githubRequest(env.SCOREBOARD_APP_TOKEN)
  await assertCurrentMain(context,api)
  const base=await api('GET',PREFIX+'/git/commits/'+context.sha)
  const baseTree=sha(base?.tree?.sha)
  const tree=await api('GET',PREFIX+'/git/trees/'+baseTree+'?recursive=1')
  requireThat(tree?.truncated===false && Array.isArray(tree.tree))
  const hashes=FILES.map(name=>{
    const item=tree.tree.find(x=>x.path==='scoreboard/'+name)
    requireThat(item?.type==='blob' && item.mode==='100644')
    return {name,current:sha(item.sha),next:gitBlob(files[name])}
  })
  if(hashes.every(x=>x.current===x.next)) return {changed:false}
  const previous=await api('GET',PREFIX+'/git/ref/heads/bot/scoreboard',undefined,true)
  const before=previous===null?null:sha(previous?.object?.sha)
  const repo=await api('GET',PREFIX)
  requireThat(typeof repo?.node_id==='string' && repo.node_id.length>0 && repo.node_id.length<=256)
  const botLogin=env.SCOREBOARD_APP_SLUG+'[bot]'
  const botUser=await api('GET','/users/'+encodeURIComponent(botLogin))
  requireThat(botUser?.login===botLogin && Number.isSafeInteger(botUser.id) && botUser.id>0)
  const author={name:botLogin,email:botUser.id+'+'+botLogin+'@users.noreply.github.com'}
  const entries=[]
  for(const {name,next}of hashes) {
    const blob=await api('POST',PREFIX+'/git/blobs',{content:files[name].toString('base64'),encoding:'base64'})
    requireThat(blob?.sha===next)
    entries.push({path:'scoreboard/'+name,mode:'100644',type:'blob',sha:next})
  }
  const nextTree=await api('POST',PREFIX+'/git/trees',{base_tree:baseTree,tree:entries})
  const commit=await api('POST',PREFIX+'/git/commits',{
    message:'chore(scoreboard): weekly provider audit',tree:sha(nextTree?.sha),parents:[context.sha],author,committer:author,
  })
  const commitSha=sha(commit?.sha)
  // A main change aborts before the ref update; the two refs are not one atomic transaction.
  await assertCurrentMain(context,api)
  if(before===null) {
    const created=await api('POST',PREFIX+'/git/refs',{ref:BOT,sha:commitSha})
    requireThat(created?.object?.sha===commitSha)
  } else {
    const updated=await api('POST','/graphql',{query:leaseMutation,variables:{input:{
      repositoryId:repo.node_id,refUpdates:[{name:BOT,beforeOid:before,afterOid:commitSha,force:true}],clientMutationId:'scoreboard',
    }}})
    requireThat(updated?.data?.updateRefs?.clientMutationId==='scoreboard')
  }
  const pullPath=PREFIX+'/pulls?state=open&head='+encodeURIComponent('pacocartones:bot/scoreboard')+'&base=main&per_page=10'
  const pulls=await api('GET',pullPath)
  requireThat(Array.isArray(pulls))
  let pull=pulls.find(p=>p.head?.ref==='bot/scoreboard'&&p.head?.repo?.full_name===REPOSITORY&&p.base?.ref==='main')
  if(!pull) pull=await api('POST',PREFIX+'/pulls',{
    base:'main',head:'bot/scoreboard',title:'chore(scoreboard): weekly provider audit',
    body:'Weekly provider audit from a validated data-only artifact. Review the pull request and required checks before merging.',
  })
  requireThat(typeof pull?.html_url==='string' && /^https:\/\/github\.com\/pacocartones\/market-data-sanity-checker\/pull\/[1-9][0-9]*$/.test(pull.html_url))
  return {changed:true,commit:commitSha,pr:pull.html_url}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==3) throw new Error('automation: rejected arguments')
    console.log(JSON.stringify(await publish(process.argv[2],process.env.SCOREBOARD_PAYLOAD_SHA256,process.env)))
  } catch(error) { reportFailure(error) }
}
