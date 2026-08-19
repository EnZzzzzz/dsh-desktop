/// <reference types="vite/client" />
import type { DshBridge } from '../../shared/ipc'

declare global {
  interface Window {
    dsh: DshBridge
  }
}

export {}
