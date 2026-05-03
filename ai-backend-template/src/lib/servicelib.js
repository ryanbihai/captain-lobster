/**
 * @file servicelib.js
 * @description 业务逻辑基类。提供 Service 层的标准化抽象，包括配置自动获取、方法异常自动包裹等 AOP 特性。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./logSvc.js')(__filename)

/**
 * 【Service 基类】
 * 建议所有 src/apps/子目录/service.js 中的类均继承此类
 */
class Service {
  /**
   * 构造函数：注入当前模块的上下文信息
   * @param {Object} opts 包含 __dirname, __filename, module 等
   */
  constructor(opts) {
    this.dir = opts.__dirname   // 业务代码所在目录
    this.file = opts.__filename // 业务代码物理路径
    this.module = opts.module   // Node.js module 对象
  }

  /**
   * 【获取业务配置】
   * 自动感知当前的实时配置。未来可扩展为根据微服务目录名自动裁剪配置子集。
   * @returns {Object}
   */
  getConfig() {
    return global.realtime_config || {}
  }

  /**
   * 【获取应用级配置】
   * 自动加载当前应用目录下的 config.json 及其对应的环境变体文件。
   * @returns {Object}
   */
  getAppConfig() {
    // 缓存配置，避免重复的文件 IO
    if (this._appConfig) return this._appConfig;

    const fs = require('fs');
    const path = require('path');
    let envSuffix = '';

    switch (process.env.NODE_ENV) {
      case 'development': envSuffix = 'dev'; break;
      case 'local': envSuffix = 'local'; break;
      default: envSuffix = ''; break;
    }

    let config = {};
    const baseConfigPath = path.join(this.dir, 'config.json');
    if (fs.existsSync(baseConfigPath)) {
      // 使用 fs.readFileSync 配合 JSON.parse 替代 require 以避免 Node.js 的模块缓存
      config = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
    }

    if (envSuffix) {
      const envConfigPath = path.join(this.dir, `config-${envSuffix}.json`);
      if (fs.existsSync(envConfigPath)) {
        const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
        config = { ...config, ...envConfig };
      }
    }

    this._appConfig = config;
    return config;
  }

  /**
   * 【导出增强器 (AOP)】
   * 遍历 module.exports 中的函数，自动为其包裹 try-catch 拦截器。
   * 目的：确保 Service 层抛出的异常都能被记录并转化为标准错误返回，而不是导致进程崩溃。
   */
  exportMe() {
    const exportsObj = this.module.exports
    for (const key in exportsObj) {
      if (typeof exportsObj[key] === 'function' && key !== 'exportMe' && key !== 'getConfig') {
        const original = exportsObj[key]
        
        // 使用 async 包装，确保支持异步调用拦截
        exportsObj[key] = async (...args) => {
          try {
            // 执行原始业务函数并保留 this 指向
            return await original.apply(this, args)
          } catch(err) {
            // 异常统一捕获点：记录到日志系统并返回错误码
            EXCEPTION(`[Service 执行异常] Method: ${key}, Error: ${err.message}`)
            return { code: -1, msg: err.message, data: {} }
          }
        }
      }
    }
  }
}

module.exports = { Service }
