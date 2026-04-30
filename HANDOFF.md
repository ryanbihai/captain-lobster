# 龙虾船长 - 开发交接文档

**日期**：2026-04-28  
**会话概要**：Skill 客户端优化（Re-Act 引擎、状态持久化、人设注入、Bug 修复），及 OceanBus API v2 迁移准备

---

## 一、已完成的工作

### 1.1 新增文件

| 文件 | 用途 |
|------|------|
| `skills/captain-lobster/src/react-engine.js` | Re-Act 自主循环引擎。每 30 分钟执行 Observe→Think(LLM)→Act→Log |
| `skills/captain-lobster/src/state-store.js` | 状态+OceanBus 身份持久化到 `~/.captain-lobster/` |
| `skills/captain-lobster/HEARTBEAT.md` | OpenClaw 自主运行心跳文件 |

### 1.2 修改文件

| 文件 | 关键改动 |
|------|----------|
| `skills/captain-lobster/src/index.js` | **核心重写**：整合 StateStore + ReactEngine；**移除硬编码 L1_OPENID**；新增 `react`/`cities` action；构造函数自动从磁盘恢复状态 |
| `skills/captain-lobster/src/oceanbus.js` | `pollForReply` 指数退避（5次间隔翻倍，上限8s）；新增 `requestWithRetry`（3次重试）；401 快速失败 |
| `skills/captain-lobster/src/keystore.js` | 修复 `importBackup` 双重加密 bug |
| `skills/captain-lobster/manifest.yaml` | 新增 `schedule`（每30min react + 每天8/20点 report）；`l1_openid` 改为必填+加密 |
| `skills/captain-lobster/SKILL.md` | 新增自主运行模式章节；更新配置说明 |
| `skills/captain-lobster/config.example.yaml` | 更新配置项 |

### 1.3 新增测试

| 文件 | 内容 |
|------|------|
| `skills/captain-lobster/tests/test-new-user-reg.js` | 16 步完整集成测试（注册→状态查询→NPC交易→航行→跨调用持久化→Re-Act） |

---

## 二、已验证通过的功能（L1+API 正常时）

测试脚本：`node skills/captain-lobster/tests/test-new-user-reg.js`

- ✅ 无密码初始化拒绝（requirePassword）
- ✅ 新用户注册（密钥生成 → OceanBus 注册 → L1 enroll → 随机船长名+人格）
- ✅ **跨调用状态恢复**（新实例从 `bus-identity.json` + `state.json` 恢复）
- ✅ 城市行情查询（广州物价 silk/tea/porcelain）
- ✅ Ping L1
- ✅ Re-Act 循环（观察城市+合约+信箱，生成人格化 prompt）
- ⏳ NPC 交易（买入/卖出/货舱验证）— 代码就绪，待 API 恢复
- ⏳ 航行移动到新城市 — 代码就绪
- ⏳ 航行中交易拒绝 — 代码就绪

---

## 三、待完成的 OceanBus API v2 迁移

### 文档参考：`OceanBus接口文档.md`

**V2 核心变更：**
1. `agent_code` 彻底废除 → 注册仅返回 `agent_id` + `api_key`
2. `/agents/lookup` 废弃 → 改为 `GET /agents/me` 返回 `my_openid`
3. OpenID 改为 76 字符 XChaCha20-Poly1305 加密票据

### 需要修改的文件（待 OceanBus 团队测试完毕后执行）

**Skill 侧：**
- `src/oceanbus.js` — `register()` 改用 `agent_id` + `/agents/me`；`agentCode` → `agentId`
- `src/state-store.js` — `saveBusIdentity` 参数改 `agentId`（已部分改动）
- `src/index.js` — `agentCode` → `agentId`（已部分改动）
- `doc/test-oceanbus-api.js` — 删除 Lookup 测试，新增 `/agents/me` 测试

**L1 服务端：**
- `ai-backend-template/src/lib/oceanbus.js` — 同步 Skill 侧改动
- `ai-backend-template/src/apps/03-LobsterSvc/oceanbus-service.js` — `agentCode` → `agentId`；`l1-agent.json` 字段更新

### 注意：上述文件中 Skill 侧的 `oceanbus.js`、`state-store.js`、`index.js` 已有部分 `agentCode` → `agentId` 改动（在会话中尝试迁移时还原了），**按新文档重新改时需要整体 review，避免残留旧字段名**。

---

## 四、基础环境要求

| 组件 | 说明 |
|------|------|
| Docker Desktop | 需要启动（本次会话未启动） |
| MongoDB | `docker run -d --name mongo4 -p 27017:27017 mongo:4.0` |
| Redis | `docker run -d --name local_redis -p 6380:6379 redis:latest` |
| L1 服务 | `cd ai-backend-template && node src/apps/03-LobsterSvc/start-oceanbus.js` |
| OceanBus URL | `https://ai-t.ihaola.com.cn/api/l0` |

---

## 五、下一步工作建议

1. **等待 OceanBus 团队完成 v2 API 测试**，然后按第三章清单完成迁移
2. **迁移完成后运行** `node tests/test-new-user-reg.js` 验证全部 16 步
3. 如需 Docker：先启动 Docker Desktop，再启动 MongoDB + Redis
4. 如需启动 L1 服务：`cd ai-backend-template && node src/apps/03-LobsterSvc/start-oceanbus.js`（启动后会打印 L1_OPENID，设为环境变量）
5. 后续可优化：P2P 砍价 LLM 推理逻辑、多船长模拟测试
