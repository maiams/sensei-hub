import { createEnv } from '@sensei-hub/core-server'

// Defaults do produto dojô — porta e banco distintos da arena para os dois
// rodarem lado a lado na mesma máquina. O replica set single-node continua
// obrigatório (transações do AthleteService).
export const env = createEnv({
  port: 3101,
  mongodbUri: 'mongodb://127.0.0.1:27117/senseihub_dojo?replicaSet=dojo-rs',
})
