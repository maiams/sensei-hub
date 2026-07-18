// Baixa os binários oficiais do mongod (MongoDB Community Server, SSPL —
// redistribuir o binário empacotado é prática comum, ex. Compass) para os
// alvos suportados pelo electron-builder (packages/app/package.json) e grava
// só o executável `mongod` em resources/mongodb/<target>/ — nada mais do
// tarball (mongosh, ferramentas, etc. não são usados pelo Supervisor).
//
// Versão fixada em 8.2.6 para bater com o que o resto do projeto já testa
// contra via mongodb-memory-server (ver docs/status-e-plano.md).
//
// Linux: só existe binário oficial por distro/versão de glibc, não um
// tarball genérico. ubuntu2204 (glibc novo o bastante) cobre a maioria das
// distros modernas, mas não é universal — ver ressalva no status-e-plano.md.
//
// Uso: node scripts/fetch-mongodb.mjs [--force]

import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync, chmodSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MONGODB_VERSION = '8.2.6'
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const RESOURCES_DIR = path.join(ROOT, 'resources', 'mongodb')
const FORCE = process.argv.includes('--force')

const TARGETS = [
  {
    id: 'mac-arm64',
    url: `https://fastdl.mongodb.org/osx/mongodb-macos-arm64-${MONGODB_VERSION}.tgz`,
    archive: 'tgz',
    binaryName: 'mongod',
  },
  {
    id: 'mac-x64',
    url: `https://fastdl.mongodb.org/osx/mongodb-macos-x86_64-${MONGODB_VERSION}.tgz`,
    archive: 'tgz',
    binaryName: 'mongod',
  },
  {
    id: 'linux-x64',
    url: `https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-${MONGODB_VERSION}.tgz`,
    archive: 'tgz',
    binaryName: 'mongod',
  },
  {
    id: 'win-x64',
    url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${MONGODB_VERSION}.zip`,
    archive: 'zip',
    binaryName: 'mongod.exe',
  },
]

function extractTgz(archivePath, memberSuffix, destFile) {
  const listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
  const member = listing.split('\n').find((line) => line.endsWith(memberSuffix))
  if (!member) throw new Error(`Não encontrei "${memberSuffix}" dentro de ${archivePath}`)
  const out = execFileSync('tar', ['-xzf', archivePath, '-O', member], { maxBuffer: 1024 * 1024 * 512 })
  writeFileSync(destFile, out)
}

function extractZip(archivePath, memberSuffix, destFile) {
  const listing = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
  const member = listing.split('\n').find((line) => line.endsWith(memberSuffix))
  if (!member) throw new Error(`Não encontrei "${memberSuffix}" dentro de ${archivePath}`)
  const tmpExtractDir = path.join(tmpdir(), `mongodb-unzip-${Date.now()}`)
  mkdirSync(tmpExtractDir, { recursive: true })
  execFileSync('unzip', ['-q', archivePath, member, '-d', tmpExtractDir])
  renameSync(path.join(tmpExtractDir, member), destFile)
  rmSync(tmpExtractDir, { recursive: true, force: true })
}

async function fetchTarget(target) {
  const destDir = path.join(RESOURCES_DIR, target.id)
  const destFile = path.join(destDir, target.binaryName)

  if (existsSync(destFile) && !FORCE) {
    console.log(`[fetch-mongodb] ${target.id}: já existe, pulando (use --force para refazer)`)
    return
  }

  mkdirSync(destDir, { recursive: true })
  const tmpArchive = path.join(tmpdir(), `mongodb-${target.id}-${Date.now()}.${target.archive === 'zip' ? 'zip' : 'tgz'}`)

  console.log(`[fetch-mongodb] ${target.id}: baixando ${target.url}`)
  const res = await fetch(target.url)
  if (!res.ok) throw new Error(`Download falhou (${res.status}): ${target.url}`)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(tmpArchive, Buffer.from(await res.arrayBuffer()))

  console.log(`[fetch-mongodb] ${target.id}: extraindo ${target.binaryName}`)
  const memberSuffix = `bin/${target.binaryName}`
  if (target.archive === 'tgz') {
    extractTgz(tmpArchive, memberSuffix, destFile)
  } else {
    extractZip(tmpArchive, memberSuffix, destFile)
  }
  rmSync(tmpArchive, { force: true })

  if (target.archive !== 'zip' || !target.binaryName.endsWith('.exe')) {
    chmodSync(destFile, 0o755)
  }

  console.log(`[fetch-mongodb] ${target.id}: pronto em ${path.relative(ROOT, destFile)}`)
}

for (const target of TARGETS) {
  await fetchTarget(target)
}

console.log('[fetch-mongodb] concluído.')
