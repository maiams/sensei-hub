// Orquestra tudo que o electron-builder de um produto espera encontrar já
// pronto no disco: build de shared/server/web, `pnpm deploy` do server
// (node_modules self-contained), cópia manual dos assets estáticos do Next
// standalone (Next não faz isso sozinho) e os binários do mongod (baixados
// uma vez, cacheados em resources/mongodb/ — ver scripts/fetch-mongodb.mjs).
//
// Uso: node scripts/package-app.mjs <dojo|arena> [-- <args para electron-builder>]
// Ex.: node scripts/package-app.mjs arena -- --mac
//      node scripts/package-app.mjs dojo -- --mac --linux

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const product = process.argv[2]
if (product !== 'dojo' && product !== 'arena') {
  console.error('[package-app] informe o produto: node scripts/package-app.mjs <dojo|arena> [-- <electron-builder args>]')
  process.exit(1)
}

const SHARED_PKG = product === 'dojo' ? '@dojo/shared' : '@arena/shared'
const SERVER_PKG = `@${product}/server`
const WEB_PKG = `@${product}/web`
const DESKTOP_PKG = `@${product}/desktop`

const WEB_DIR = path.join(ROOT, 'apps', product, 'web')
const SERVER_DIR = path.join(ROOT, 'apps', product, 'server')
const DESKTOP_DIR = path.join(ROOT, 'apps', product, 'desktop')

const extraArgsIndex = process.argv.indexOf('--')
const builderArgs = extraArgsIndex === -1 ? [] : process.argv.slice(extraArgsIndex + 1)

function run(cmd, args, cwd = ROOT) {
  console.log(`\n[package-app] $ ${cmd} ${args.join(' ')}  (cwd=${path.relative(ROOT, cwd) || '.'})`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

console.log(`[package-app] produto: ${product}`)

console.log(`[package-app] 1/6 — build shared (${SHARED_PKG} + core-server)`)
run('pnpm', ['--filter', SHARED_PKG, '--filter', '@sensei-hub/shared', '--filter', '@sensei-hub/core-server', 'build'])

console.log(`[package-app] 2/6 — build ${SERVER_PKG}`)
run('pnpm', ['--filter', SERVER_PKG, 'build'])

console.log(`[package-app] 3/6 — pnpm deploy ${SERVER_PKG} (node_modules self-contained)`)
const serverDeployDir = path.join(SERVER_DIR, 'deploy')
rmSync(serverDeployDir, { recursive: true, force: true })
run('pnpm', ['--filter', SERVER_PKG, 'deploy', '--prod', '--legacy', serverDeployDir])

// `pnpm deploy --legacy` deixa o marcador de produção do workspace ativo;
// re-afirmar dev+prod evita que o próximo `pnpm --filter` tente reinstalar
// em modo --production (que aborta sem TTY). Ver histórico deste script.
run('pnpm', ['install', '--config.confirmModulesPurge=false', '--prod=false'])

console.log(`[package-app] 4/6 — build ${WEB_PKG} (Next standalone) + copiar static/public`)
run('pnpm', ['--filter', WEB_PKG, 'build'])
const standaloneWebDir = path.join(WEB_DIR, '.next', 'standalone', 'apps', product, 'web')
if (!existsSync(standaloneWebDir)) {
  throw new Error(
    `Não encontrei ${path.relative(ROOT, standaloneWebDir)} — a estrutura do output do ` +
      '"output: standalone" do Next mudou? Confira antes de seguir.',
  )
}
mkdirSync(path.join(standaloneWebDir, '.next', 'static'), { recursive: true })
cpSync(path.join(WEB_DIR, '.next', 'static'), path.join(standaloneWebDir, '.next', 'static'), { recursive: true })
cpSync(path.join(WEB_DIR, 'public'), path.join(standaloneWebDir, 'public'), { recursive: true })

console.log('[package-app] 5/6 — garantir binários do mongod (resources/mongodb/, baixa só o que faltar)')
run('node', [path.join(ROOT, 'scripts', 'fetch-mongodb.mjs')])

console.log(`[package-app] 6/6 — build + electron-builder (${DESKTOP_PKG})`)
run('pnpm', ['--filter', DESKTOP_PKG, 'build'])
run('pnpm', ['--filter', DESKTOP_PKG, 'exec', 'electron-builder', ...builderArgs], DESKTOP_DIR)

console.log(`\n[package-app] concluído — ver apps/${product}/desktop/release/ para os instaladores.`)
