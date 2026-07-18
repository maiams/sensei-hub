// Present only when this page is running inside the Sensei Hub launcher
// window (packages/app/src/preload.ts) — absent in a normal browser tab, so
// every call site must check for it before use.
interface SenseiHubKioskBridge {
  openScoreboard: (url: string) => void
  openInBrowser: (url: string) => void
}

interface Window {
  senseiHubKiosk?: SenseiHubKioskBridge
}
