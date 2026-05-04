/**
 * 将龙虾船长 L1 注册到 OceanBus 黄页
 * 用 Node.js 原生 crypto（与黄页服务端 key 格式一致：ed25519:base64url）
 */
const request = require('superagent');
const crypto = require('crypto');
const { writeFileSync, existsSync, readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

// https://ai-t.ihaola.com.cn/api/l0
const L0_URL = 'https://ai-t.ihaola.com.cn/api/l0';
const YP_OPENID = 'YwvQeEb8X9b394wKxetJ06EV9w5IIglMlucJmbb_gwLbBg_dB50NyB7SYdxBAIObSjdPNprkooxZ3icV';
const L1_OPENID = 'oa9EliN5y6HhsovCV-Q8uy4CKsQb3oM29GACCZ-6Jpn9YpZn9WNiX9pTJ6DpmgE49nmA_kyIyFk09-hA';

const TAGS = ['game', 'trading', 'sailing', 'simulation', 'zero-player', 'p2p', 'ai-agent'];
const DESC = '龙虾船长 (Captain Lobster)，大航海时代零玩家 AI 商战游戏。AI 扮演商船船长自主观察行情、低买高卖、扬帆远航。10大港口、11种商品、动态供需经济、P2P合约交易。安装 ClawHub Skill 后对 AI 说「帮我激活龙虾船长」即可起航。免费公测中。GitHub: https://github.com/ryanbihai/captain-lobster';

const KEY_PATH = join(homedir(), '.captain-lobster', 'yp-key.json');

// ── Ed25519 via Node crypto ──
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function rawToPrivateKeyObject(rawBytes) {
  const der = Buffer.concat([PKCS8_PREFIX, rawBytes]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwkPub = publicKey.export({ format: 'jwk' });
  const jwkPriv = privateKey.export({ format: 'jwk' });
  return {
    publicKey: 'ed25519:' + jwkPub.x,
    secretKey: 'ed25519:' + jwkPriv.d,
  };
}

function sign(secretKeyStr, message) {
  const raw = Buffer.from(secretKeyStr.replace(/^ed25519:/, ''), 'base64url');
  const privateKey = rawToPrivateKeyObject(raw);
  const sig = crypto.sign(null, Buffer.from(message, 'utf-8'), privateKey);
  return 'ed25519:' + sig.toString('base64url');
}

// ── Canonical JSON ──
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🦞 龙虾船长 → OceanBus 黄页注册\n');

  // 1. 注册临时 Agent
  console.log('[1] 注册临时 Agent...');
  const reg = await request.post(L0_URL + '/agents/register').timeout(10000).ok(() => true);
  if (reg.body.code !== 0) { console.error('注册失败:', reg.body.msg); return; }
  const apiKey = reg.body.data.api_key;
  const auth = () => ({ Authorization: 'Bearer ' + apiKey });
  console.log('    ID: ' + reg.body.data.agent_id);

  // 2. 密钥
  console.log('\n[2] 黄页密钥...');
  let kp;
  if (existsSync(KEY_PATH)) {
    kp = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
    console.log('    加载已有: ' + kp.publicKey.substring(0, 40) + '...');
  } else {
    kp = generateKeypair();
    writeFileSync(KEY_PATH, JSON.stringify(kp, null, 2), { mode: 0o600 });
    console.log('    新密钥 → ' + KEY_PATH);
    console.log('    publicKey: ' + kp.publicKey.substring(0, 40) + '...');
  }

  // 3. register_service
  console.log('\n[3] register_service...');
  const regPayload = {
    action: 'register_service',
    request_id: 'req_reg_' + Date.now(),
    openid: L1_OPENID,
    tags: TAGS,
    description: DESC,
    public_key: kp.publicKey,
  };
  const { sig: _s, ...forSigning } = regPayload;
  regPayload.sig = sign(kp.secretKey, canonicalize(forSigning));

  await request.post(L0_URL + '/messages')
    .set(auth())
    .send({ to_openid: YP_OPENID, client_msg_id: 'reg_lobster_' + Date.now(), content: JSON.stringify(regPayload) })
    .timeout(10000).ok(() => true);
  console.log('    已发送...');

  let regResp = null;
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const sync = await request.get(L0_URL + '/messages/sync')
      .set(auth()).query({ since_seq: 0, limit: 20 }).timeout(10000).ok(() => true);
    for (const msg of (sync.body.data?.messages || [])) {
      try { const b = JSON.parse(msg.content); if (b.request_id === regPayload.request_id) regResp = b; } catch (_) {}
    }
    if (regResp) break;
    process.stdout.write('.');
  }

  if (regResp) {
    if (regResp.code === 0) {
      console.log('\n    ✅ 注册成功! registered_at=' + regResp.data?.registered_at);
    } else if (regResp.code === 1002) {
      console.log('\n    ⚠️ 已注册(code=1002)，更新条目...');
      const updPayload = {
        action: 'update_service',
        request_id: 'req_upd_' + Date.now(),
        openid: L1_OPENID,
        tags: TAGS,
        description: DESC,
      };
      const { sig: _s2, ...updForSign } = updPayload;
      updPayload.sig = sign(kp.secretKey, canonicalize(updForSign));
      await request.post(L0_URL + '/messages')
        .set(auth())
        .send({ to_openid: YP_OPENID, client_msg_id: 'upd_lobster_' + Date.now(), content: JSON.stringify(updPayload) })
        .timeout(10000).ok(() => true);
      await sleep(5000);
      console.log('    更新已发送');
    } else {
      console.log('\n    ❌ code=' + regResp.code + ' msg=' + (regResp.msg || ''));
    }
  } else {
    console.log('\n    ⚠️ 无响应');
  }

  // 4. 验证
  console.log('\n[4] 搜索 game 验证...');
  const searchPayload = {
    action: 'discover',
    request_id: 'req_search_' + Date.now(),
    tags: ['game'],
    limit: 20,
  };

  await request.post(L0_URL + '/messages')
    .set(auth())
    .send({ to_openid: YP_OPENID, client_msg_id: 'search_lobster_' + Date.now(), content: JSON.stringify(searchPayload) })
    .timeout(10000).ok(() => true);

  let searchResp = null;
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    const sync = await request.get(L0_URL + '/messages/sync')
      .set(auth()).query({ since_seq: 0, limit: 20 }).timeout(10000).ok(() => true);
    for (const msg of (sync.body.data?.messages || [])) {
      try { const b = JSON.parse(msg.content); if (b.request_id === searchPayload.request_id) searchResp = b; } catch (_) {}
    }
    if (searchResp) break;
  }

  if (searchResp && searchResp.code === 0) {
    const entries = searchResp.data?.entries || [];
    const found = entries.find(e => e.openid === L1_OPENID);
    if (found) {
      console.log('    🦞 找到了！game 标签共 ' + searchResp.data.total + ' 个服务');
      console.log('    tags: [' + found.tags.join(', ') + ']');
      console.log('    desc: ' + found.description.substring(0, 120) + '...');
      console.log('    heartbeat: ' + (found.last_heartbeat || '无'));
    } else {
      console.log('    ⚠️ ' + entries.length + ' 个结果，未找到龙虾船长');
      entries.forEach(e => console.log('       - [' + (e.tags||[]).join(',') + '] ' + (e.description||'').substring(0, 60)));
    }
  } else {
    console.log('    ⚠️ 搜索无响应, code=' + (searchResp?.code || 'null'));
  }

  // 5. 心跳
  console.log('\n[5] 心跳...');
  const hbPayload = { action: 'heartbeat', request_id: 'req_hb_' + Date.now(), openid: L1_OPENID };
  const { sig: _s3, ...hbForSign } = hbPayload;
  hbPayload.sig = sign(kp.secretKey, canonicalize(hbForSign));

  await request.post(L0_URL + '/messages')
    .set(auth())
    .send({ to_openid: YP_OPENID, client_msg_id: 'hb_lobster_' + Date.now(), content: JSON.stringify(hbPayload) })
    .timeout(10000).ok(() => true);

  let hbResp = null;
  for (let i = 0; i < 5; i++) {
    await sleep(2000);
    const sync = await request.get(L0_URL + '/messages/sync')
      .set(auth()).query({ since_seq: 0, limit: 20 }).timeout(10000).ok(() => true);
    for (const msg of (sync.body.data?.messages || [])) {
      try { const b = JSON.parse(msg.content); if (b.request_id === hbPayload.request_id) hbResp = b; } catch (_) {}
    }
    if (hbResp) break;
  }
  console.log(hbResp?.code === 0 ? '    ✅ 心跳成功' : '    code=' + (hbResp?.code || '无响应'));

  console.log('\n✅ 完成！');
}

main().catch(e => { console.error(e); process.exit(1); });
