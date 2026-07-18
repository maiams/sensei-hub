// Orquestra tudo que packages/app/package.json's `build.extraResources`
// espera encontrar já pronto no disco antes de rodar electron-builder:
// build de shared/server/web, `pnpm deploy` do server (node_modules
// self-contained), cópia manual dos assets estáticos do Next standalone
// (Next não faz isso sozinho) e os binários do mongod (baixados uma vez,
// cacheados em resources/mongodb/ — ver scripts/fetch-mongodb.mjs).
//
// Uso: node scripts/package-app.mjs [-- <args para electron-builder>]
// Ex.: node scripts/package-app.mjs -- --mac
//      node scripts/package-app.mjs -- --mac --linux
//      node scripts/package-app.mjs -- --win  (precisa de Wine fora do Windows)

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const WEB_DIR = path.join(ROOT, 'packages', 'web')
const SERVER_DIR = path.join(ROOT, 'packages', 'server')
const APP_DIR = path.join(ROOT, 'packages', 'app')

const extraArgsIndex = process.argv.indexOf('--')
const builderArgs = extraArgsIndex === -1 ? [] : process.argv.slice(extraArgsIndex + 1)

function run(cmd, args, cwd = ROOT) {
  console.log(`\n[package-app] $ ${cmd} ${args.join(' ')}  (cwd=${path.relative(ROOT, cwd) || '.'})`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

console.log('[package-app] 1/6 — build @sensei-hub/shared')
run('pnpm', ['--filter', '@sensei-hub/shared', 'build'])

console.log('[package-app] 2/6 — build @sensei-hub/server')
run('pnpm', ['--filter', '@sensei-hub/server', 'build'])

console.log('[package-app] 3/6 — pnpm deploy @sensei-hub/server (node_modules self-contained)')
const serverDeployDir = path.join(SERVER_DIR, 'deploy')
rmSync(serverDeployDir, { recursive: true, force: true })
run('pnpm', ['--filter', '@sensei-hub/server', 'deploy', '--prod', '--legacy', serverDeployDir])

// `pnpm deploy --legacy` leaves the ROOT workspace's
// node_modules/.pnpm-workspace-state-v1.json marked production-only
// (settings.production=true, settings.dev=false) even though it only
// deployed into a separate directory. Every subsequent `pnpm --filter`
// command then runs its own pre-flight "deps status check", sees the root
// node_modules (which still has devDependencies) doesn't match that
// production-only marker, and tries to silently reinstall with
// `--production` — which then aborts asking to confirm a purge (no TTY
// here). Re-asserting the real settings (both dev AND prod deps wanted)
// clears the marker before anything else reads it.
run('pnpm', ['install', '--config.confirmModulesPurge=false', '--prod=false'])

console.log('[package-app] 4/6 — build @sensei-hub/web (Next standalone) + copiar static/public')
run('pnpm', ['--filter', '@sensei-hub/web', 'build'])
const standaloneWebDir = path.join(WEB_DIR, '.next', 'standalone', 'packages', 'web')
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

console.log('[package-app] 6/6 — build + electron-builder (@sensei-hub/app)')
run('pnpm', ['--filter', '@sensei-hub/app', 'build'])
run('pnpm', ['--filter', '@sensei-hub/app', 'exec', 'electron-builder', ...builderArgs], APP_DIR)

console.log('\n[package-app] concluído — ver packages/app/release/ para os instaladores.')
