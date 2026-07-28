import { createDesktopApp } from '@sensei-hub/desktop-runtime'

// Sensei Arena — gestão de campeonato. Leva kiosk (placar/operate/display em
// tela cheia + QR de LAN) e o cluster master/backup declarado (Fase 8, papel
// escolhido uma vez por máquina — ver @sensei-hub/desktop-runtime/machineRole).
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
