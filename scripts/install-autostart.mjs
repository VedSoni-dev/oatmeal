#!/usr/bin/env node
// Registers the Oatmeal recorder (and calendar watcher, if configured) to run
// automatically at login — no admin rights, no permission prompts, nothing
// technical for the user. Run ONCE.
//
//   node scripts/install-autostart.mjs
//   node scripts/install-autostart.mjs --uninstall

import { execFile, spawn } from 'node:child_process'
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
const CALENDAR = join(ROOT, 'scripts', 'calendar-watch.mjs')
const CONFIG = join(ROOT, 'oatmeal.config.json')
const uninstall = process.argv.includes('--uninstall')
const NODE = process.execPath
const wantsCalendar = existsSync(CONFIG)

async function alreadyRunning() {
  try {
    const res = await fetch('http://localhost:4123/api/health', { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

function spawnDetached(script) {
  const child = spawn(NODE, [script], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

async function main() {
  const os = platform()
  if (os === 'win32') await win32(uninstall)
  else if (os === 'darwin') await darwin(uninstall)
  else await linux(uninstall)
}

// --- Windows: a silent .vbs launcher in the Startup folder. No admin, no
// Task Scheduler permissions — this is the same mechanism most consumer apps
// (Discord, Ollama, etc.) use for "start at login". Just a file, no prompts. ---
function startupDir() {
  return join(homedir(), 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup')
}

function vbsLauncher(scriptPath) {
  // WScript.Shell.Run with windowStyle=0 runs it fully hidden (no console flash).
  const escNode = NODE.replace(/"/g, '""')
  const escScript = scriptPath.replace(/"/g, '""')
  return `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run """${escNode}"" ""${escScript}""", 0, False\r\n`
}

async function win32(remove) {
  const dir = startupDir()
  const recorderVbs = join(dir, 'OatmealRecorder.vbs')
  const calendarVbs = join(dir, 'OatmealCalendarWatch.vbs')

  if (remove) {
    await rm(recorderVbs, { force: true })
    await rm(calendarVbs, { force: true })
    console.log('Removed from Startup folder. Restart your PC (or end the node processes) to fully stop them.')
    return
  }

  await mkdir(dir, { recursive: true })
  await writeFile(recorderVbs, vbsLauncher(SERVER))
  console.log(`Installed: ${recorderVbs}`)
  console.log('The recorder will now start automatically every time you log in — no admin rights needed.')

  if (!(await alreadyRunning())) {
    spawnDetached(SERVER)
    console.log('Started now: http://localhost:4123')
  } else {
    console.log('Already running: http://localhost:4123')
  }

  if (wantsCalendar) {
    await writeFile(calendarVbs, vbsLauncher(CALENDAR))
    console.log(`Installed: ${calendarVbs}`)
    spawnDetached(CALENDAR)
    console.log('Calendar watcher started.')
  }
}

// --- macOS: launchd LaunchAgent (user-level, no admin needed) ---
async function darwin(remove) {
  const label = 'com.oatmeal.recorder'
  const calLabel = 'com.oatmeal.calendar'
  const plistPath = join(homedir(), 'Library/LaunchAgents', `${label}.plist`)
  const calPlistPath = join(homedir(), 'Library/LaunchAgents', `${calLabel}.plist`)

  if (remove) {
    await exec('launchctl', ['unload', plistPath]).catch(() => {})
    await exec('launchctl', ['unload', calPlistPath]).catch(() => {})
    await rm(plistPath, { force: true })
    await rm(calPlistPath, { force: true })
    console.log('Removed LaunchAgents.')
    return
  }

  const makePlist = (lbl, script) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${lbl}</string>
  <key>ProgramArguments</key><array><string>${NODE}</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(ROOT, 'capture', 'recorder.log')}</string>
  <key>StandardErrorPath</key><string>${join(ROOT, 'capture', 'recorder.log')}</string>
</dict></plist>`

  await mkdir(dirname(plistPath), { recursive: true })
  await writeFile(plistPath, makePlist(label, SERVER))
  await exec('launchctl', ['unload', plistPath]).catch(() => {})
  await exec('launchctl', ['load', plistPath])
  console.log('Installed — recorder starts at every login, running now: http://localhost:4123')

  if (wantsCalendar) {
    await writeFile(calPlistPath, makePlist(calLabel, CALENDAR))
    await exec('launchctl', ['unload', calPlistPath]).catch(() => {})
    await exec('launchctl', ['load', calPlistPath])
    console.log('Calendar watcher installed and running.')
  }
}

// --- Linux: systemd --user (no root needed) ---
async function linux(remove) {
  const unitDir = join(homedir(), '.config/systemd/user')
  const unitPath = join(unitDir, 'oatmeal-recorder.service')
  const calUnitPath = join(unitDir, 'oatmeal-calendar.service')

  if (remove) {
    await exec('systemctl', ['--user', 'disable', '--now', 'oatmeal-recorder']).catch(() => {})
    await exec('systemctl', ['--user', 'disable', '--now', 'oatmeal-calendar']).catch(() => {})
    await rm(unitPath, { force: true })
    await rm(calUnitPath, { force: true })
    console.log('Removed systemd services.')
    return
  }

  const makeUnit = (desc, script) => `[Unit]
Description=${desc}

[Service]
ExecStart=${NODE} ${script}
Restart=on-failure

[Install]
WantedBy=default.target
`
  await mkdir(unitDir, { recursive: true })
  await writeFile(unitPath, makeUnit('Oatmeal meeting recorder', SERVER))
  await exec('systemctl', ['--user', 'daemon-reload'])
  await exec('systemctl', ['--user', 'enable', '--now', 'oatmeal-recorder'])
  console.log('Installed — recorder starts at every login, running now: http://localhost:4123')

  if (wantsCalendar) {
    await writeFile(calUnitPath, makeUnit('Oatmeal calendar watcher', CALENDAR))
    await exec('systemctl', ['--user', 'daemon-reload'])
    await exec('systemctl', ['--user', 'enable', '--now', 'oatmeal-calendar'])
    console.log('Calendar watcher installed and running.')
  }
}

main().catch((e) => {
  console.error('Autostart install failed:', e.message)
  console.error('Fallback: just run `npm start` in a terminal and leave it open.')
  process.exit(1)
})
