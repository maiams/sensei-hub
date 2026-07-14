# Sensei Hub — Status de Implementação e Plano de Desenvolvimento

**Gerado em:** 2026-07-01
**Atualizado em:** 2026-07-13 (Fase 2 — backend concluído)
**Propósito:** Documento de referência técnica. Descreve o que foi implementado, as decisões tomadas, e o plano detalhado para as fases seguintes. É a fonte de verdade para quem for implementar as próximas fases — leia a seção 6 (Convenções) antes de escrever código.

---

## 1. Visão Geral do Produto

Sensei Hub é uma plataforma **local-first** para gestão de academias de judô e condução de competições. Opera em hardware limitado (Celeron/i3, 4GB RAM), em redes WiFi de ginásio com conectividade instável, sem dependência de internet.

**Modelo de operação:** cada laptop rodando o Sensei Hub é simultaneamente servidor (API + banco de dados) e cliente (browser embutido). Um nó é eleito primary pelo protocolo Raft do MongoDB; os demais são secondary com failover automático.

**Documento de arquitetura completo:** `docs/arquitetura.md`
**Auditoria arquitetural externa:** `docs/auditoria-arquitetura-2026-07-01.md`
**Regras do projeto:** `CLAUDE.md`
**Referências de bracket (chaves de luta):** `docs/zempo-modelos/`

---

## 2. Stack Técnica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Runtime | Node.js | 26.x (dev); 24 LTS (produção — target do bootstrap.sh) |
| Linguagem | TypeScript | 5.9.x |
| Backend | Fastify | 5.x |
| Banco de dados | MongoDB | 7.x (Replica Set) |
| ODM | Mongoose | 8.x |
| Frontend | Next.js | 15.x (App Router) |
| Estilo | Tailwind CSS | 4.x |
| Validação | Zod | 3.x |
| Desktop shell | Electron | 36.x |
| Monorepo | pnpm workspaces + Turborepo | pnpm 11.9 / turbo 2.10 |
| Testes | Vitest 3.x + mongodb-memory-server | |

---

## 3. Estrutura do Repositório

```
sensei-hub/
├── packages/
│   ├── shared/              # Tipos TypeScript + schemas Zod compartilhados
│   │   └── src/domain/      # athlete.ts, bracket.ts, event.ts, scoreboard.ts, user.ts
│   ├── server/              # API Fastify 5
│   │   └── src/
│   │       ├── config/      # env.ts, database.ts
│   │       ├── middleware/  # authenticate.ts, authorize.ts
│   │       ├── repositories/# Models Mongoose (UserModel, AcademyModel, ...)
│   │       ├── services/    # AuthService, UserService, ...
│   │       ├── routes/      # auth.ts, users.ts, setup.ts, health.ts
│   │       └── __tests__/   # Testes de integração (app.inject + memory server)
│   ├── web/                 # Next.js 15 (frontend PWA)
│   └── app/                 # Electron (supervisor de processos + kiosk)
├── docs/
│   ├── arquitetura.md
│   ├── status-e-plano.md    # Este documento
│   └── zempo-modelos/       # Referências de formatos de bracket e cadastro
├── docker-compose.yml       # 3 nós MongoDB em replica set (dev)
├── turbo.json
├── tsconfig.base.json
└── pnpm-workspace.yaml
```

---

## 4. Estado Atual — O Que Está Implementado

### Fase 0 — Fundação (concluída, commit `11a0bb6`)

- Monorepo pnpm + Turborepo com 4 pacotes; `tsconfig.base.json` com `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- `packages/shared`: todos os tipos de domínio em Zod com inferência TypeScript — `athlete.ts`, `event.ts`, `bracket.ts`, `scoreboard.ts`, `user.ts` (9 roles + `ROLE_HIERARCHY` + `hasMinRole()`)
- `packages/server`: `env.ts` (Zod, aborta se inválido), `database.ts` (writeConcern majority, heartbeat 2s), `buildApp()`, rota `/api/health`
- `packages/web`: App Router, rewrite `/api/*` → `localhost:3001`, Tailwind 4
- `packages/app`: `Supervisor` (spawna mongod + server, health loop 5s, restart após 3 falhas, shutdown gracioso) e kiosk (`BrowserWindow` fullscreen, bloqueio de devtools/navegação, saída de emergência `Ctrl+Alt+Shift+Q`)
- `docker-compose.yml`: 3 nós MongoDB 7 em replica set com init idempotente

### Fase 0.5 — Correções pós-auditoria (concluída)

- Bugs do supervisor corrigidos (restart lock, ordem de shutdown)
- `bracket.ts` refeito como discriminated union por formato
- DTOs de request/response separados dos schemas de domínio no shared

### Fase 1 — Auth + RBAC + First-Run Setup (concluída, aguardando commit)

**Models** (`packages/server/src/repositories/`):
- `UserModel` — `passwordHash` com `select: false`, email unique lowercase, índice `{ academyId, role }`
- `AcademyModel` — name + slug unique
- `RefreshTokenModel` — armazena SHA-256 do token, índice TTL em `expiresAt`
- `AuditLogModel` — userId, entityType/entityId, action, fieldName, oldValue/newValue, reason, sessionId, ip

**Serviços** (`packages/server/src/services/`):
- `AuthService` — login (bcrypt com hash dummy para normalizar timing), refresh com rotation (token antigo deletado antes de emitir novo), logout. Access token JWT HS256 15min com payload `{ sub, academyId, role }`; refresh token 32 bytes aleatórios, TTL 7 dias
- `UserService` — createUser (bloqueia criar role superior à do criador, grava audit log), listUsers (DTO sem passwordHash), changePassword

**Middleware:** `authenticate` (injeta `request.authUser: { id, academyId, role }`), `authorize(minRole)` (fábrica, compara via `ROLE_HIERARCHY`)

**Rotas:** `POST /api/auth/login|refresh|logout`, `POST /api/users` (academy_admin+), `GET /api/users` (coach+), `GET /api/setup/status`, `POST /api/setup`

**Web:** página `/setup` (first-run)

**Testes:** `__tests__/auth.test.ts` — integração via `app.inject()` + mongodb-memory-server (helpers em `__tests__/helpers/db.ts`)

**Decisões tomadas na Fase 1 que divergem do plano original (registradas aqui como definitivas):**

1. **First-run setup em vez de `POST /api/academies`.** A primeira academia + primeiro usuário (super_admin) são criados por `POST /api/setup`, rota pública bloqueada com 409 assim que existe uma academia. Rotas de CRUD de academia ficam adiadas até o produto multi-academia (pós-Fase 7). Não implementar `POST /api/academies` antes disso.
2. **Audit log explícito nos services, sem middleware mágico.** O hook genérico `onSend` planejado foi descartado: cada service grava `AuditLogModel.create()` explicitamente nas mutações que exigem trilha. Mais verboso, porém auditável e testável. Manter esse padrão nas próximas fases.
3. **Erros tipados por service.** Cada service define sua classe de erro com `statusCode` (`AuthError`, `UserServiceError`); a rota captura e converte em resposta HTTP. Manter.

### Pendências pequenas da Fase 1 (concluídas em 2026-07-13)

- [x] Rota `PATCH /api/users/me/password` — expõe `UserService.changePassword`, testada (401 sem token, 401 senha antiga errada, 400 senha nova curta, 204 + relogin com senha nova)
- [x] Testes do `authorize` middleware isolado (`__tests__/authorize.test.ts`: sem `authUser` → 401, role insuficiente → 403, role igual/superior → passa)
- [x] Commit da Fase 1

### Fase 2 — Concluída em 2026-07-14 (backend + UI mínima)

**Implementado:**
- `AgeClassService` (puro, sem I/O): `calculateAgeClass`, `getWeightCategories`, `assignWeightCategory` — 33 testes cobrindo limites exatos de idade e categorias de peso
- Models: `AthleteModel` (CPF único parcial por academia, `medical` subdocumento com `select:false`), `GuardianModel` (1 por atleta no MVP), `BeltRecordModel`, `WeightRecordModel`; `AcademyModel` ganhou `athleteSeq` para gerar `enrollmentNumber` atomicamente
- `AthleteService`: create (guardian atômico via `mongoose.session.withTransaction` quando menor), get (filtra dados médicos por role), list (paginado + busca), update (audit log por campo), deactivate (soft delete), belt records, guardian CRUD
- `WeightService`: `recordWeight`, `correctWeight` (append-only, nunca altera original)
- Rotas `/api/athletes/*` completas conforme especificado abaixo, registradas em `app.ts`
- `isValidCPF` (dígitos verificadores) adicionado em `packages/shared/src/domain/cpf.ts`
- Helper de teste `db.ts` migrado para `MongoMemoryReplSet` (era `MongoMemoryServer` standalone) — necessário porque `AthleteService.createAthlete` usa transação, que exige replica set
- 74 testes passando no total (server), typecheck limpo em todos os pacotes

**Decisões tomadas nesta fase (divergências/adições ao plano original):**

1. **Limites de idade das classes de base e tabela de categorias de peso corrigidos com fonte oficial FPJ (2026-07-14).** A primeira versão deste serviço usava limites de idade e pesos reconstruídos sem fonte primária (ver histórico do commit anterior). O usuário forneceu a "Tabela de Classes e Categorias 2026" da Federação Paulista de Judô (v2, 03/02/2026, https://fpj.com.br — declarada "conforme tabela da CBJ"), que foi extraída e usada para corrigir `AgeClassService.ts`:
   - Limites de idade: Sub-09 (7-8) = `pre_mirim`, Sub-11 (9-10) = `mirim`, Sub-13 (11-12) = `infantil`, Sub-15 (13-14) = `infanto_juvenil`, Cadete/Sub-18 (15-17) = `juvenil`. Isso muda os limites anteriores (que usavam faixas de 2 anos uniformes a partir de 7).
   - Tabela de peso completa (masculino/feminino) para todas as classes de base, substituindo o erro explícito anterior.
   - `junior`/`senior`/`veteran_*` continuam sendo a partição deste codebase para a faixa "Adulto" única da tabela FPJ (que não subdivide por idade, só por peso) — mantido o limite 21–29 para sênior como suposição própria, sem contradição da fonte.
2. **Categorias de peso são um *default*, não uma regra rígida.** O usuário apontou que campeonatos pequenos frequentemente precisam mesclar categorias esparsas (ex.: unir Pesado + Super Pesado de uma classe de base quando não há atletas suficientes para preencher as duas). Isso já é suportado pelo design existente: `DivisionModel` da Fase 3A é criado manualmente por evento com `weightLimitKg` livre — a tabela do `AgeClassService` serve apenas para pré-preencher o formulário de criação de divisões, não para validar/bloquear. Nenhuma mudança de código adicional necessária agora; documentado como intenção de design para quem implementar a Fase 3A.
3. **`enrollmentNumber` gerado via contador atômico em `AcademyModel.athleteSeq`** (`findByIdAndUpdate($inc)`), não via UUID — mais legível para operação de balcão, e atômico mesmo sob concorrência.
4. **Guardian é 1:1 com atleta no MVP** (índice único em `athleteId`). `POST /guardian` retorna 409 se já existe um; não há endpoint de atualização de guardian nesta fase — cobrir depois se necessário.
5. **Helper de teste passou a subir um replica-set de 1 nó** (`MongoMemoryReplSet`) em vez de standalone, para suportar `session.withTransaction()` usado na criação atômica de atleta+guardian. Mais fiel à topologia de produção.

**UI mínima implementada (2026-07-14):**
- `/login` — formulário e-mail/senha, tokens salvos em `localStorage`, redireciona para `/athletes`
- `/athletes` — lista com busca (nome/CPF/matrícula), link para cadastro
- `/athletes/new` — formulário de cadastro com seção condicional de responsável (aparece quando `birthDate` indica menor de 18)
- `/athletes/[id]` — perfil com dados, responsável (se houver), histórico de faixa e peso com formulários inline para registrar novos
- `/athletes/[id]/edit` — mesmo formulário de cadastro em modo edição (sem seção de responsável — guardian não é editável por aqui)
- `packages/web/src/lib/api.ts` — `apiFetch()` com refresh silencioso de token em 401 (tenta 1x antes de redirecionar a `/login`)
- `packages/web/src/lib/labels.ts` — labels PT-BR para enums e tradução de mensagens de erro da API

**Bugs encontrados e corrigidos durante o teste manual (Playwright) desta UI:**
1. **Tailwind não compilava nenhuma classe utilitária — faltava `packages/web/postcss.config.mjs`.** Esse arquivo nunca existiu desde a Fase 0; `@tailwindcss/postcss` estava como devDependency mas sem configuração do PostCSS, então `next dev`/`next build` nunca geravam as classes. Afetava todas as páginas já existentes (`/setup` também rodava sem estilo), não só as novas. Também foi necessário adicionar `@source "../**/*.{ts,tsx}"` em `globals.css` porque a detecção automática de conteúdo do Tailwind v4 não encontrava os arquivos `.tsx` neste monorepo pnpm.
2. **Label de parentesco do responsável mostrava o valor bruto do enum** (`mother`) em vez de "Mãe" no perfil do atleta — faltava aplicar `GUARDIAN_RELATIONSHIP_LABELS`.
3. **Mensagens de erro da API apareciam em inglês** (`Invalid CPF`) numa UI em português — adicionado `translateApiError()` em `lib/labels.ts` com tradução das mensagens conhecidas dos services.
4. `next lint`/`next dev` reescrevem `tsconfig.json` automaticamente na primeira execução (comportamento padrão do Next 15, não é bug do projeto) — mantidas apenas as chaves necessárias (`allowJs`, `incremental`, `resolveJsonModule`, `isolatedModules`), revertida a reformatação cosmética dos arrays.

**Verificação:** fluxo completo testado manualmente via Playwright contra um servidor real (Fastify + MongoDB replica-set efêmero, sem Docker disponível no ambiente) — setup → login → cadastro de atleta adulto → registro de peso → cadastro de atleta menor com responsável (seção condicional confirmada) → edição → busca na lista. Typecheck limpo em `shared`, `server`, `web`, `app`.

**Pendente da Fase 2:**
- [ ] Confirmar com o usuário se outras federações/estados usam tabela diferente da FPJ para o caso de a academia competir fora de SP

### Adendo à Fase 2 (2026-07-14, v1 — SUPERADA, ver v2 abaixo) — Categorias de peso editáveis por academia

> **Esta versão foi substituída poucas horas depois pela v2 (mesma data, seção seguinte).** O usuário simplificou ainda mais o pedido: em vez de 6 grupos fixos com Masculino/Feminino fixo, as divisões e seus grupos viraram totalmente livres (nome livre, idade livre, qualquer número de grupos por divisão, cada grupo com nome livre). Mantido aqui só como histórico da decisão intermediária.

O usuário apontou que a tabela de `AgeClassService` (hardcoded, sem persistência) precisava ser editável — campeonatos pequenos frequentemente têm dificuldade de preencher certas categorias (ex.: Sub-13 nas categorias mais pesadas) e precisam mesclar faixas. Pediu explicitamente uma UI em grid.

**Implementado:**
- `packages/shared/src/domain/weightCategory.ts`: `WeightCategoryRow`, `UpdateWeightCategoriesInput`, `WeightCategoryGroupDTO`, `AGE_CLASS_GROUPS` — agrupa as 12 `AgeClass` em 6 unidades editáveis (pré-mirim, mirim, infantil, infanto-juvenil, juvenil ficam sozinhas; júnior+sênior+veteranos viram um único grupo "Adulto", espelhando como a fonte FPJ e o default já tratavam essa faixa).
- `WeightCategoryModel` (Mongoose): override por `academyId + gender + ageClass`, índice único.
- `WeightCategoryService`: `listGroups` (mescla override com o default do `AgeClassService`, marca `isDefault`), `updateGroup` (valida ordem estritamente ascendente e que só a última categoria pode ser aberta/`maxKg: null`; grava em todas as `ageClasses` do grupo; audit log com `oldValue`/`newValue`), `resetGroup` (apaga o override, volta ao default; audit log), `getEffectiveCategories` (para uso futuro da Fase 3A ao pré-preencher divisões).
- Rotas `GET/PUT/DELETE /api/weight-categories(/:groupKey/:gender)` — leitura `staff+`, escrita `academy_admin` (autorização real no servidor).
- `/settings/weight-categories`: página com um grid por grupo × gênero (12 grids), linhas editáveis (nome + até quantos kg), adicionar/remover categoria, salvar, restaurar padrão. Controles de edição escondidos para quem não é `academy_admin` (decodificação do JWT no cliente só para UX — nunca para autorização).
- Link de acesso adicionado no cabeçalho de `/athletes`.
- 9 testes novos em `weightCategory.test.ts` (97 no total do pacote server).

**Bugs encontrados e corrigidos durante o teste manual desta feature:**
1. **`apiFetch()` sempre enviava `Content-Type: application/json` mesmo em requests sem corpo** (o `DELETE` de restaurar padrão) — o parser de body do Fastify rejeita corpo vazio com esse header como JSON inválido, retornando 400 antes mesmo de chegar na rota. Corrigido em `lib/api.ts`: só seta o header quando `options.body` está definido. Esse bug já existia desde a Fase 2 original (afetava potencialmente qualquer chamada sem corpo), só não tinha sido exercitado ainda.
2. **Hydration mismatch em `/settings/weight-categories`**: `canEdit` era calculado direto no corpo do componente a partir do `localStorage` (via `getCurrentRole()`), que não existe durante o SSR — servidor renderizava "modo leitura" e o cliente divergia após montar. Corrigido movendo o cálculo para dentro do `useEffect` (estado inicial `false`, igual em SSR e primeira renderização client).

**Decisão de design:** esta tabela é o *default* por academia usado para pré-preencher a criação de divisões na Fase 3A — não impede um evento específico de usar uma divisão totalmente customizada (o `DivisionModel` planejado tem `weightLimitKg` livre por divisão). Editar aqui muda o que vem pré-preenchido para todos os eventos futuros da academia; não é por evento.
- [ ] `next lint` não está configurado neste projeto (setup interativo, não rodado) — considerar configurar ESLint numa fase futura se desejado

### Adendo à Fase 2 (2026-07-14, v2) — Divisões e grupos totalmente livres por academia

Poucas horas após a v1 (acima), o usuário simplificou ainda mais o pedido: *"o próprio conceito de masculino/feminino deve ser editável para qualquer campeonato... se o criador do campeonato quiser fazer uma mistura, ele faz. se quiser separar por classe/peso/sexo, separa. deixa a coisa livre."* Também esclareceu que essa configuração é estritamente de competição — a academia (cadastro de atleta) continua só registrando `birthDate`, sem nenhum campo de categoria.

Isso substituiu por completo o design da v1 (6 grupos fixos derivados do enum `AgeClass`, cada um com exatamente Masculino/Feminino). Planejado com um agente de planejamento (revisão de arquitetura) antes de implementar, dado que envolvia apagar trabalho recém-commitado — plano salvo e aprovado antes da execução.

**Modelo de dados final:**
- **`DivisionTemplateModel`** — uma divisão por academia: `{ academyId, key (slug, imutável), label, minAge: number|null, maxAge: number|null, order }`. Sem campo `type`: uma divisão sem restrição de idade é simplesmente `minAge: null, maxAge: null`.
- **`DivisionGroupModel`** — substitui o antigo par fixo Masculino/Feminino: `{ academyId, divisionTemplateId, label (texto livre), order, categories: [{label, maxKg}], sourcePreset: {templateKey, groupLabel: 'male'|'female'} | null }`. Uma divisão pode ter 0, N grupos, com qualquer nome. `sourcePreset` é um campo interno (nunca exposto na UI) que rastreia se o grupo veio do preset FPJ, permitindo o botão "Restaurar valores da FPJ" continuar funcionando mesmo depois de renomear o grupo (testado: renomear "Masculino" → "Livre" e confirmar que o restore ainda traz os valores originais).

**Removido por completo:** `AgeClassService.ts` (e seus 38 testes), `AgeClass` enum de `packages/shared/src/domain/athlete.ts`, `WeightCategoryModel.ts`/`WeightCategoryService.ts`/`weightCategories.ts` (rota) da v1, `AGE_CLASS_GROUPS`. Os números da FPJ foram preservados como dados estáticos em `packages/server/src/services/fpjPreset.ts`, usados só pela ação explícita "carregar padrão" e pelo restore por grupo — não são mais um fallback implícito.

**Serviços novos:**
- `DivisionTemplateService`: `listTemplates`, `createTemplate` (slug gerado no servidor, deduplicado), `updateTemplate` (label/idade, `key` imutável), `deleteTemplate` (cascata nos grupos), `loadFpjPreset` (idempotente — só cria as divisões do preset que ainda não existem por `key`, não sobrescreve edições em divisões já carregadas).
- `DivisionGroupService`: `listGroups`, `createGroup`, `updateGroup` (label e/ou categorias, mesma validação de ordem ascendente/só-último-aberto de sempre), `deleteGroup`, `restoreFromPreset` (400 se o grupo não veio de um preset).

**Rotas:** `/api/division-templates` (CRUD + `/load-preset`) e `/api/division-templates/:key/groups` (CRUD + `/:groupId/restore`). Mesma RBAC de sempre: leitura `staff+`, escrita `academy_admin`.

**UI:** `/settings/divisions` (substitui `/settings/weight-categories`) — cada divisão é um card com nome e idade mín/máx editáveis, botão de apagar (confirma e avisa quantos grupos serão apagados junto), e dentro dela os grupos (nome livre + grid de categorias + apagar grupo + restaurar do preset quando aplicável). Estado vazio oferece "Carregar padrão FPJ" ou "Criar divisão". `WeightCategoryGrid.tsx` foi generalizado para representar um grupo (não mais gênero fixo).

**Bugs encontrados e corrigidos durante o teste manual desta versão:** nenhum novo — reaproveitou as correções já feitas na v1 (`apiFetch` sem `Content-Type` em requests sem corpo, hydration mismatch de `canEdit` calculado fora do `useEffect`).

**Testado manualmente via Playwright, cenário completo do pedido original:** carregar padrão FPJ (6 divisões) → apagar "Pré-mirim" inteira (divisão + 2 grupos, confirmação avisando a cascata) → dentro de "Adulto", apagar o grupo "Feminino" e renomear "Masculino" para "Livre" → editar uma categoria e confirmar que "Restaurar valores da FPJ" traz os valores originais mantendo o nome "Livre" → criar do zero uma divisão "PCD" sem nenhuma restrição de idade, com um único grupo "Aberto" e uma categoria única (sem split de gênero) → confirmar modo leitura para role `staff` (sem controles de edição, sem erro de hydration).

63 testes em `divisionTemplate.test.ts` (era 9 na v1 com escopo menor), typecheck limpo em todos os pacotes.

**Pendente:**
- [ ] Fase 3A, quando implementada, deve consumir `DivisionTemplateService.listTemplates()` como ponto de partida para a criação de divisões por evento — cada `DivisionGroup` de um template vira candidato a uma `Division` real do evento (1:1 ou o organizador ajusta).

---

## 5. Roadmap de Fases

| Fase | Escopo | Status |
|------|--------|--------|
| 0 | Monorepo, shared types, server stub, Electron, Docker RS | Concluída |
| 0.5 | Bugs supervisor, discriminated union bracket, DTOs | Concluída |
| 1 | Auth + RBAC + first-run setup | Concluída |
| 2 | Atleta CRUD + Guardian + Belt/Weight records | Concluída |
| 3A | Evento + Divisões + Inscrições | — |
| 3B | Bracket engine puro + testes | — |
| 3C | Persistência de bracket + match results | — |
| 3D | Import Excel | — |
| 4 | Scoreboard + WebSocket | — |
| 5 | Check-in + Weigh-in | — |
| 6 | PWA + Offline | — |
| 7 | ClusterManager mDNS + RS dinâmico | — |

A ordem 3B-antes-3D é intencional: o bracket engine é o coração do produto e é código puro (testável sem banco); o import Excel é conveniência de entrada de dados e pode chegar depois.

---

## 6. Convenções de Implementação (obrigatórias para as próximas fases)

Estas convenções foram estabelecidas na Fase 1. Todo código novo deve segui-las — inspecione `routes/users.ts`, `services/UserService.ts` e `repositories/UserModel.ts` como referência antes de criar arquivos novos.

1. **ESM com extensão `.js` nos imports relativos** (`import { X } from '../services/X.js'`).
2. **Padrão de rota:** Zod `safeParse` no body → 400 com `error.flatten()`; `preHandler: [authenticate, authorize('<minRole>')]`; try/catch capturando a classe de erro do service e convertendo em `reply.status(err.statusCode)`.
3. **`academyId` sempre de `request.authUser`, nunca do body.** Toda query de listagem/busca filtra por `academyId` do token.
4. **Services sem dependência de Fastify** (exceto `AuthService`, que precisa do `app.jwt`). Recebem parâmetros primitivos, retornam DTOs (nunca documentos Mongoose crus), lançam erro tipado próprio com `statusCode`.
5. **Models em `repositories/`**, um arquivo por model: interface `XDocument`, `Schema` com `{ timestamps: true }`, índices declarados explicitamente ao final, `export const XModel = model(...)`.
6. **Campos sensíveis com `select: false`** no schema (passwordHash, dados médicos) + filtragem por role no service quando aplicável.
7. **Audit log explícito no service** para toda mutação relevante (criação, correção, mudança de permissão): `AuditLogModel.create({ userId, entityType, entityId, action, fieldName?, oldValue?, newValue?, reason?, sessionId, ip })`. `sessionId` = `request.id`, passado pela rota.
8. **Testes de integração** via `app.inject()` com os helpers de `__tests__/helpers/db.ts` (connect/clear/close). Lógica pura (cálculo de categoria, bracket) testada como unidade, sem banco.
9. **Datas civis** (nascimento, data de evento) como string `YYYY-MM-DD`; timestamps como Date/ISO 8601 UTC. IDs expostos como string nos DTOs.
10. **Nunca sobrescrever o writeConcern** da conexão (`majority`).
11. Ao concluir, rodar `pnpm --filter @sensei-hub/server test` e `typecheck` em todos os pacotes tocados — e reportar o resultado real.

---

## 7. Plano Detalhado das Próximas Fases

### Fase 2 — Atleta (estimativa: 3–4 dias)

#### Objetivo
CRUD completo de atletas, incluindo menores com responsável obrigatório, histórico de faixa, histórico de peso, e cálculo de classe etária como função pura.

#### Models a criar

**`AthleteModel`** (`repositories/AthleteModel.ts`)
- Campos conforme `docs/zempo-modelos/campos-cadastro-atleta.md`, seção "Campos Recomendados"
- `scope: 'academy' | 'event-only'`, `eventOnlyEventId?: ObjectId`
- Dados de saúde (`medicalNotes`, `allergies`) em subdocumento com `select: false`; flag booleana `hasMedicalRestriction` visível para staff (sinaliza que existe restrição sem expor o conteúdo)
- Índices: `{ academyId: 1, status: 1 }`; `{ academyId: 1, cpf: 1 }` **unique parcial com `partialFilterExpression: { cpf: { $type: 'string' } }`**

> **Decisão — unicidade de CPF é por academia, não global.** Motivo: atletas `event-only` importados de academias visitantes podem já existir como atleta permanente em outra academia; um índice global de CPF quebraria o import. A deduplicação cross-academia é problema da Fase 3D (matching no import), não do índice.

**`BeltRecordModel`**
```typescript
{ athleteId, belt: Belt, grantedAt: Date, grantedBy: ObjectId(User), notes? }
// Índice: { athleteId: 1, grantedAt: -1 }
```

**`WeightRecordModel`**
```typescript
{
  athleteId, eventId?, weightKg: number,
  source: 'manual' | 'scale' | 'import' | 'corrected',
  operatorId, recordedAt: Date,
  correctionReason?, originalRecordId?   // obrigatórios juntos quando source === 'corrected'
}
// Índices: { athleteId: 1, recordedAt: -1 }, { eventId: 1, recordedAt: -1 }
```

**`GuardianModel`** (para menores de 18)
```typescript
{
  athleteId, name, relationship: 'father' | 'mother' | 'guardian' | 'other',
  phone, email?, cpf?,
  userId?: ObjectId(User),   // vínculo com conta de acesso do responsável — ver decisão abaixo
  termsAccepted: boolean, imageAuthorizationAccepted: boolean
}
// Índice: { athleteId: 1 }; { userId: 1 } sparse
```

> **Decisão — acesso de responsável.** O `GuardianModel` nasce com o campo `userId` opcional, mas **login de guardian fica fora do escopo da Fase 2**. Nesta fase, as rotas de guardian são acessíveis apenas por staff+. Quando o login de guardian for implementado (junto com o de atleta, pós-MVP), a autorização será: usuário com role `guardian` só acessa atletas cujo `GuardianModel.userId` aponta para ele — verificado no service, com teste. Não implementar "guardian próprio" por comparação de email/CPF: sem vínculo explícito não há autorização.

#### Serviços a criar

**`AthleteService`** (`services/AthleteService.ts`)
- `createAthlete(data, ctx)` — valida CPF (dígitos verificadores), **exige guardian no mesmo payload se menor de 18** (validado no service, não só no schema; criação de atleta + guardian é atômica), grava audit log
- `getAthlete(id, ctx)` — subdocumento médico só incluído se `role >= coach`
- `listAthletes(academyId, filters)` — paginação, busca por nome/CPF/matrícula
- `updateAthlete(id, data, ctx)` — audit log com `oldValue`/`newValue` por campo alterado
- `deactivateAthlete(id, reason, ctx)` — soft delete, reason obrigatório

`ctx = { userId, role, sessionId, ip }` — o contexto de auditoria passado pela rota.

**`WeightService`** (`services/WeightService.ts`)
- `recordWeight(athleteId, weightKg, source, ctx, eventId?)` — cria WeightRecord, atualiza `athlete.latestWeightKg`
- `correctWeight(originalRecordId, newWeightKg, reason, ctx)` — **não altera o registro original**: cria novo com `source: 'corrected'` + `originalRecordId` + `correctionReason`, grava audit log com oldValue/newValue

**`AgeClassService`** (`services/AgeClassService.ts`) — **funções puras, sem I/O, sem banco**
- `calculateAgeClass(birthDate: string, eventDate: string): AgeClass` — recebe datas civis `YYYY-MM-DD`
- `getWeightCategories(gender, ageClass): WeightCategory[]` — tabela CBJ por gênero e classe
- `assignWeightCategory(weightKg, gender, ageClass): WeightCategory`

#### Regras de negócio críticas

1. **Menor de 18**: guardian obrigatório na criação, validado contra `birthDate` vs data atual — no service
2. **Classe etária**: sempre derivada de `birthDate` + `eventDate` no momento do uso; **nunca salva como campo do atleta**
3. **Dados médicos**: `select: false` + gate de role no service; a flag `hasMedicalRestriction` é o único sinal visível para staff comum
4. **Correção de peso**: append-only — novo registro referenciando o original, nunca update in place
5. **CPF**: validado com dígitos verificadores; unicidade por academia (índice parcial acima)

#### Rotas a criar

```
POST   /api/athletes                          (staff+)  — aceita guardian embutido p/ menor
GET    /api/athletes                          (staff+)  — paginado, busca ?q=
GET    /api/athletes/:id                      (staff+)  — médico filtrado por role
PATCH  /api/athletes/:id                      (staff+)  — audit log por campo
DELETE /api/athletes/:id                      (academy_admin) — soft delete, body { reason }

POST   /api/athletes/:id/belts                (coach+)
GET    /api/athletes/:id/belts                (staff+)

POST   /api/athletes/:id/weights              (weigh_in_operator+)
GET    /api/athletes/:id/weights              (staff+)
POST   /api/athletes/:id/weights/:wid/correct (event_manager+) — body { weightKg, reason }

POST   /api/athletes/:id/guardian             (staff+)
GET    /api/athletes/:id/guardian             (staff+)  — acesso de guardian: pós-MVP, ver decisão
```

#### Testes obrigatórios

- `AgeClassService`: tabela de casos por classe etária (limites exatos de idade), categorias por gênero/classe, atribuição por peso nos limites de categoria — unit, sem banco
- Criação de menor sem guardian → 400/422; com guardian → cria ambos atomicamente
- CPF inválido → 400; CPF duplicado na mesma academia → 409; mesmo CPF em academias diferentes → permitido
- `GET /api/athletes/:id` como `staff` não retorna `medicalNotes`; como `coach` retorna
- Correção de peso: original intacto, novo registro com referência, audit log gravado
- Todas as rotas sem token → 401; com role insuficiente → 403

#### UI (mínima nesta fase)

- Lista de atletas com busca (mobile-first, texto grande)
- Formulário de cadastro/edição com seção condicional de responsável quando menor
- Perfil do atleta com histórico de faixa e peso

---

### Fase 3A — Evento e Divisões (estimativa: 2–3 dias)

**Models:**
- `EventModel`: `hostAcademyId`, `name`, `eventDate` (YYYY-MM-DD), `venue`, `status`, `createdBy`
- `DivisionModel`: `eventId`, `name`, `gender`, `ageClass`, `weightLimitKg`
- `EventEntryModel`: `eventId`, `divisionId`, `athleteId`, `status` (`incomplete → registered → checked_in → weighed_in → confirmed | withdrawn`), `seed?`, `declaredWeightKg?`

**`EventEntryService`:**
- `listEntries(eventId, filters)` — por divisão, status, academia
- `createManualEntry(data, ctx)` — cadastro individual
- `checkIn(entryId, ctx)` — `registered → checked_in`
- `recordWeighIn(entryId, weightKg, ctx)` — `checked_in → weighed_in`, cria WeightRecord via WeightService, valida contra `weightLimitKg` da divisão (alerta, não bloqueia — a confirmação decide)
- `confirmEntry(entryId, confirmedDivisionId, ctx)` — `weighed_in → confirmed`; permite mover de divisão (caso comum: bateu peso de outra categoria)
- `withdrawEntry(entryId, reason, ctx)` — de qualquer status para `withdrawn`, reason obrigatório

Transições de status são validadas no service (máquina de estados explícita, testada); transição inválida → 409.

**Rotas:**
```
POST   /api/events                            (event_manager+)
GET    /api/events                            (staff+)
GET    /api/events/:id                        (staff+)
PATCH  /api/events/:id                        (event_manager+)

POST   /api/events/:id/divisions              (event_manager+)
GET    /api/events/:id/divisions              (staff+)
PATCH  /api/events/:id/divisions/:did         (event_manager+)
DELETE /api/events/:id/divisions/:did         (event_manager+) — 409 se houver inscrições

GET    /api/events/:id/entries                (staff+)
POST   /api/events/:id/entries                (staff+)
PATCH  /api/events/:id/entries/:eid/checkin   (staff+)
PATCH  /api/events/:id/entries/:eid/weighin   (weigh_in_operator+)
PATCH  /api/events/:id/entries/:eid/confirm   (event_manager+)
PATCH  /api/events/:id/entries/:eid/withdraw  (event_manager+) — reason obrigatório
```

---

### Fase 3B — Bracket Engine Puro (estimativa: 3–4 dias)

Toda a lógica de chave é **pura** (sem I/O, sem Mongoose) em `packages/server/src/domain/bracket/`. É a parte mais crítica do produto — nenhuma linha entra sem teste.

**Interface `BracketEngine`:**
```typescript
interface BracketEngine {
  generate(athletes: AthleteSlot[], config: BracketConfig): BracketState
  getReadyMatches(state: BracketState): Match[]
  advanceMatch(state: BracketState, result: MatchResult): AdvanceResult
  calculateRepechage(state: BracketState, type: RepechageType, completedRound: Match[]): Match[]
  getFinalRankings(state: BracketState): AthleteRanking[]
}
// AdvanceResult = { updatedMatches: Match[], newRepechageMatches: Match[] }
```

**`EliminationEngine`** — Chave-8 a Chave-128:
- `generate()`: ordena por seed, distribui byes (prioridade para cabeças de chave), aplica separação de mesmo-clube na rodada 1, gera todos os `Match` com `athleteAId`/`athleteBId` (null onde TBD)
- `advanceMatch()`: atualiza vencedor, preenche próximo match via `nextMatchNumber`/`repNextMatchNumber`, calcula repescagem **progressivamente** (após cada resultado, nunca pré-gerada)
- `calculateRepechage()`: 5 algoritmos conforme `docs/zempo-modelos/repescagem.md`

**`RodizioEngine`** — Rodízio-3 a Rodízio-6:
- Ordem fixa de lutas conforme `docs/zempo-modelos/rodizio.md`
- `getFinalRankings()`: vitórias → pontos → confronto direto → sorteio (o desempate por sorteio deve ser determinístico dado um seed registrado no bracket, para auditabilidade)

**Casos de borda obrigatoriamente testados:**
- Número ímpar de atletas (byes)
- Atleta retirado após geração (WO automático)
- Mesmo clube na rodada 1 (separação)
- Os 5 tipos de repescagem com Chave-8 (caso mínimo para verificar numeração)
- Rodízio com empate triplo (confronto direto)
- `generate()` determinístico: mesma entrada + mesmo seed ⇒ mesma chave

---

### Fase 3C — Persistência de Bracket + Resultados (estimativa: 2 dias)

- `BracketModel` e `MatchModel` persistem o `BracketState` do engine; o service orquestra: carrega estado → chama engine puro → persiste resultado
- Correção de resultado: append-only no audit log com `oldValue`/`newValue`/`reason`; o service recalcula avanços afetados via engine

**Rotas:**
```
POST /api/events/:id/divisions/:did/bracket               (event_manager+) — gera com entries 'confirmed'
GET  /api/events/:id/divisions/:did/bracket               (staff+)
GET  /api/events/:id/divisions/:did/matches               (staff+)
POST /api/events/:id/divisions/:did/matches/:mid/result   (event_manager+)
POST /api/events/:id/divisions/:did/matches/:mid/correct  (event_manager+) — reason obrigatório
```

Regenerar bracket com resultados já lançados → 409 (exige confirmação explícita via flag `force`, que arquiva o bracket anterior e grava audit log — nunca apaga).

---

### Fase 3D — Import de Excel (estimativa: 2–3 dias)

**Dependência nova:** `xlsx` (SheetJS) — parse de `.xlsx` sem binding nativo.

**Template (colunas fixas, ordem importa):**

| Col | Campo | Tipo | Obrigatório |
|-----|-------|------|-------------|
| A | nome_completo | string | sim |
| B | nome_preferido | string | não |
| C | academia | string | sim |
| D | data_nascimento | DD/MM/AAAA | sim |
| E | genero | M/F | sim |
| F | faixa | branca/…/preta | sim |
| G | peso_declarado_kg | número | sim |
| H | categoria | nome da divisão no evento | sim |
| I | cpf | string | não |
| J | email | string | não |
| K | telefone | string | não |
| L | responsavel_nome | string | se menor |
| M | responsavel_telefone | string | se menor |
| N | observacoes | string | não |

**`ImportService`:**
- `getTemplate(): Buffer` — XLSX para download
- `parseAndValidate(buffer, eventId): { valid: Row[], errors: RowError[] }` — erros por linha: campo ausente, data inválida, categoria inexistente no evento, menor sem responsável
- `importRows(valid, eventId, ctx): ImportJob` — cria Athletes (`scope: 'event-only'`) + EventEntries em transação MongoDB; matching por CPF dentro da academia para não duplicar atleta permanente

**Rotas:**
```
GET  /api/events/:id/import/template          (event_manager+)
POST /api/events/:id/import                   (event_manager+) — multipart/form-data
GET  /api/events/:id/import/jobs              (event_manager+)
GET  /api/events/:id/import/jobs/:jid         (event_manager+) — relatório de erros
```

---

### Fase 4 — Scoreboard (estimativa: 2–3 dias)

#### Fluxo de dados

```
Operador → mutação via API
→ Mongoose salva no primary → oplog replica
→ Change Stream emite em cada nó
→ WebSocket server de cada nó faz broadcast aos seus clientes
→ Latência alvo < 500ms em rede local
```

**`ScoreboardModel`:** persiste a cada mutação (não a cada tick — o timer roda no cliente e sincroniza ao pausar/parar); `updatedAt` indexado para detecção de conflito.

**`ScoreboardService`:**
- `startMatch(matchId, ctx)` — cria ou recupera, `state → running`
- `addScore(scoreboardId, athleteId, type, ctx)` — waza-ari ou shido
- `startOsaekomi(scoreboardId, athleteId, ctx)` / `stopOsaekomi(scoreboardId, ctx)` — calcula ippon/waza-ari por tempo
- `declareWinner(scoreboardId, winnerId, method, ctx)` — fecha scoreboard, grava resultado no Match via fluxo da Fase 3C
- `correctScore(scoreboardId, correction, reason, ctx)` — audit log obrigatório

Regras de pontuação encapsuladas em módulo puro (variam por federação/evento — não hardcode espalhado).

**WebSocket:**
- `GET /ws/scoreboard/:id` — display público, sem auth, somente leitura
- `GET /ws/scoreboard/:id/operator` — requer auth + role `scoreboard_operator`+, **verificada no servidor no handshake**
- Estado completo ao conectar; deltas depois

**Telas:**
- `/scoreboard/[id]` — display público, texto grande, zero controles
- `/event/[id]/operate/[matchId]` — painel do operador, botões grandes, auth obrigatória

---

### Fase 5 — Check-in + Weigh-in (estimativa: 2–3 dias)

#### Check-in

Métodos: busca por nome (fuzzy), CPF, matrícula, QR code.

**`AttendanceModel`:**
```typescript
{
  athleteId, eventId, method, operatorId, checkedInAt,
  status: 'active' | 'revoked',
  revokedReason?, revokedBy?, revokedAt?
}
// Índice único PARCIAL: { athleteId: 1, eventId: 1 }
//   com partialFilterExpression: { status: 'active' }
```

> **Decisão — duplicata vs. desfazer.** O índice único é **parcial sobre `status: 'active'`**: impede dois check-ins ativos simultâneos, mas permite novo check-in após um `undo` (que marca `status: 'revoked'` com reason + audit log, nunca deleta). Um índice único simples tornaria o re-check-in pós-correção impossível.

**`CheckInService`:**
- `checkIn(athleteId, eventId, method, ctx)` — cria Attendance, atualiza `EventEntry.status → checked_in`
- Duplicata ativa detectada → 409 com dados do check-in anterior (não silencia)
- `undoCheckIn(attendanceId, reason, ctx)` — revoga + reverte status da entry, audit log

**Rotas:**
```
POST   /api/events/:id/checkin                (staff+) — { athleteId, method }
DELETE /api/events/:id/checkin/:aid           (event_manager+) — { reason }
GET    /api/events/:id/checkin                (staff+)
```

#### Weigh-in

- Reusa `EventEntryService.recordWeighIn()` (Fase 3A)
- `ScaleAdapter` com mock para dev/testes:
  ```typescript
  interface ScaleAdapter {
    getLatestReading(): Promise<{ weightKg: number; timestamp: Date } | null>
    isConnected(): boolean
  }
  ```
- Leitura da balança sempre confirmada pelo operador antes de virar registro oficial
- Falha de hardware nunca bloqueia: fallback imediato para entrada manual

---

### Fase 6 — PWA + Offline (estimativa: 2–3 dias)

- **Service Worker** via Serwist (Workbox moderno para App Router)
- Cache read-only de lista de atletas e estrutura do evento em IndexedDB
- Writes offline: fila em IndexedDB → background sync ao reconectar, com status de sync visível ao operador
- Scoreboard **não funciona offline** (exige WebSocket) — UI diz isso claramente
- Acesso de tablets/phones nesta fase: **QR code fixo no canto da tela do Electron** com URL de IP direto. O acesso zero-config via `senseihub.local` (mDNS) é escopo da Fase 7, junto com o ClusterManager — não implementar mDNS parcial aqui.

---

### Fase 7 — Cluster Dinâmico (estimativa: 3–4 dias)

**`ClusterManager`** (parte do server, iniciado com a API):
```
1. Anuncia via mDNS: _senseihub._tcp.local (hostname único senseihub-<machineid>.local)
2. Aguarda 3s para descobrir outros nós
3a. Nenhum nó → rs.initiate() → passa a anunciar senseihub.local
3b. Cluster existente → POST /api/cluster/join no primary → MongoDB initial sync
```

- `multicast-dns` (ou `mdns-js`) para discovery; somente o primary anuncia `senseihub.local`; após failover o novo primary assume o anúncio
- Arbiter automático para N=2 (processo leve, só voto)
- Graceful leave: `rs.stepDown()` se primary, `rs.remove()` se secondary
- `GET /api/cluster/status` — nós, roles, lag de replicação

**Garantias Raft/MongoDB:**
- Split-brain impossível: primary exige maioria estrita (floor(N/2)+1)
- N=1: single-node RS, sem failover — recomendado para treinos
- N=2 sem arbiter: ambos viram secondary se particionados — daí o arbiter automático
- writeConcern majority: zero perda de dados confirmados em failover

---

## 8. Regras de Qualidade Não Negociáveis

Qualquer implementação que viole as regras abaixo deve ser rejeitada:

1. **Autorização server-side obrigatória** — frontend esconder botão não é autorização
2. **`passwordHash` nunca em resposta** — `select: false` + teste explícito
3. **Correção com audit trail** — peso, resultado, scoreboard: sempre `oldValue`, `newValue`, `reason`, `operatorId`; correções são append-only, nunca update/delete do registro original
4. **Classe etária derivada** — nunca campo fixo no atleta
5. **Bracket engine puro** — sem I/O, 100% testável sem banco
6. **Repescagem progressiva** — calculada após cada resultado, nunca pré-gerada
7. **Dados de saúde restritos** — `select: false` + gate de role no service
8. **Dados de menor** — guardian obrigatório; acesso de guardian só via vínculo explícito `GuardianModel.userId`
9. **writeConcern majority** — nunca sobrescrever para `w:1`
10. **Não copiar Zempo** — lógica de bracket derivada de `docs/zempo-modelos/` e conhecimento público de judô

---

## 9. Como Verificar o Trabalho

### Compilação

```bash
pnpm --filter @sensei-hub/shared typecheck
pnpm --filter @sensei-hub/server typecheck
pnpm --filter @sensei-hub/web typecheck
pnpm --filter @sensei-hub/app typecheck
```

### Testes

```bash
pnpm --filter @sensei-hub/server test          # unit + integration
pnpm --filter @sensei-hub/server test:watch
```

### Dev local com Docker

```bash
docker compose up -d                            # 3 nós MongoDB em RS
pnpm --filter @sensei-hub/server dev            # Fastify :3001
pnpm --filter @sensei-hub/web dev               # Next.js :3000
curl http://localhost:3001/api/health
```

### Teste de failover (quando ClusterManager existir)

```bash
docker compose up -d
docker stop sensei-mongo-1                      # derruba primary
# aguardar ~10s (eleição)
curl http://localhost:3001/api/health           # deve responder
docker start sensei-mongo-1                     # reintegra como secondary
```

---

## 10. Decisões de Arquitetura Relevantes

| Decisão | Alternativa considerada | Motivo |
|---------|------------------------|--------|
| MongoDB Replica Set | SQLite, PostgreSQL | Failover nativo por Raft; Change Streams para real-time; BSON natural para bracket |
| Fastify 5 | Express, Hapi | Startup <100ms em Celeron; plugins oficiais (jwt, websocket, cors) |
| Electron como supervisor | PM2, systemd | Supervisor + browser kiosk num único processo, mesma stack |
| `bcryptjs` (puro JS) | `bcrypt` (nativo) | Sem compilação de extensão nativa em Celeron |
| Refresh token como hash SHA-256 | Token bruto no banco | Vazamento do banco não compromete sessões |
| First-run setup | CRUD de academias | Produto é single-academy até a Fase 7+; setup guiado é mais simples e seguro |
| Audit log explícito no service | Middleware genérico onSend | Auditável, testável, sem mágica; cada mutação decide o que registrar |
| CPF único por academia (índice parcial) | Índice global | Import de atletas visitantes não pode colidir com cadastro de outra academia |
| `event-only` athlete scope | Cadastro completo obrigatório | Visitantes de N academias sem conta completa |
| Import Excel (SheetJS) | Formulário online, CSV | Excel é o meio de troca real entre academias brasileiras |
| Classe etária derivada em runtime | Campo fixo | Regras variam por federação/evento; evita dado stale |
| QR code (F6) → mDNS `senseihub.local` (F7) | Digitar IP | Zero-config progressivo; mDNS junto com ClusterManager para não duplicar lógica |
