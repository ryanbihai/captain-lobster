/**
 * @file index.js (Apps Root)
 * @description 子应用元数据聚合模块。用于在启动时扫描并汇总所有已注册的微服务配置（如 appid, 名称等）。
 */

const fs = require('fs')
const path = require('path')

const apps = {}
// 1. 扫描当前目录下所有的非 .js 文件名（即微服务文件夹）
const folders = fs.readdirSync(__dirname).filter(f => !f.endsWith('.js'))

folders.forEach(folder => {
  // 2. 根据当前环境识别配置文件
  let configName = 'config.json'
  if (process.env.NODE_ENV === 'development') {
    // 优先加载 config-dev.json
    configName = fs.existsSync(path.join(__dirname, folder, 'config-dev.json')) ? 'config-dev.json' : 'config.json'
  }
  
  const configPath = path.join(__dirname, folder, configName)
  if (fs.existsSync(configPath)) {
    // 3. 将微服务的配置元数据载入内存 apps 对象
    apps[folder] = require(configPath)
  }
})

module.exports = apps
