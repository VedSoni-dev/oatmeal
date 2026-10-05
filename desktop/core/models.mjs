export const SPEECH_MODELS = {
  tiny: {
    id: 'Xenova/whisper-tiny.en',
    label: 'Whisper Tiny · English',
    size: '~75 MB',
    task: 'automatic-speech-recognition',
  },
  base: {
    id: 'Xenova/whisper-base',
    label: 'Whisper Base · multilingual',
    size: '~150 MB',
    task: 'automatic-speech-recognition',
  },
  small: {
    id: 'Xenova/whisper-small',
    label: 'Whisper Small · multilingual',
    size: '~500 MB',
    task: 'automatic-speech-recognition',
  },
}
export const TEXT_MODELS = {
  small: {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen 0.5B · lightweight',
    size: '~800 MB',
    task: 'text-generation',
  },
  balanced: {
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    label: 'Qwen 1.5B · better notes',
    size: '~2 GB',
    task: 'text-generation',
  },
}
