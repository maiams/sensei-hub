// Gera o instalador ÚNICO do Sensei Hub para Windows: um .exe que instala os
// dois produtos (Dojô + Arena), com dois atalhos e dois bancos separados.
//
// electron-builder empacota UM app por vez — não existe um "modo dois
// produtos" nativo. A abordagem aqui usa só mecanismos documentados do
// electron-builder (sem `.nsi` escrito do zero, sem makensis manual):
//
//   1) empacota o Dojô com o alvo "dir" do Windows (pasta desempacotada,
//      sem instalador próprio — mais rápido, e é só isso que o passo 2
//      precisa);
//   2) empacota o Arena com o alvo nsis normal, mas com
//      apps/arena/desktop/package.json já configurado para (a) trazer a
//      pasta do Dojô do passo 1 como `win.extraResources` e (b) incluir
//      installer/win/custom.nsh, que copia esses arquivos para Program
//      Files, cria os atalhos do Dojô e libera os dois .exe/mongod.exe no
//      Firewall do Windows durante a instalação (que roda elevada —
//      nsis.perMachine: true).
//
// O instalador final fica em apps/arena/desktop/release/*.exe.
//
// Uso: node scripts/package-installer.mjs [-- <args extras p/ o nsis do arena>]
// Ex.: node scripts/package-installer.mjs -- --x64

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const extraArgsIndex = process.argv.indexOf('--')
const extraArgs = extraArgsIndex === -1 ? [] : process.argv.slice(extraArgsIndex + 1)

function run(cmd, args) {
  console.log(`\n[package-installer] $ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
}

console.log('[package-installer] 1/2 — empacotando Sensei Dojô (pasta --win dir, sem instalador próprio)')
run('node', [path.join(ROOT, 'scripts', 'package-app.mjs'), 'dojo', '--', '--win', 'dir', ...extraArgs])

console.log('[package-installer] 2/2 — empacotando Sensei Arena (instalador NSIS único, embute o Dojô)')
run('node', [path.join(ROOT, 'scripts', 'package-app.mjs'), 'arena', '--', '--win', ...extraArgs])

console.log(
  '\n[package-installer] concluído — instalador único em apps/arena/desktop/release/*.exe ' +
    '(instala Dojô + Arena, dois atalhos, dois bancos).\n' +
    '[package-installer] NÃO TESTADO em Windows real — ver docs/deploy-windows.md.',
)
