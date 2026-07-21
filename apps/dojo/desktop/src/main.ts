import { createDesktopApp } from '@sensei-hub/desktop-runtime'

// Sensei Dojô — gestão de academia. Janela simples (sem kiosk/placar, sem
// cluster). Portas e banco distintos da arena para os dois rodarem juntos.
createDesktopApp({
  productName: 'Sensei Dojô',
  productSlug: 'dojo',
  appOrigin: 'http://localhost:3100',
  serverPort: 3101,
  webPort: 3100,
  mongoPort: 27117,
  dbName: 'senseihub_dojo',
  replicaSetName: 'dojo-rs',
  features: { kiosk: false, cluster: false },
})
