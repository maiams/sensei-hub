import { createEnv } from '@sensei-hub/core-server'

// Porta/DB ainda são os do monolito — mudam para os defaults do produto dojô
// (3101 / senseihub_dojo / dojo-rs) quando o supervisor e o web forem
// parametrizados por produto (E5/E6 do plano de separação).
export const env = createEnv({
  port: 3001,
  mongodbUri: 'mongodb://127.0.0.1:27017/senseihub?replicaSet=sensei-rs',
})
