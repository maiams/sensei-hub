import { createDesktopApp } from '@sensei-hub/desktop-runtime'

// Sensei Arena — gestão de campeonato. Leva kiosk (placar/operate/display em
// tela cheia + QR de LAN) e o cluster mDNS (Fase 7, opt-in via CLUSTER_ENABLED).
createDesktopApp({
  productName: 'Sensei Arena',
  productSlug: 'arena',
  appOrigin: 'http://localhost:3000',
  serverPort: 3001,
  webPort: 3000,
  mongoPort: 27017,
  dbName: 'senseihub_arena',
  replicaSetName: 'sensei-rs',
  features: { kiosk: true, cluster: true },
})
