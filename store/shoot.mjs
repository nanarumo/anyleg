// Renders the App Store icon and 6.7" iPhone screenshots with headless Edge over CDP (no extra deps).
// Needs `npm run dev` running. Run: node store/shoot.mjs
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const APP = process.env.APP ?? 'http://localhost:5173'
const dir = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${tmpdir()}/anyleg-shoot`, '--hide-scrollbars', 'about:blank'])
let ws
for (let i = 0; i < 40 && !ws; i++) {
  await sleep(250)
  try { const t = await (await fetch('http://127.0.0.1:9333/json')).json(); ws = t.find(x => x.type === 'page')?.webSocketDebuggerUrl } catch {}
}
const sock = new WebSocket(ws)
await new Promise(r => sock.addEventListener('open', r))
let n = 0
const pending = new Map()
sock.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
const cdp = (method, params = {}) => new Promise(r => { const id = ++n; pending.set(id, r); sock.send(JSON.stringify({ id, method, params })) })
const js = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true })).result?.result?.value
const shot = async (name, w, h) => {
  const { result } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
  writeFileSync(`${dir}${name}.png`, Buffer.from(result.data, 'base64'))
  console.log('saved', name)
}
const click = text => js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith(${JSON.stringify(text)})); b?.click(); return !!b })()`)

// Icon: 1024x1024, full-bleed, no transparency (Apple rounds the corners itself).
await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: pathToFileURL(`${dir}icon-1024.svg`).href })
await sleep(800)
await shot('icon-1024', 1024, 1024)

// Screenshots: 430x932 at 3x = 1290x2796 (6.7"/6.9" iPhone).
await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true })
// ESPN returns no games to the default HeadlessEdg user agent.
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
await cdp('Page.navigate', { url: APP })
await sleep(1000)
await js(`localStorage.clear(); localStorage.setItem('anyleg-age-ok', '1');
  localStorage.setItem('anyleg-accounts', JSON.stringify({ current: 'demo', list: [{ id: 'demo', name: 'ParlayKing', avatar: '🦈', color: '#8b5cf6', createdAt: Date.now() }] }));
  localStorage.setItem('anyleg-state-demo', JSON.stringify({ balance: 1000, lastBonus: Date.now() }))`)
await cdp('Page.reload')
for (let i = 0; i < 40 && !(await js(`/[1-9]\\d* games/.test(document.body.innerText)`)); i++) await sleep(500) // wait for live lines
await sleep(1500)

const W = 430, H = 932
await shot('1-sportsbook', W, H)
// Mixed parlay: two sports prices, then open the slip.
await js(`(() => { const odds = [...document.querySelectorAll('main button')].filter(b => /^[+-]\\d{3}$/.test(b.textContent.trim().split('\\n').pop()) || /[+-]\\d{3}$/.test(b.textContent.trim())); odds[2]?.click(); odds[9]?.click(); return odds.length })()`)
await sleep(400)
await click('Swipe'); await sleep(1500)
await shot('2-swipe', W, H)
await click('Casino'); await sleep(1000)
await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Win next hand'))?.click()`) // casino leg joins the parlay
await sleep(400)
await shot('3-casino', W, H)
await js(`document.querySelector('.tile.blackjack')?.click()`)
await sleep(1500)
await shot('4-blackjack', W, H)
await click('Sportsbook'); await sleep(800)
await js(`[...document.querySelectorAll('button')].find(b => /Leg Parlay/.test(b.textContent))?.click()`)
await sleep(1000)
await shot('5-bet-slip', W, H)

sock.close(); edge.kill()
