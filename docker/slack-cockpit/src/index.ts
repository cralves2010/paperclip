import boltPkg from '@slack/bolt'
import { loadConfig } from './config.js'
import { registerHandlers } from './handlers.js'

const { App } = boltPkg

const cfg = loadConfig()
const app = new App({
  token: cfg.slackBotToken,
  appToken: cfg.slackAppToken,
  socketMode: true,
})

registerHandlers(app, cfg)

await app.start()
console.log('⚡ Agent M42 cockpit running (socket mode)')
