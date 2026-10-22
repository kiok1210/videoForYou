import type { RecorderApi } from './index'

declare global {
  interface Window {
    api: RecorderApi
  }
}

export {}
