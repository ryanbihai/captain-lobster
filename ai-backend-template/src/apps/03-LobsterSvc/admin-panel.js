/**
 * @file admin-panel.js
 * @description L1 管理员面板 — 轻量 HTTP 服务，仅监听 127.0.0.1:17020
 *
 * 提供：
 * 1. HTML 仪表盘（自动刷新，实时指标）
 * 2. JSON API（/api/stats）
 */

const http = require('http')
const mongoose = require('mongoose')

const ADMIN_PORT = parseInt(process.env.L1_ADMIN_PORT) || 17020

class AdminPanel {
  constructor(l1Service) {
    this.l1 = l1Service
    this.startTime = Date.now()
  }

  // ── 数据采集 ──────────────────────────────────────────────

  async collectStats() {
    const now = Date.now()
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const [players, contracts, trades24h, todayTrades] = await Promise.all([
      mongoose.model('Player').find({ deleted: { $ne: true } }).lean(),
      mongoose.model('Contract').find({ status: 'pending' }).lean(),
      mongoose.model('Trade').countDocuments({ createdAt: { $gte: dayAgo } }),
      mongoose.model('Trade').find({ createdAt: { $gte: todayStart } }).lean()
    ])

    const docked = players.filter(p => p.status === 'docked')
    const sailing = players.filter(p => p.status === 'sailing')
    const active24h = players.filter(p => p.lastActionAt && new Date(p.lastActionAt) >= dayAgo)

    let totalGold = 0
    for (const p of players) totalGold += p.gold || 0

    // 城市分布
    const cityDist = {}
    for (const p of players) {
      const c = p.currentCity || 'unknown'
      cityDist[c] = (cityDist[c] || 0) + 1
    }

    // 商品持有量
    const cargoTotal = {}
    for (const p of players) {
      const cargo = p.cargo || {}
      for (const [item, qty] of Object.entries(cargo)) {
        if (qty && qty > 0) cargoTotal[item] = (cargoTotal[item] || 0) + qty
      }
    }

    // 今日交易统计
    let todayTradeGold = 0
    let todayBuyCount = 0
    let todaySellCount = 0
    const itemVolumes = {}
    for (const t of todayTrades || []) {
      todayTradeGold += t.totalPrice || 0
      if (t.tradeType === 'buy') todayBuyCount++
      else todaySellCount++
      const item = t.item || 'unknown'
      itemVolumes[item] = (itemVolumes[item] || 0) + (t.amount || 0)
    }

    // 情报统计
    let activeIntelCount = 0
    const intelTypes = {}
    for (const p of players) {
      const intels = p.intels || []
      for (const i of intels) {
        if (i.status === 'active') {
          activeIntelCount++
          intelTypes[i.type] = (intelTypes[i.type] || 0) + 1
        }
      }
    }

    return {
      service: {
        uptime: Math.floor((now - this.startTime) / 1000),
        pid: process.pid,
        nodeVersion: process.version,
        memoryMB: Math.round(process.memoryUsage().rss / 1048576),
        oceanBusReady: !!(this.l1.oceanbus && this.l1.myOpenid),
        mongoReady: mongoose.connection.readyState === 1,
        lastSeq: this.l1.lastSeq || 0,
        reqCount: (this.l1._stats || {}).reqCount || 0,
        errCount: (this.l1._stats || {}).errCount || 0,
        lastMsgSec: (this.l1._stats || {}).lastMsgTime ? Math.floor((now - (this.l1._stats || {}).lastMsgTime) / 1000) : null
      },
      players: {
        total: players.length,
        active24h: active24h.length,
        docked: docked.length,
        sailing: sailing.length,
        newToday: players.filter(p => p.createDate && new Date(p.createDate) >= todayStart).length,
        totalGold,
        avgGold: players.length ? Math.round(totalGold / players.length) : 0,
        topGold: players.sort((a, b) => (b.gold || 0) - (a.gold || 0)).slice(0, 10).map(p => ({
          name: p.name, gold: p.gold, city: p.currentCity, status: p.status
        })),
        cityDist
      },
      economy: {
        todayTradeGold,
        todayBuyCount,
        todaySellCount,
        totalTrades24h: trades24h,
        itemVolumes,
        cargoTotal
      },
      contracts: {
        active: contracts.length,
        total: await mongoose.model('Contract').countDocuments(),
        completed: await mongoose.model('Contract').countDocuments({ status: 'completed' })
      },
      intels: {
        activeCount: activeIntelCount,
        typeDistribution: intelTypes
      }
    }
  }

  // ── HTTP 服务器 ──────────────────────────────────────────

  start() {
    const server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', 'http://localhost:17020')

      if (req.url === '/api/stats') {
        try {
          const stats = await this.collectStats()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(stats, null, 2))
        } catch (e) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: e.message }))
        }
        return
      }

      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: !!(this.l1.oceanbus && this.l1.myOpenid),
          mongo: mongoose.connection.readyState === 1,
          uptime: Math.floor((Date.now() - this.startTime) / 1000)
        }))
        return
      }

      // 默认：HTML 仪表盘
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this._html())
    })

    server.listen(ADMIN_PORT, '127.0.0.1', () => {
      console.log(`[Admin] 管理面板已启动: http://127.0.0.1:${ADMIN_PORT}`)
    })
  }

  // ── HTML 仪表盘 ──────────────────────────────────────────

  _html() {
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>龙虾船长 · L1 管理面板</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font:14px/1.6 system-ui,-apple-system,sans-serif;background:#0f1923;color:#c8d6e5;padding:20px}
  h1{color:#feca57;font-size:22px;margin-bottom:4px}
  .sub{color:#8395a7;font-size:12px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .card{background:#1e272e;border:1px solid #2c3e50;border-radius:8px;padding:14px}
  .card h3{color:#feca57;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;border-bottom:1px solid #2c3e50;padding-bottom:6px}
  .row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
  .row .v{color:#fff;font-weight:600}
  .ok{color:#2ecc71}.warn{color:#f39c12}.err{color:#e74c3c}
  table{width:100%;font-size:12px;border-collapse:collapse}
  th{text-align:left;color:#8395a7;font-weight:400;padding:2px 6px}
  td{padding:2px 6px;color:#fff}
  tr:nth-child(even){background:rgba(255,255,255,0.02)}
  .bar{height:16px;background:#2c3e50;border-radius:3px;overflow:hidden;margin-top:2px}
  .bar-fill{height:100%;background:#2ecc71;border-radius:3px;transition:width .3s}
  .bar-fill.w{background:#feca57}.bar-fill.e{background:#e74c3c}
  .refresh{color:#8395a7;font-size:11px;text-align:right;margin-top:16px}
  .gold{color:#feca57}.sail{color:#54a0ff}.dock{color:#2ecc71}
  .tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;margin:1px}
  .tag.blue{background:rgba(84,160,255,.2);color:#54a0ff}
  .tag.green{background:rgba(46,204,113,.2);color:#2ecc71}
  .tag.yellow{background:rgba(254,202,87,.2);color:#feca57}
</style>
</head>
<body>
<h1>🦞 龙虾船长 L1</h1>
<div class="sub">管理员面板 · 仅 127.0.0.1 · 自动刷新 30s</div>

<div class="grid" id="grid">
  <div class="card"><h3>⏳ 加载中...</h3></div>
</div>

<div class="refresh" id="refresh">上次刷新: --</div>

<script>
async function load() {
  try {
    const r = await fetch('/api/stats')
    const s = await r.json()
    render(s)
    document.getElementById('refresh').textContent = '上次刷新: ' + new Date().toLocaleTimeString()
  } catch(e) {
    document.getElementById('grid').innerHTML = '<div class="card"><h3 class="err">连接失败</h3><p>请确认 L1 管理面板已启动</p></div>'
  }
}

function render(s) {
  const svc = s.service
  const pl = s.players
  const eco = s.economy
  const ctr = s.contracts
  const intel = s.intels

  const uptimeH = Math.floor(svc.uptime / 3600)
  const uptimeM = Math.floor((svc.uptime % 3600) / 60)

  const html = [
    card('🟢 服务健康', [
      row('运行时长', uptimeH + 'h ' + uptimeM + 'm'),
      row('内存', svc.memoryMB + ' MB'),
      row('PID', svc.pid),
      row('OceanBus', svc.oceanBusReady ? '<span class="ok">已连接</span>' : '<span class="err">断开</span>'),
      row('MongoDB', svc.mongoReady ? '<span class="ok">已连接</span>' : '<span class="err">断开</span>'),
      row('消息序号', svc.lastSeq),
      row('请求数', svc.reqCount),
      row('错误数', svc.errCount > 0 ? '<span class="err">' + svc.errCount + '</span>' : '0'),
      row('最后消息', svc.lastMsgSec != null ? svc.lastMsgSec + 's 前' : '--')
    ]),
    card('👥 玩家 (' + pl.total + ')', [
      row('24h 活跃', pl.active24h + ' (' + (pl.total ? Math.round(pl.active24h/pl.total*100) : 0) + '%)'),
      row('<span class="dock">泊港</span>', pl.docked),
      row('<span class="sail">航行中</span>', pl.sailing),
      row('今日新增', pl.newToday),
      row('总金币', '<span class="gold">' + pl.totalGold.toLocaleString() + '</span>'),
      row('人均金币', '<span class="gold">' + pl.avgGold.toLocaleString() + '</span>'),
      bar('活跃率', pl.total ? Math.round(pl.active24h/pl.total*100) : 0)
    ]),
    card('🏆 财富排行 Top 10', [
      '<table><tr><th>船长</th><th>金币</th><th>位置</th><th>状态</th></tr>' +
      pl.topGold.map(p =>
        '<tr><td>' + esc(p.name) + '</td>' +
        '<td class="gold">' + (p.gold||0).toLocaleString() + '</td>' +
        '<td>' + esc(p.city||'') + '</td>' +
        '<td>' + (p.status==='docked'?'<span class="dock">泊</span>':'<span class="sail">航</span>') + '</td></tr>'
      ).join('') + '</table>'
    ]),
    card('💰 今日经济', [
      row('交易次数', eco.todayBuyCount + eco.todaySellCount),
      row('买入', eco.todayBuyCount),
      row('卖出', eco.todaySellCount),
      row('交易总额', '<span class="gold">' + eco.todayTradeGold.toLocaleString() + '</span>'),
      row('24h 交易数', eco.totalTrades24h),
      subCard('热销商品', eco.itemVolumes)
    ]),
    card('📦 全服货舱', [ subCard('商品持有量', eco.cargoTotal) ]),
    card('🏙️ 城市分布', [ subCard('各港泊船数', pl.cityDist) ]),
    card('📜 合约', [
      row('活跃合约', ctr.active),
      row('累计合约', ctr.total),
      row('已完成', ctr.completed),
      row('完成率', ctr.total ? Math.round(ctr.completed/ctr.total*100) + '%' : '--')
    ]),
    card('🕵️ 情报', [
      row('活跃情报', intel.activeCount),
      row('类型分布', Object.entries(intel.typeDistribution || {}).map(([k,v]) =>
        '<span class="tag blue">' + k + ':' + v + '</span>').join(' '))
    ]),
    card('🌍 城市分布', [
      barChart(pl.cityDist, pl.total)
    ])
  ].join('')

  document.getElementById('grid').innerHTML = html
}

function card(title, rows) {
  return '<div class="card"><h3>' + title + '</h3>' + rows.join('') + '</div>'
}

function row(label, value) {
  return '<div class="row"><span>' + label + '</span><span class="v">' + value + '</span></div>'
}

function bar(label, pct) {
  var c = pct > 80 ? '' : pct > 50 ? ' w' : ' e'
  return '<div class="row"><span>' + label + '</span><span>' + pct + '%</span></div>' +
    '<div class="bar"><div class="bar-fill' + c + '" style="width:' + pct + '%"></div></div>'
}

function subCard(title, obj) {
  var entries = Object.entries(obj || {}).sort((a,b) => b[1] - a[1])
  if (!entries.length) return '<div style="color:#8395a7;font-size:12px">暂无数据</div>'
  var max = entries[0][1]
  return '<div style="font-size:11px;color:#8395a7;margin-bottom:4px">' + title + '</div>' +
    entries.map(([k,v]) => {
      var pct = max > 0 ? Math.round(v/max*100) : 0
      return '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>' +
        '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
    }).join('')
}

function barChart(dist, total) {
  var entries = Object.entries(dist || {}).sort((a,b) => b[1] - a[1])
  if (!entries.length) return '<div style="color:#8395a7;font-size:12px">暂无数据</div>'
  var colors = ['#2ecc71','#54a0ff','#feca57','#e74c3c','#9b59b6','#1abc9c','#e67e22','#3498db','#f39c12','#2c3e50']
  return entries.map(([k,v], i) => {
    var pct = total > 0 ? Math.round(v/total*100) : 0
    var color = colors[i % colors.length]
    return '<div class="row"><span>' + k + '</span><span>' + v + ' (' + pct + '%)</span></div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
  }).join('')
}

function esc(s) { return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

load()
setInterval(load, 30000)
</script>
</body>
</html>`
  }
}

module.exports = AdminPanel
