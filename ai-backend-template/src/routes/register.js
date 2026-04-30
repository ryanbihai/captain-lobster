/**
 * @file register.js
 * @description 子应用自动化注册器。负责扫描并动态挂载 src/apps 下的所有微服务模块。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('../lib/logSvc.js')(__filename)
const fs = require('fs')
const path = require('path')
const { expressRouter } = require('./api')

// 定义业务子应用库存放路径
const appsDir = path.join(__dirname, '../apps')

/**
 * 【自动装载函数】
 * 遍历 apps 目录，识别合法微服务并将其注入到全局路由树中。
 */
function loadApps() {
  if (!fs.existsSync(appsDir)) return

  // 1. 扫描 apps 目录下所有的物理文件夹
  const folders = fs.readdirSync(appsDir).filter(f => fs.statSync(path.join(appsDir, f)).isDirectory())
  
  folders.forEach(folder => {
    // 2. 环境标识识别 (dev/local/prod)
    let envSuffix = ''
    switch (process.env.NODE_ENV) {
      case 'development': envSuffix = 'dev'; break
      case 'local': envSuffix = 'local'; break
      default: envSuffix = ''; break
    }

    // 3. 配置分级加载：基础 config.json + 环境特定 config-xxx.json
    let config = {}
    const baseConfigPath = path.join(appsDir, folder, 'config.json')
    if (fs.existsSync(baseConfigPath)) {
      config = require(baseConfigPath)
    }
    
    // 如果存在环境覆盖文件，则执行属性合并
    if (envSuffix) {
       const envConfigPath = path.join(appsDir, folder, `config-${envSuffix}.json`)
       if (fs.existsSync(envConfigPath)) {
         config = { ...config, ...require(envConfigPath) }
       }
    }

    /**
     * 4. 路由挂载逻辑：
     * 要求每个子应用必须具备 router.js 文件作为入口。
     */
    const routerPath = path.join(appsDir, folder, 'router.js')
    if (fs.existsSync(routerPath)) {
      // 提取 appid 作为 URL 前缀。优先级：配置定义 > 文件夹名称（剔除数字前缀）
      const appid = config.appid || folder.replace(/^\d+-/, '').toLowerCase()
      
      // 为每个微服务创建一个隔离的 Router 实例
      const moduleRouter = require('express').Router()
      
      // 执行子应用的路由注册回调
      require(routerPath)(moduleRouter)
      
      // 将微服务挂载到主路由网关下
      expressRouter.use(`/${appid}`, moduleRouter)
      
      INFO(`[子应用注册成功] 路径: /api/${appid} -> 物理地址: src/apps/${folder}`)
    }
  })
}

module.exports = { loadApps }
