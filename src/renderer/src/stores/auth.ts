import { create } from 'zustand'
import type { AuthState } from '@shared/types'

interface AuthStore {
  auth: AuthState
  set: (auth: AuthState) => void
}

export const useAuth = create<AuthStore>((set) => ({
  auth: { state: 'unknown' },
  set: (auth) => set({ auth })
}))

declare global {
  interface Window {
    __authWired?: boolean
  }
}

if (!window.__authWired) {
  window.__authWired = true
  window.api.on('auth:state', (auth) => useAuth.getState().set(auth))
  void window.api.invoke('auth:getState').then((auth) => useAuth.getState().set(auth))
}
