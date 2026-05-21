import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, 'public')
const sitePath = path.join(root, 'data', 'site.json')
const port = Number(process.env.PORT || 8799)
const host = process.env.HOST || '127.0.0.1'

function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function readSite() {
  const site = JSON.parse(await readFile(sitePath, 'utf8'))
  site.actions ||= []
  site.decisions ||= []
  return site
}

async function saveSite(site) {
  await writeFile(sitePath, JSON.stringify(site, null, 2) + '\n')
}

async function bodyJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function refreshCommand(input) {
  const title = String(input.title || input.objectId || 'docs section')
  const files = Array.isArray(input.linkedFiles) ? input.linkedFiles.map(String).filter(Boolean) : []
  if (!files.length) return 'kdex status --json'
  const fileList = files.slice(0, 8).join(', ')
  const task = JSON.stringify('refresh docs for ' + title + ' using ' + fileList)
  const prompt = JSON.stringify("Update the KDEX docs section '" + title + "'. Use these source files as evidence: " + fileList + '. Keep it human-readable, preserve source links, and rehash after human review.')
  return 'kdex context ' + task + ' --limit 8 | claude -p ' + prompt
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/site' && req.method === 'GET') return send(res, 200, await readSite())
    if (url.pathname === '/api/decision' && req.method === 'POST') {
      const site = await readSite()
      const input = await bodyJson(req)
      const now = new Date().toISOString()
      const objectId = String(input.objectId || '')
      let decision = site.decisions.find((entry) => entry.objectId === objectId)
      if (!decision) {
        decision = { id: 'decision-' + objectId, objectId, status: 'review', decision: 'needs-review', reason: '', updatedAt: now }
        site.decisions.push(decision)
      }
      decision.status = input.status || decision.status
      decision.decision = input.decision || decision.decision
      decision.reason = input.reason || decision.reason
      decision.updatedAt = now
      if (decision.status === 'refresh' || decision.decision === 'refresh') {
        const actionId = 'action-refresh-' + objectId
        let action = site.actions.find((entry) => entry.id === actionId)
        const title = 'refresh ' + String(input.title || objectId)
        const command = refreshCommand(input)
        if (!action) {
          action = { id: actionId, kind: 'refresh', objectId, title, status: 'queued', command, reason: decision.reason, createdAt: now, updatedAt: now }
          site.actions.push(action)
        } else {
          Object.assign(action, { title, status: 'queued', command, reason: decision.reason, updatedAt: now })
        }
      }
      await saveSite(site)
      return send(res, 200, site)
    }

    const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname
    const file = path.normalize(path.join(publicDir, cleanPath))
    if (!file.startsWith(publicDir) || !existsSync(file)) return send(res, 404, 'not found', 'text/plain')
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}).listen(port, host, () => {
  console.log('kdex docs ui running at http://' + host + ':' + port)
})
