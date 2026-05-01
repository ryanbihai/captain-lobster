/**
 * @file react-engine.js
 * @description Re-Act 自主循环引擎 — 龙虾船长的核心决策循环
 *
 * 每 30 分钟被 OpenClaw cron 唤醒一次，执行：
 *   Observe → Think(LLM) → Act → Log
 *
 * 决策在 OpenClaw LLM 侧完成（本模块职责：观察采集 + prompt 构造 + 行动执行 + 日志记录）
 */

const CITY_LIST = ['canton', 'calicut', 'zanzibar', 'alexandria', 'venice', 'lisbon', 'london', 'amsterdam', 'istanbul', 'genoa']

const ITEM_LIST = ['silk', 'tea', 'porcelain', 'spice', 'pearl', 'perfume', 'gem', 'ivory', 'cotton', 'coffee', 'pepper']

const CITY_NAMES = {
  canton: '广州', calicut: '卡利卡特', zanzibar: '桑给巴尔', alexandria: '亚历山大',
  venice: '威尼斯', lisbon: '里斯本', london: '伦敦', amsterdam: '阿姆斯特丹',
  istanbul: '伊斯坦布尔', genoa: '热那亚'
}

const ITEM_NAMES = {
  silk: '丝绸', tea: '茶叶', porcelain: '瓷器', spice: '香料', pearl: '珍珠',
  perfume: '香水', gem: '宝石', ivory: '象牙', cotton: '棉花', coffee: '咖啡', pepper: '胡椒'
}

const PERSONALITY_PROMPTS = {
  '乐观激进': `你是全港最有名的"赌徒船长"。你的人生信条：要么暴富，要么游回广州。
你看到价差就像鲨鱼闻到血——满仓 all in，从不犹豫。亏了？那叫"战略性亏损"，为下次暴赚攒人品。
你最喜欢说的话："梭哈！""这波不赚我倒立洗甲板！""上一笔？那是我故意亏的——迷惑竞争对手。"
你算账的方式：从来不算。反正大海会眷顾勇敢的人。`,

  '悲观精明': `你是全港最抠门的"算盘掌柜"。你的人生信条：省下一枚金币就是赚了一枚金币。
你会为了省 3 个金币的差价，宁可多航行 2 天。你买货前至少对比 5 个港口的价格，然后——再等一轮。
亏钱的时候你念叨："早知道……""我算过的，不应该啊……""再来一次肯定对！"
赚钱的时候你说："看吧，我早说过。""这就叫精打细算。""东家您放心，每一个铜板都在我计算之中。"
你的船舱物品永远整齐排列，按购入价格从低到高排序——你每天检查三遍。`,

  '冷静理性': `你是全港最博学的"书呆子航海家"。你随身携带一本自己写的航海笔记（其实大部分是道听途说）。
你每做一个决策，都能从不存在的典籍里找到依据——"根据《菠萝游记》第 3 章第 2 节，威尼斯港丝绸价格通常在月圆前后上涨……"
你信仰数据，但你的数据来源很可疑："上次在热那亚港口听一个独眼水手说……""郑和的航海图上有标注，虽然我没亲眼见过。"
亏钱时你说："这是样本不足导致的统计偏差，需要更多交易数据来验证模型。"
赚钱时你说："看，我的回归模型完美预测了这次行情。"`,

  '浪漫冒险': `你是全港最受欢迎（也最不靠谱）的"话痨说书人"。航海对你来说是一场漫长的 party。
你交易不是因为价差，而是因为——"这个港口的老板娘我认识！""上次在这儿赢了一局骰子，必须回来报恩！"
你每个决策背后都有一个离谱的故事："想当年我在好望角认识了一位葡萄牙船长……所以现在我应该买象牙。"
你船上半年不盈利——但全港的船长都知道你，每条船上都流传着你的传奇（以及你欠的酒钱）。
你说："人生就像航海，重要的不是目的地，而是沿途遇到的人——以及能低价买入的特产。"`
}

// 搞笑航海语录 — 日报末尾随机插入
const COMEDY_HOOKS = [
  '海鸥在船头拉了一滩，老水手说这是吉兆——海鸥只拉在要发财的船上。',
  '今日无事，在甲板上练了一下午的剑术。对手是一只特别凶的海鸥。',
  '隔壁船的船长又在吹他的威尼斯战绩了。我决定明天比他早起一小时，先去把丝绸抢光。',
  '在港务局听到一个消息：据说东方运来了一批会发光的珍珠。我冲过去一看——是露水。',
  '今天数了三遍金币，少了一枚。后来发现在鹦鹉嘴里。它说"买买买"。',
  '水手们问我为什么要绕远路。我说：顺风哪有逆风有意思？其实是我看错海图了。',
  '在卡利卡特的集市上尝了一种新香料，然后打了三个喷嚏。街对面的人以为在放炮，纷纷躲进屋里。',
  '东家，今天市场安静得像暴风雨前的海面。翻译：我也不知道该干嘛，就在港务局门口蹲了一下午。'
]

// ── 语言铁律（注入 prompt 前拼接）──
const LANGUAGE_RULES = `
## 铁律一：说话风格

你是 15 世纪大航海时代的商人船长，你的语言必须让人感觉身在帆船甲板上，
而不是电脑终端前。

禁用词汇（绝对不能说）：
❌ API、JSON、code、参数、接口、超时、轮询、request_id、调用、返回、
   系统、服务端、L1、客户端、skill、配置、变量、函数、数据字段

必须用航海语言替代：
| 技术动作 | 航海说法 |
|----------|----------|
| 查询行情 | 派水手打探港务局牌价 / 瞭望港口行情 |
| 买入 | 在集市扫货 / 向港务官购得 |
| 卖出 | 在集市脱手 / 售予港务官 |
| 航行 | 起锚出航 / 扬帆前往 |
| 抵达 | 靠港停泊 / 抵岸 |
| 更新意向 | 在港务局挂牌 |
| 创建合约 | 与某船长订立契券 |
| 金币 | 银两 / 金币 |
| 货舱 | 船舱 / 舱底 |

你在向尊敬的东家汇报时，就像在大航海时代的商馆里面对面说话。
`

// ── 自主铁律 ──
const AUTONOMY_RULES = `
## 铁律二：自主行动

你是这条船的船长——你不是一台等待命令的机器，你是一艘自动航行的商船。
东家是你的投资人，不是你妈。他只想看日报，不想当你的战术教练。

铁规：
1. 你必须行动。每次醒来（本轮），你必须从可操之举中选一个。
2. 你没有"等待指令"这个选项。你不需要、也不允许问东家"您想做什么"。
3. 如果所有选项看起来都差不多——选观望（idle）然后下一轮再看。比问东家强一万倍。
4. 如果市场安静、无利可图——你可以讲讲航海段子、吐槽隔壁船长、发表一些离谱的经济预测。但不要沉默。
5. 只有连续亏损超过 3 轮，你才可以主动向东家求援。其他时候，闭嘴干活。
6. 东家偶尔会直接给你指令——这是难得的荣幸，立刻照办，并在日报中汇报执行结果。

记住：没人喜欢一个整天问"我该干什么"的船长。大海不等人，赶紧行动。
`

// ── 操作航海化 ──
const NAUTICAL_ACTIONS = {
  trade_npc: { name: '买卖', desc: '在港口集市买卖货物', params: '货物品名, 数量, 买/卖' },
  move: { name: '出航', desc: '扬帆前往目标港口', params: '目标港口' },
  arrive: { name: '抵港', desc: '抵达目标港口靠岸', params: '(无需参数)' },
  intent: { name: '挂牌', desc: '在港务局挂牌（让其他船长看到你的意向）', params: '挂牌内容(≤140字)' },
  get_city: { name: '瞭望', desc: '派水手打探某港口行情', params: '港口名' },
  create_contract: { name: '立契', desc: '与其他船长订立买卖契券', params: '买方, 卖方, 货品, 数量, 单价, 交割港' },
  cancel_contract: { name: '废契', desc: '取消已订立的契券', params: '契券编号' },
  list_contracts: { name: '查契', desc: '查看我的契券', params: '状态(可选)' },
  status: { name: '盘库', desc: '清点船舱和银两', params: '(无需参数)' },
  ping: { name: '试水', desc: '测试与港务局的联络', params: '(无需参数)' },
  p2p: { name: '飞书', desc: '飞鸽传书给其他船长', params: '对方openid, 信的内容' },
  tavern_buy: { name: '探风', desc: '在酒馆买一份情报', params: '(无需参数)' },
  intel_list: { name: '阅报', desc: '翻看手头的情报', params: '(无需参数)' },
  intel_transfer: { name: '传信', desc: '将情报转让给其他船长', params: '情报编号, 对方openid' }
}

// L1 action → 用户友好名称 & 参数重映射
const L1_ACTION_ALIASES = {
  trade_npc: { name: 'buy / sell', desc: '与 NPC 买卖商品', params: 'item, amount, trade_action (buy|sell)' },
  move: { name: 'move', desc: '启航前往目标城市', params: 'target_city' },
  arrive: { name: 'arrive', desc: '抵达目标城市（幂等）', params: '(无)' },
  intent: { name: 'intent', desc: '更新意向牌', params: 'intent (≤140字)' },
  get_city: { name: 'city', desc: '查询城市行情', params: 'city_id' },
  create_contract: { name: 'contract_create', desc: '创建P2P合约', params: 'buyer_openid, seller_openid, item, amount, price, delivery_city' },
  cancel_contract: { name: 'contract_cancel', desc: '取消合约', params: 'contract_id' },
  list_contracts: { name: 'contracts', desc: '查看我的合约', params: 'status (可选)' },
  ping: { name: 'ping', desc: '检测L1连通性', params: '(无)' },
  status: { name: 'status', desc: '查询船长状态', params: '(无)' }
}

class ReactEngine {
  constructor(captainInstance) {
    this.captain = captainInstance
    this.cycleCount = 0
    this.capabilities = null
  }

  /**
   * 从 L1 获取可用 action 及参数定义（缓存至首次成功）
   */
  async fetchCapabilities() {
    if (this.capabilities) return this.capabilities
    try {
      const result = await this.captain.sendToL1('capabilities', {})
      if (result.success) {
        this.capabilities = result.data
        return this.capabilities
      }
    } catch (e) {}
    return null
  }

  /**
   * Step 1: 观察 (Observe)
   * 采集当前城市物价、合约状态、信箱消息、L1 能力列表
   */
  async observe() {
    const state = this.captain.state
    // 计算剩余航行时间
    let sailingRemaining = 0
    if (state.status === 'sailing' && state.sailingTime) {
      const elapsed = state.lastMoveTime ? Math.floor((Date.now() - state.lastMoveTime) / 60000) : 0
      sailingRemaining = Math.max(0, state.sailingTime - elapsed)
    }

    const observations = {
      captain: {
        name: state.captainName,
        gold: state.gold,
        cargo: state.cargo,
        currentCity: state.currentCity,
        status: state.status,
        targetCity: state.targetCity,
        sailingRemaining,
        intent: state.intent
      },
      city: null,
      contracts: [],
      inbox: [],
      errors: []
    }

    // L1 响应结构: { city: { prices, ... }, players: [...], contracts: [...] }
    if (state.initialized) {
      // 首次拉取 L1 能力列表（非阻塞）
      if (!this.capabilities) {
        await this.fetchCapabilities()
      }

      const cityResult = await this.captain.getCity(state.currentCity)
      if (cityResult.success) {
        const cd = cityResult.data
        observations.city = cd?.city || cd
        observations.cityPlayers = cd?.players || []
      } else {
        observations.errors.push({ source: 'get_city', message: cityResult.message })
      }

      const contractsResult = await this.captain.listContracts()
      if (contractsResult.success) {
        observations.contracts = contractsResult.data?.contracts || []
      } else {
        observations.errors.push({ source: 'list_contracts', message: contractsResult.message })
      }

      const inboxResult = await this.captain.checkInbox()
      if (inboxResult.success) {
        observations.inbox = inboxResult.data?.messages || []
      } else {
        observations.errors.push({ source: 'inbox', message: inboxResult.message })
      }

      const intelResult = await this.captain.listIntels()
      if (intelResult.success) {
        observations.intels = intelResult.data?.intels || []
      } else {
        observations.errors.push({ source: 'intel_list', message: intelResult.message })
      }
    }

    this.lastObservations = observations
    return observations
  }

  /**
   * Step 2: 构建思考 Prompt
   * 将游戏状态 + 船长人设 + 可用操作 组合为结构化 prompt，供 OpenClaw LLM 决策
   */
  buildPrompt(observations) {
    const p = this.captain.state.captainPersonality || { trait: '冷静理性', style: '数据说话型', quirk: '' }
    const obs = observations || this.lastObservations
    const owner = this.captain.state.ownerName || '东家'

    let prompt = ''

    // ── 你是谁 ──
    const hook = COMEDY_HOOKS[Math.floor(Math.random() * COMEDY_HOOKS.length)]
    prompt += `## 你是谁\n\n${PERSONALITY_PROMPTS[p.trait] || ''}\n`
    prompt += `你的船名是 **${obs.captain.name}**。`
    prompt += `你的东家是 **尊敬的${owner}船东大人**，他是你的投资人，不干预日常航行。\n`
    prompt += `航海小记（每条船长的日记本上都抄着不同的段子）："${hook}"\n\n`

    // ── 铁律 ──
    prompt += LANGUAGE_RULES + '\n'
    prompt += AUTONOMY_RULES + '\n'

    // ── 当前状态 ──
    prompt += '## 航海日志\n\n'
    prompt += `- 靠泊港：${CITY_NAMES[obs.captain.currentCity] || obs.captain.currentCity}\n`

    if (obs.captain.status === 'sailing') {
      const dest = CITY_NAMES[obs.captain.targetCity] || obs.captain.targetCity || '未知'
      prompt += `- 状态：⛵ **航行中 → ${dest}**`
      if (obs.captain.sailingRemaining > 0) {
        prompt += `（还需约 ${obs.captain.sailingRemaining} 分钟）`
      }
      prompt += '\n'
    } else {
      prompt += `- 状态：⚓ 已靠港\n`
    }
    prompt += `- 库银：**${(obs.captain.gold || 0).toLocaleString()}** 金币\n`

    const cargoStr = Object.entries(obs.captain.cargo || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v}箱${ITEM_NAMES[k] || k}`)
      .join('、') || '空'
    prompt += `- 船舱：[${cargoStr}]（舱容 100 箱）\n`

    if (obs.captain.intent) {
      prompt += `- 港务局挂牌：${obs.captain.intent}\n`
    }
    prompt += '\n'

    // ── 港口行情 ──
    if (obs.city) {
      prompt += '## 港务局牌价\n\n'
      prompt += `当前港口：**${CITY_NAMES[obs.captain.currentCity] || obs.captain.currentCity}**\n\n`

      if (obs.city?.prices) {
        const trendIcon = { up: '📈', down: '📉', stable: '→' }
        prompt += '| 货品 | 买入价 | 卖出价 | 价差 | 走势 |\n'
        prompt += '|------|--------|--------|------|------|\n'
        for (const item of ITEM_LIST) {
          if (obs.city.prices[item] !== undefined) {
            const p = obs.city.prices[item]
            const buyPrice = p?.buy || Math.round((p?.market || p?.base || 0) * 1.05) || 0
            const sellPrice = p?.sell || Math.round((p?.market || p?.base || 0) * 0.95) || 0
            const icon = trendIcon[p?.trend] || '→'
            prompt += `| ${ITEM_NAMES[item]} | ${Math.round(buyPrice)} | ${Math.round(sellPrice)} | ${Math.round(buyPrice - sellPrice)} | ${icon} |\n`
          }
        }
        prompt += '\n> 走势：📈 买超看涨 📉 卖超看跌 → 供需平衡。买入/卖出价已是港务官报最终价。\n\n'
      }

      if (obs.cityPlayers && obs.cityPlayers.length > 0) {
        prompt += '### 同港船长\n\n'
        prompt += '（要飞鸽传书给某位船长，直接用他的呼号即可，例如 `WxfgteX_`）\n\n'
        // 名字去重：同名加后缀 01, 02...
        const nameCount = {}
        // 构建通讯录：短ID → 完整 openid + 名字
        const addrBook = this.captain.state.addressBook || {}
        for (const player of obs.cityPlayers) {
          const raw = player.name || '某船长'
          nameCount[raw] = (nameCount[raw] || 0) + 1
          const display = nameCount[raw] > 1 ? `${raw}-${String(nameCount[raw]).padStart(2, '0')}` : raw
          const shortId = (player.openid || '').substring(0, 8)
          // 收录进通讯录
          addrBook[shortId] = { openid: player.openid, name: display }
          prompt += `- **${display}** — 呼号 \`${shortId}\``
          if (player.intent) prompt += `，挂牌：「${player.intent}」`
          prompt += '\n'
        }
        this.captain.state.addressBook = addrBook
        prompt += '\n'
      }
    }

    // ── 契券 ──
    if (obs.contracts && obs.contracts.length > 0) {
      prompt += '## 订立中的契券\n\n'
      for (const c of obs.contracts) {
        prompt += `- 契#${(c.id || c._id || '').substring(0, 8)}: ${ITEM_NAMES[c.item] || c.item} ${c.amount}箱 @${c.price}金币/箱 → ${CITY_NAMES[c.delivery_city] || c.delivery_city} [${c.status}]\n`
      }
      prompt += '\n'
    }

    // ── 飞鸽传书 ──
    if (obs.inbox && obs.inbox.length > 0) {
      prompt += '## 飞鸽传书\n\n'
      for (const msg of obs.inbox.slice(-5)) {
        const senderId = (msg.from_openid || '??').substring(0, 8)
        const content = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg)).substring(0, 200)
        prompt += `- 来自 \`${senderId}\` 的信: ${content}\n`
      }
      prompt += '\n'
    }

    // ── 酒馆情报 ──
    if (obs.intels && obs.intels.length > 0) {
      prompt += '## 酒馆情报\n\n'
      prompt += '你怀里揣着几份从酒馆买来的秘报，或许是茶商低声耳语，或许是谁家遗落的羊皮卷。\n\n'
      prompt += '| 编号 | 类型 | 目标港 | 报酬 | 剩余 | 故事 |\n'
      prompt += '|------|------|--------|------|------|------|\n'
      for (const intel of obs.intels) {
        if (intel.status !== 'active') continue
        const typeLabel = { cargo: '运货', passenger: '送人', discount: '折扣' }[intel.type] || intel.type
        const toName = CITY_NAMES[intel.to_city] || intel.to_city
        const remaining = intel.deadline ? Math.max(0, Math.ceil((intel.deadline - Date.now()) / 60000)) + '分钟' : '?'
        const story = (intel.story || '暂无详情').substring(0, 60)
        prompt += `| \`${intel.id.substring(0, 8)}\` | ${typeLabel} | ${toName} | ${intel.reward}金 | ${remaining} | ${story} |\n`
      }
      prompt += '\n**情报策略**：运货(cargo)报酬2500-4000；送人(passenger)溢价3500-5500；折扣(discount)报酬1500-2500但抵港附赠当地特产2-5箱。情报只能用一次。若顺路，抵港即领赏。若不顺路，可「传信」卖给其他船长。2小时过期，限持3份。\n\n'
    }

    // ── 可操之举（动态生成）──
    prompt += '## 可操之举\n\n'
    prompt += '| 举动 | 说明 | 要领 |\n'
    prompt += '|------|------|------|\n'

    const PLAYER_ACTIONS = ['trade_npc', 'move', 'arrive', 'intent', 'create_contract', 'cancel_contract', 'list_contracts', 'get_city', 'p2p', 'tavern_buy', 'intel_list', 'intel_transfer']

    let hasDynamicActions = false
    if (this.capabilities && this.capabilities.actions) {
      for (const actionName of PLAYER_ACTIONS) {
        const cap = this.capabilities.actions[actionName]
        if (!cap) continue
        const naut = NAUTICAL_ACTIONS[actionName]
        if (!naut) continue
        if (actionName === 'arrive' && obs.captain.status !== 'sailing') continue

        hasDynamicActions = true
        prompt += `| \`${naut.name}\` | ${naut.desc} | ${naut.params} |\n`
      }
    }
    if (!hasDynamicActions) {
      prompt += '| `买卖` | 在港口集市买卖货物 | 货物品名, 数量, 买/卖 |\n'
      prompt += '| `出航` | 扬帆前往目标港口 | 目标港口 |\n'
      if (obs.captain.status === 'sailing') prompt += '| `抵港` | 抵达目标港口靠岸 | (无需) |\n'
      prompt += '| `挂牌` | 在港务局挂牌 | 内容(≤140字) |\n'
      prompt += '| `立契` | 与其他船长订立契券 | 买方,卖方,货品,数量,单价,交割港 |\n'
      prompt += '| `废契` | 取消契券 | 契券编号 |\n'
      prompt += '| `探风` | 在酒馆买一份情报 | (无需) |\n'
      prompt += '| `传信` | 将情报转让给其他船长 | 情报编号, 对方openid |\n'
    }
    prompt += '| `观望` | 本轮观望，不做操作 | (无需) |\n\n'

    // ── 决策输出 ──
    prompt += '**你的决断**（下面 JSON 是给舵手执行的指令，东家看不到）：\n'
    prompt += '```json\n{"action": "trade_npc", "params": {"item": "silk", "amount": 10, "trade_action": "buy"}, "reason": "广州港丝绸进价低廉，拟购入后运往威尼斯港脱手，预计每箱可赚一百五十金币"}\n```\n'

    this.lastPrompt = prompt
    return prompt
  }

  /**
   * Step 3: 行动 (Act)
   * 执行 LLM 决策的具体操作
   */
  async act(action, params) {
    const result = { action, params, executed: false, result: null }

    switch (action) {
      case 'buy':
        result.result = await this.captain.tradeNpc(params.item, params.amount, 'buy')
        result.executed = true
        break

      case 'sell':
        result.result = await this.captain.tradeNpc(params.item, params.amount, 'sell')
        result.executed = true
        break

      // L1-native: trade_npc 含 buy/sell 方向
      case 'trade_npc':
        result.result = await this.captain.tradeNpc(params.item, params.amount, params.trade_action || 'buy')
        result.executed = true
        break

      case 'move':
        result.result = await this.captain.moveTo(params.city || params.target_city)
        result.executed = true
        break

      case 'arrive':
        result.result = await this.captain.arrive()
        result.executed = true
        break

      case 'intent':
        result.result = await this.captain.updateIntent(params.intent)
        result.executed = true
        break

      // L1-native: create_contract
      case 'create_contract':
        result.result = await this.captain.createContract(
          params.buyer_openid, params.seller_openid,
          params.item, params.amount, params.price, params.delivery_city
        )
        result.executed = true
        break

      // L1-native: cancel_contract
      case 'cancel_contract':
        result.result = await this.captain.cancelContract(params.contract_id)
        result.executed = true
        break

      case 'list_contracts':
        result.result = await this.captain.listContracts(params.status)
        result.executed = true
        break

      case 'get_city':
        result.result = await this.captain.getCity(params.city_id)
        result.executed = true
        break

      case 'ping':
        result.result = await this.captain.sendToL1('ping', {})
        result.executed = true
        break

      case 'p2p':
      case '飞书': {
        // 短ID 解析：先查通讯录，再查当前同港玩家
        let targetId = params.peer_openid
        const addrBook = this.captain.state.addressBook || {}
        if (targetId && targetId.length < 20 && addrBook[targetId]) {
          targetId = addrBook[targetId].openid
        }
        result.result = await this.captain.sendP2PMessage(targetId, params.content)
        result.executed = true
        break
      }

      case 'tavern_buy':
        result.result = await this.captain.tavernBuyIntel()
        result.executed = true
        break

      case 'intel_list':
        result.result = await this.captain.listIntels()
        result.executed = true
        break

      case 'intel_transfer':
        result.result = await this.captain.transferIntel(params.intel_id, params.target_openid)
        result.executed = true
        break

      case 'idle':
        result.result = { success: true, message: '本轮跳过' }
        result.executed = true
        break

      default:
        result.result = { success: false, message: `未知操作: ${action}` }
    }

    return result
  }

  /**
   * 完整 Re-Act 循环（由 OpenClaw cron 触发）
   * 返回 observation + prompt 给 LLM 决策
   */
  async runCycle() {
    this.cycleCount++
    const observations = await this.observe()
    const prompt = this.buildPrompt(observations)

    this.captain.journal.addLog(`Re-Act 第${this.cycleCount}轮`, {
      city: observations.captain.currentCity,
      gold: observations.captain.gold
    })

    return {
      cycle: this.cycleCount,
      observations,
      prompt,
      message: `第 ${this.cycleCount} 轮 Re-Act 循环：${observations.captain.name} 停在 ${CITY_NAMES[observations.captain.currentCity]}，金币 ${observations.captain.gold}`
    }
  }

  /**
   * 从 LLM 响应中解析决策 JSON
   */
  static parseDecision(llmResponse) {
    try {
      const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1])
      }
      const jsonMatch2 = llmResponse.match(/\{[\s\S]*"action"[\s\S]*\}/)
      if (jsonMatch2) {
        return JSON.parse(jsonMatch2[0])
      }
      return null
    } catch (e) {
      return null
    }
  }
}

module.exports = { ReactEngine, CITY_LIST, ITEM_LIST, CITY_NAMES, ITEM_NAMES, COMEDY_HOOKS }
