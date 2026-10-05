const { contextBridge, ipcRenderer } = require('electron')
const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result.error) {
    const error = new Error(result.error)
    error.actionUrl = result.actionUrl
    throw error
  }
  return result.value
}
const events = new Set([
  'meeting:updated',
  'capture:queue',
  'model:progress',
  'auth:updated',
  'app:error',
  'app:new-meeting',
  'app:settings',
])
contextBridge.exposeInMainWorld('oatmeal', {
  bootstrap: () => call('app:bootstrap'),
  createMeeting: (title) => call('meeting:create', title),
  saveMeeting: (data) => call('meeting:save', data),
  exportMeeting: (id) => call('meeting:export', id),
  importMeetings: () => call('meeting:import'),
  saveSettings: (data) => call('settings:save', data),
  loadModel: (data) => call('model:load', data),
  startCapture: (id) => call('capture:start', id),
  sendChunk: (data) => call('capture:chunk', data),
  stopCapture: (id) => call('capture:stop', id),
  recoverAudio: () => call('capture:recover'),
  generate: (data) => call('meeting:generate', data),
  ask: (data) => call('meeting:ask', data),
  login: (provider) => call('auth:login', provider),
  authStatus: (provider) => call('auth:status', provider),
  logout: (provider) => call('auth:logout', provider),
  openLink: (url) => call('app:open-link', url),
  openData: () => call('app:open-data'),
  on: (channel, callback) => {
    if (!events.has(channel)) throw new Error('Unsupported event')
    const listener = (_, value) => callback(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
