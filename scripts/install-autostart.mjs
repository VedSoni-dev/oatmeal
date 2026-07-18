#!/usr/bin/env node
// Registers the Oatmeal recorder (and calendar watcher, if configured) to run
// automatically at login, on every OS. Run ONCE. After this, the recorder is
// always running in the background — no agent session needs to stay open.
//
//   node scripts/install-autostart.mjs
//   node scripts/install-autostart.mjs --uninstall

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { platform, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const exec = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SERVER = join(ROOT, 'capture', 'server.mjs')
const uninstall = process.argv.includes('--uninstall')
const NODE = process.execPath

const CONFIG = join(ROOT, 'oatmeal.config.json')
const wantsCalendar = existsSync(CONFIG)

async function main() {
  const os = platform()
  if (os === 'win32') await win32(uninstall)
  else if (os === 'darwin') await darwin(uninstall)
  else await linux(uninstall)
}

// --- Windows: Scheduled Task, trigger "at logon" ---
async function win32(remove) {
  const name = 'OatmealRecorder'
  if (remove) {
    await exec('schtasks', ['/Delete', '/TN', name, '/F']).catch(() => {})
    console.log(`Removed scheduled task "${name}".`)
    return
  }
  const action = `"${NODE}" "${SERVER}"`
  await exec('schtasks', [
    '/Create', '/TN', name, '/TR', action, '/SC', 'ONLOGON',
    '/RL', 'LIMITED', '/F'
  ])
  console.log(`Scheduled task "${name}" created — recorder starts at every login.`)
  await exec('schtasks', ['/Run', '/TN', name]).catch(() => {})
  console.log('Started now. Recorder: http://localhost:4123')

  if (wantsCalendar) {
    const calName = 'OatmealCalendarWatch'
    const calAction = `"${NODE}" "${join(ROOT, 'scripts', 'calendar-watch.mjs')}"`
    await exec('schtasks', [
      '/Create', '/TN', calName, '/TR', calAction, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'
    ])
    await exec('schtasks', ['/Run', '/TN', calName]).catch(() => {})
    console.log(`Scheduled task "${calName}" created — calendar watcher runs at every login.`)
  }
}

// --- macOS: launchd LaunchAgent ---
async function darwin(remove) {
  const label = 'com.oatmeal.recorder'
  const plistPath = join(homedir(), 'Library/LaunchAgents', `${label}.plist`)
  if (remove) {
    await exec('launchctl', ['unload', plistPath]).catch(() => {})
    await rm(plistPath, { force: true })
    console.log('Removed LaunchAgent.')
    return
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${NODE}</string><string>${SERVER}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(ROOT, 'capture', 'recorder.log')}</string>
  <key>StandardErrorPath</key><string>${join(ROOT, 'capture', 'recorder.log')}</string>
</dict></plist>`
  await mkdir(dirname(plistPath), { recursive: true })
  await writeFile(plistPath, plist)
  await exec('launchctl', ['unload', plistPath]).catch(() => {})
  await exec('launchctl', ['load', plistPath])
  console.log('LaunchAgent installed — recorder starts at every login, and is running now.')
  console.log('Recorder: http://localhost:4123')
}

// --- Linux: systemd --user service ---
async function linux(remove) {
  const unitDir = join(homedir(), '.config/systemd/user')
  const unitPath = join(unitDir, 'oatmeal-recorder.service')
  if (remove) {
    await exec('systemctl', ['--user', 'disable', '--now', 'oatmeal-recorder']).catch(() => {})
    await rm(unitPath, { force: true })
    console.log('Removed systemd service.')
    return
  }
  const unit = `[Unit]
Description=Oatmeal meeting recorder

[Service]
ExecStart=${NODE} ${SERVER}
Restart=on-failure

[Install]
WantedBy=default.target
`
  await mkdir(unitDir, { recursive: true })
  await writeFile(unitPath, unit)
  await exec('systemctl', ['--user', 'daemon-reload'])
  await exec('systemctl', ['--user', 'enable', '--now', 'oatmeal-recorder'])
  console.log('systemd --user service installed and started — recorder runs at every login.')
  console.log('Recorder: http://localhost:4123')
}

main().catch((e) => {
  console.error('Autostart install failed:', e.message)
  console.error('You can still run the recorder manually: npm start')
  process.exit(1)
})
