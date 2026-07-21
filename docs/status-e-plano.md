# Sensei Hub — Status de Implementação e Plano de Desenvolvimento

**Gerado em:** 2026-07-01
**Atualizado em:** 2026-07-21 (separação em dois produtos independentes — Sensei Dojô e Sensei Arena)
**Propósito:** Documento de referência técnica. Descreve a arquitetura atual, as decisões tomadas, e o histórico de implementação. É a fonte de verdade — leia a seção 6 (Convenções) antes de escrever código.

> **Nota histórica:** as seções 4+ (fases 0–7) descrevem a construção do sistema como um **monolito único** (`packages/{shared,server,web,app}`). Em 2026-07-21 esse monolito foi separado em **dois produtos independentes**; caminhos de arquivo do tipo `packages/server`, `packages/web`, `packages/app` nas seções antigas correspondem hoje aos pacotes descritos na seção 3. O comportamento de domínio (auth, atletas, eventos, bracket, placar, cluster) foi preservado; o que mudou foi a organização e o modelo de atleta (ver seção 3.1). A tag git `pre-split` marca o último commit antes da separação.

---

## 1. Visão Geral do Produto

Sensei Hub é o guarda-chuva de **dois produtos local-first** para academias de judô, que rodam de forma totalmente independente (build e execução separados, bancos separados), mas compartilham a mesma stack e código técnico comum:

- **Sensei Dojô** — gestão de academia: atletas (cadastro + anamnese), responsáveis (guardians), faixas, acompanhamento de peso, staff/usuários.
- **Sensei Arena** — gestão de campeonato: eventos, divisões/categorias (+ templates/grupos/preset FPJ), inscrições, check-in de evento, pesagem (+ balança), brackets, matches, áreas/tatames, mesa/placar, display público, impressão, import Excel, PWA/offline e cluster mDNS.

A integração entre os dois é por **arquivo**, sem acoplamento em runtime: o Dojô exporta um `.xlsx` (`GET /api/athletes/export`) exatamente no formato que o import da Arena lê. Cada produto opera em hardware limitado (Celeron/i3, 4GB RAM), em WiFi de ginásio instável, sem internet. Cada laptop é simultaneamente servidor (API + banco) e cliente (browser embutido); na Arena, um nó é eleito primary pelo replica set do MongoDB com failover automático (cluster mDNS, Fase 7).

**Documento de arquitetura:** `docs/arquitetura.md`
**Regras do projeto:** `CLAUDE.md`
**Referências de bracket:** `docs/zempo-modelos/`

---

## 2. Stack Técnica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Runtime | Node.js | 24 LTS (produção) |
| Linguagem | TypeScript | 5.8.x |
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
├── apps/
│   ├── dojo/                 # Sensei Dojô — gestão de academia
│   │   ├── shared/           # @dojo/shared — schemas Zod (atleta, guardian, faixa, peso)
│   │   ├── server/           # @dojo/server — Fastify :3101 (db senseihub_dojo, replSet dojo-rs)
│   │   ├── web/              # @dojo/web — Next.js :3100
│   │   └── desktop/          # @dojo/desktop — Electron (janela simples)
│   └── arena/                # Sensei Arena — gestão de campeonato
│       ├── shared/           # @arena/shared — evento, divisão, bracket, scoreboard, competidor…
│       ├── server/           # @arena/server — Fastify :3001 (db senseihub_arena, replSet sensei-rs) + cluster mDNS
│       ├── web/              # @arena/web — Next.js :3000 (PWA/offline)
│       └── desktop/          # @arena/desktop — Electron (kiosk/placar + arbiter)
├── packages/                 # Código técnico compartilhado pelos dois produtos
│   ├── shared/               # @sensei-hub/shared — Belt/Gender/WeightSource, BELT_LABEL_PT,
│   │                         #   ATHLETE_SHEET_HEADERS (contrato do .xlsx), cpf, user/roles/academy
│   ├── core-server/          # @sensei-hub/core-server — env (createEnv), database, authenticate/authorize,
│   │                         #   models Academy/User/RefreshToken/AuditLog, Auth/UserService,
│   │                         #   rotas auth/users/setup/health, AuthCtx; subpath ./testing (helper mongo in-memory)
│   ├── core-web/             # @sensei-hub/core-web — api client, labels comuns, LoginPage/SetupPage
│   └── desktop-runtime/      # @sensei-hub/desktop-runtime — supervisor parametrizado + kiosk + createDesktopApp()
├── docs/
│   ├── arquitetura.md
│   ├── status-e-plano.md     # Este documento
│   └── zempo-modelos/        # Referências de formatos de bracket e cadastro
├── scripts/                  # dev-run.mjs e package-app.mjs (parametrizados por produto)
├── turbo.json
├── tsconfig.base.json
└── pnpm-workspace.yaml       # packages/* + apps/*/*
```

**Comandos por produto:** `pnpm dev:dojo` / `pnpm dev:arena` (sobem mongo in-memory + server + web); `pnpm package:dojo` / `pnpm package:arena` (empacotam o Electron). `pnpm typecheck` / `pnpm test` / `pnpm build` cobrem todos os pacotes.

### 3.1 Pontes de domínio da separação

- **AuthCtx** (antes `AthleteCtx`): contexto de autenticação genérico (`userId, academyId, role, sessionId, ip`), agora em `@sensei-hub/core-server`, usado por todos os services dos dois produtos.
- **Atleta vs. competidor:** o Dojô mantém o `Athlete` completo (anamnese, matrícula, Guardian, BeltRecord). A Arena tem um **competidor slim** próprio (`CompetitorService` + schema em `@arena/shared`) — sem anamnese/matrícula, responsável como texto livre, e sempre ligado a um evento via `EventEntry` (o antigo `scope: 'event-only'` deixou de existir). O model mongoose da Arena continua chamado `'Athlete'` para preservar os refs `athleteId`.
- **Peso:** `WeightRecord` do Dojô é acompanhamento do atleta (sem `eventId`); o da Arena é pesagem oficial de evento (`eventId` obrigatório).
- **Contrato de arquivo Dojô→Arena:** colunas (`ATHLETE_SHEET_HEADERS`) e rótulos de faixa (`BELT_LABEL_PT`) vivem em `@sensei-hub/shared`; o `ExportService` do Dojô e o `ImportService` da Arena derivam dos mesmos valores, então não podem divergir.

---

## HISTÓRICO DE IMPLEMENTAÇÃO (fases 0–7, pré-separação)

_As seções abaixo descrevem o desenvolvimento do monolito original e são mantidas como registro. Ver a nota no topo sobre a correspondência de caminhos de arquivo._

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
- [x] Fase 3A, quando implementada, deve consumir `DivisionTemplateService.listTemplates()` como ponto de partida para a criação de divisões por evento — cada `DivisionGroup` de um template vira candidato a uma `Division` real do evento (1:1 ou o organizador ajusta). **Feito — ver seção Fase 3A abaixo.**

---

### Fase 3A — Concluída em 2026-07-15 (backend + UI)

**Diverge do plano original da seção 7 abaixo** — aquele texto foi escrito antes de `DivisionTemplate`/`DivisionGroup` existirem e ainda descreve `DivisionModel: { eventId, name, gender, ageClass, weightLimitKg }` com `ageClass` como string livre e `gender` como enum fixo `male|female|mixed`. Isso não existe mais: `ageClass` era o enum `AgeClass`, apagado no adendo da Fase 2 v2. O modelo real implementado:

**Models:**
- `EventModel`: `hostAcademyId, name, description?, eventDate, venue?, status (draft|registration|in_progress|completed|cancelled), createdBy`.
- `DivisionModel`: **sem `gender`/`ageClass`** — `{ eventId, name, minAge: number|null, maxAge: number|null, weightLimitKg: number|null, sourceTemplateKey?, sourceGroupId? }`. Uma divisão de evento é um bracket concreto (uma faixa etária opcional + um limite de peso), não mais um par gênero+classe fixo. `sourceTemplateKey`/`sourceGroupId` são só rastreabilidade opcional de onde a divisão veio (ver ação de import abaixo) — a divisão é uma linha independente, editável/apagável depois sem restrição.
- `EventEntryModel`: igual ao planejado, com índice único `{eventId, divisionId, athleteId}` (evita inscrição duplicada na mesma divisão; a mesma atleta pode ter entradas em divisões diferentes do mesmo evento).

**Nova ação — `POST /api/events/:id/divisions/import-from-templates`** (não estava no plano original, criada para integrar com o trabalho de Fase 2): expande `DivisionTemplate` × `DivisionGroup` × linha de categoria de peso em uma `Division` de evento por categoria (ex.: template "Adulto" com grupos Masculino/Feminino de 7 categorias cada gera 14 divisões). Body opcional `{ templateKeys?: string[] }` filtra quais templates importar; sem filtro importa todos. Não é idempotente (rodar duas vezes duplica) — aceitável porque o organizador normalmente importa uma vez e edita depois; documentado aqui como limitação conhecida, não corrigida por falta de necessidade agora.

**`EventEntryService`** — máquina de estados implementada exatamente como planejado (`incomplete→registered→checked_in→weighed_in→confirmed`, mais `disqualified` — ver adendo abaixo —, `withdrawn` alcançável de qualquer estado não-terminal, transição inválida → 409):
- `recordWeighIn` reaproveita `WeightService.recordWeight()` (cria `WeightRecord` real vinculado à atleta, mesmo fluxo do perfil). O que acontece quando o peso excede `weightLimitKg` da divisão é decidido pela política do evento — ver adendo "Política de peso acima do limite" abaixo.
- `confirmEntry` aceita `confirmedDivisionId` opcional pra mover a atleta pra outra divisão no momento da confirmação (override manual, independente de peso).
- `withdrawEntry` exige `reason`.

**Rotas:** exatamente as do plano original (`/api/events`, `/api/events/:id/divisions`, `/api/events/:id/entries` + as 4 transições), mais a rota de import acima. RBAC igual ao planejado: `event_manager+` pra criar/editar evento e divisão, `staff+` pra check-in/listagem/inscrição manual, `weigh_in_operator+` pra pesagem, `event_manager+` pra confirmar/retirar.

**Testes:** 15 novos em `event.test.ts` na versão original desta fase (78 no total do pacote server); +2 testes líquidos no adendo da política de peso (80 no total) — CRUD de evento/divisão, import-from-templates (conta exata de divisões geradas), ciclo completo de inscrição, confirmação trocando de divisão, retirada de qualquer estado não-terminal + reason obrigatório, transição inválida (pular etapa) → 409, inscrição duplicada → 409, RBAC por rota.

**UI:** `/events` (lista), `/events/new` (criação), `/events/[id]` (detalhe — cabeçalho editável para `event_manager+`, seção de divisões com importar-do-padrão/criar/editar/apagar, seção de inscrições com busca de atleta + seleção de divisão + botões de ação condicionais por status/role). Modo leitura/edição calculado em `useEffect` (evita hydration mismatch, mesmo padrão já usado em `/settings/divisions`).

**Testado manualmente via Playwright** (ciclo completo, `MongoMemoryReplSet` efêmero + `pnpm dev`): criar evento → importar padrão FPJ (106 divisões geradas e renderizadas corretamente) → inscrever atleta com busca por nome → percorrer o ciclo de status inteiro (check-in → pesagem com peso acima do limite da divisão, não bloqueado → confirmar movendo para outra divisão → retirar com motivo) → RBAC visual confirmado logando como `staff` (cabeçalho somente leitura, sem botões de gerenciar divisão, sem "Retirar", com "Check-in" disponível). Nenhum erro de console durante todo o fluxo.

**Bug encontrado e corrigido durante o teste manual:** a lista de inscrições sempre exibia o nome da divisão original (`entry.divisionId`), mesmo depois de `confirmEntry` mover a atleta para outra divisão via `confirmedDivisionId`. Corrigido em `EntriesSection` (`packages/web/src/app/events/[id]/page.tsx`) para preferir `entry.confirmedDivisionId` quando presente.

**Pendente da Fase 3A:**
- [ ] Tornar `import-from-templates` idempotente se isso virar um problema real no uso (hoje não é, mas fica anotado)

---

### Adendo — Política de peso acima do limite (2026-07-16)

Pedido do usuário: peso acima do limite da divisão não pode ser só um aviso ignorado — cada campeonato define sua própria regra: **realocar** a atleta automaticamente para a categoria correta, ou **desclassificar**. Substitui o comportamento anterior (`withinDivisionLimit: boolean`, nunca bloqueava).

**Modelo:** `EventModel.overweightPolicy: 'disqualify' | 'reallocate'` (default `'disqualify'` — mais próximo da convenção usual de campeonato de judô), configurável na criação do evento e editável depois no cabeçalho. `EventEntryStatus` ganhou `'disqualified'` (terminal, igual a `withdrawn` — sem correção via máquina de estados, mesma limitação já aceita para retiradas). `EventEntryModel` ganhou `disqualifiedReason`.

**Lógica em `recordWeighIn`** (`EventEntryService`): se o peso não excede o limite, nada muda (`outcome: 'ok'`). Se excede:
- `reallocate`: busca, entre as divisões do mesmo evento que compartilham `sourceGroupId` (ou seja, vieram do mesmo `DivisionGroup` da academia — o único sinal confiável de "mesma categoria, brackets de peso diferentes", já que divisões são livres e não têm mais um campo de gênero/classe fixo), a de menor `weightLimitKg` que ainda comporte o peso real. Se achar, move `divisionId` da inscrição pra lá e mantém o fluxo em `weighed_in` (`confirmEntry` continua disponível). Se não achar — inclusive porque a divisão foi criada manualmente e não tem `sourceGroupId`, caso em que não há nenhum sinal de agrupamento pra buscar — cai automaticamente pra desclassificação.
- `disqualify`: a inscrição vai direto para `disqualified`, com `disqualifiedReason` preenchido (ex.: "Peso acima do limite da divisão (95kg > 90kg)").

Toda mudança automática de divisão ou desclassificação gera log de auditoria com o motivo.

**UI:** seletor de política no formulário de criar evento e no cabeçalho do evento (`event_manager+`); status "Desclassificada" com motivo exibido na lista de inscrições; mensagem inline após registrar pesagem informando se a atleta foi realocada ou desclassificada.

**Testado:** 80 testes do server passam (2 líquidos a mais: reescreveu os 2 testes que dependiam do comportamento antigo de "nunca bloqueia" e adicionou o caminho de realocação bem-sucedida + o de fallback pra desclassificação). Testado manualmente no navegador: política "realocar" movendo a atleta de "Ligeiro" pra "Meio Leve" com mensagem inline correta; política "desclassificar" (default) terminando a inscrição com motivo visível e sem botões de ação residuais.

---

### Fase 3B — Concluída em 2026-07-16 (bracket engine puro)

Implementado em `packages/server/src/domain/bracket/` — puro, sem I/O, sem Mongoose, exatamente como planejado. Persistência e rotas vieram na Fase 3C, logo abaixo.

**Arquivos:**
- `types.ts` — `BracketEngine`, `Match`, `BracketState`, `AthleteSlot`, `BracketConfig`, `AdvanceResult` etc., fiéis à interface do plano original, com duas extensões documentadas no próprio código: `MatchResultInput` inclui `matchNumber` (a interface do plano não deixava explícito como `advanceMatch` saberia qual luta está sendo resolvida) e `points?: number` (usado só pelo Rodízio, pro desempate por pontuação — a regra exata de pontos por método é decisão do chamador, o engine só soma).
- `seeding.ts` — `seedPositions(size)`: a permutação matemática padrão de seed de torneio (1 e 2 sempre em metades opostas, 3/4 no meio de cada metade — mesmo algoritmo usado universalmente em brackets esportivos, não é código da Zempo). `assignSlots()`: distribui atletas reais nas posições; byes caem automaticamente nos seeds mais altos (não precisou de lógica especial — é uma propriedade da própria permutação). Separação de mesmo clube: só move atletas **não-cabeças de chave** (seeds explícitos nunca são realocados — é proteção competitiva, não conveniência); um conflito entre dois cabeças de chave forçados adjacentes fica documentado como limitação aceita.
- `bracketTree.ts` — numeração determinística de lutas por rodada (`matchNumberFor`), igual à fórmula "Padrão geral" do doc.
- `EliminationEngine.ts` — `generate/getReadyMatches/advanceMatch/calculateRepechage/getFinalRankings`. Decisão de numeração documentada: a final é **sempre** a luta `size-1` (não se desloca conforme o tipo de repescagem, diferente de alguns exemplos do doc de referência que pareciam inconsistentes entre si); bronze (só em `simples`) fica reservado no número `size`; lutas de repescagem são numeradas sequencialmente a partir de `size+1`, na ordem em que são geradas.
- `RodizioEngine.ts` + `rodizioSchedule.ts` — ordens fixas de luta pra Rodízio 3 a 6 (copiadas literalmente do doc). Classificação: vitórias → pontos → confronto direto **dentro do grupo empatado** (generaliza o caso de 2 pra qualquer tamanho de grupo — resolve corretamente um empate triplo não-cíclico) → sorteio determinístico (seed do bracket) só quando sobra um ciclo genuíno tipo pedra-papel-tesoura (matematicamente não tem solução por confronto direto nesse caso).

**calculateRepechage é idempotente por design:** deriva tudo de `state.matches` (não do parâmetro `completedRound`, que é aceito só por compatibilidade com a interface) — pode ser chamado depois de qualquer `advanceMatch` sem o chamador precisar rastrear exatamente qual rodada terminou; lutas já geradas nunca duplicam (checadas via `groupMatchNumber`).

**Testes (42 novos, 122 no total do pacote server):**
- `bracket.seeding.test.ts` (12) — tabela de seed padrão Chave-8, byes protegendo os melhores seeds, separação de mesmo clube, determinismo do PRNG.
- `bracket.elimination.test.ts` (14) — estrutura da Chave-8, byes simples e byes em cascata (2 atletas numa Chave-8), validações de `advanceMatch`, e **os 5 tipos de repescagem verificados manualmente com um mesmo cenário de partidas** (`nenhuma`, `simples`, `normal`, `dupla`, `finalistas`), cada um conferindo a classificação final completa (1º-7º).
- `bracket.rodizio.test.ts` (11) — ordens fixas de Rodízio 3/4/5/6, desempate por vitórias/pontos/sorteio determinístico.
- `bracket.edgeCases.test.ts` (5) — número ímpar de atletas (7 numa Chave-8), WO após retirada, determinismo completo (`generate()` idêntico dado mesma entrada+seed), e um empate triplo **resolvível** por confronto direto (não-cíclico, construído e conferido à mão).

**Pendente da Fase 3B:** nada — engine completo conforme especificado. Persistência, rotas e integração com o fluxo de inscrições confirmadas ficam pra Fase 3C.

---

### Fase 3C — Concluída em 2026-07-16 (persistência de bracket + resultados)

Camada de persistência/rotas em torno do motor puro da Fase 3B. `packages/shared/src/domain/bracket.ts` foi **reescrito** (não havia consumidor nenhum ainda, então sem custo de migração) pra usar exatamente o vocabulário do engine (`stage`, `'nenhuma'/'simples'/'normal'/'dupla'/'finalistas'`, `'rodizio'`) em vez do rascunho especulativo anterior — uma só terminologia entre engine, banco e API.

**Modelos:**
- `BracketModel` — `{ eventId, divisionId, format, size?, repechageType?, seed, slots, status: 'active'|'archived', version, generatedBy }`. `slots` guarda a lista de atletas elegíveis **de entrada** (o que foi passado pra `engine.generate()`), não o `BracketState.slots` interno do engine — que pra eliminação é um array posicional com `null` de verdade nas posições de bye (detalhe de implementação que nenhum código de reconstrução de estado precisa; só `RodizioEngine.getFinalRankings` lê `state.slots`, e só pra pegar a lista de IDs). Índice único parcial `{eventId, divisionId, status:'active'}` — só um bracket ativo por divisão por vez.
- `MatchModel` — espelha `Match` do engine 1:1, com `bracketId`/`eventId`/`divisionId` pra consulta direta. Índice único `{bracketId, matchNumber}`.

**`BracketService`:**
- `generateBracket` — busca `EventEntry` com `status:'confirmed'` cuja divisão efetiva (`confirmedDivisionId ?? divisionId`) é a divisão alvo; converte em `AthleteSlot[]` **sem seeding** (nenhuma UI de cabeça-de-chave ainda — todo mundo entra `seed: null`, ordem decidida deterministicamente pelo `seed` do bracket, igual qualquer atleta não-cabeça-de-chave no engine). Sem entradas confirmadas → 400. Bracket ativo já existe → 409, a menos que `force:true`, que arquiva o anterior (audit log) e cria a próxima versão.
- `getBracket` / `listMatches` — leitura simples do bracket/lutas ativos.
- `recordResult` — chama `engine.advanceMatch` puro, persiste `updatedMatches`, e se `repechageType !== 'nenhuma'` chama `engine.calculateRepechage` de novo (idempotente por design, ver Fase 3B) recarregando o estado do banco — seguro de chamar depois de toda luta sem o serviço precisar rastrear qual rodada terminou.
- `correctResult` — exige `reason`. **Só é permitido enquanto o resultado antigo não tiver sido decidido em nenhuma luta seguinte** (vencedor/perdedor antigos não aparecem como participante de nenhuma outra luta que já tenha resultado — luta seguinte ainda não disputada pode ser sobrescrita livremente, quantas vezes for preciso). Mesma filosofia de "terminal sem desfazer em cascata" já usada nos status `disqualified`/`withdrawn` de `EventEntry`. Limitação documentada: uma luta de repescagem ainda não disputada mas já **gerada** a partir do perdedor antigo (via `calculateRepechage`, que vincula por participante, não por referência direta) não é re-costurada automaticamente por uma correção — caso de borda fora do escopo desta fase.

**Rotas** (exatamente as do plano original):
```
POST /api/events/:id/divisions/:did/bracket               event_manager+
GET  /api/events/:id/divisions/:did/bracket                staff+
GET  /api/events/:id/divisions/:did/matches                staff+
POST /api/events/:id/divisions/:did/matches/:mid/result    event_manager+
POST /api/events/:id/divisions/:did/matches/:mid/correct   event_manager+  (reason obrigatório)
```

**Testes (15 novos, 137 no total do server):** geração a partir de 8 confirmadas (Chave-8 completa), filtragem por divisão efetiva, 409 sem `force` / 201 com `force` versionando e arquivando, RBAC nas 5 rotas, propagação de vencedor pra luta seguinte, 409 relançando resultado, rejeição de `winnerId` que não é participante, geração automática de repescagem (`normal`) sem duplicar ao chamar de novo, correção permitida antes de propagar (inclusive repetida), bloqueada depois que a luta seguinte tem resultado real, 409 corrigindo luta sem resultado, e Rodízio (schedule fixo + lutas independentes sem propagação).

**Pendente da Fase 3C:** classificação final (`getFinalRankings`) ainda não tem rota própria — fica pra quando o relatório/scoreboard precisar dela (a função já existe e é pura, testada na Fase 3B).

---

### Fase 3D — Concluída (backend) em 2026-07-16 — UI pendente

Implementado exatamente conforme o plano original (seção 7, abaixo), com dois desvios decididos durante a implementação:

**Desvio 1 — `clubName` no `AthleteModel`.** O plano original não previa isso, mas surgiu uma lacuna real: a separação de mesmo-clube no bracket (`BracketService`, Fase 3B/3C) derivava `clubId` de `athlete.academyId`, que neste deployment local-first é **sempre a mesma única academia instalada** (setup bloqueia após a primeira). Ou seja, a separação de clube era um no-op até agora — todo atleta permanente cai no mesmo "clube". Para o import de atletas de academias visitantes fazer sentido (o objetivo real de separar clubes na chave), foi adicionado `clubName?: string` ao `AthleteModel`/`AthleteDTO` (campo livre, opcional, principal uso em atletas `scope:'event-only'`). `BracketService` agora usa `athlete.clubName` quando presente, caindo para `academyId` como antes quando ausente — comportamento anterior preservado para atletas permanentes da academia-sede.

**Desvio 2 — coluna extra `termos_aceitos` no template.** O plano fixava 14 colunas (A–N) sem nenhum campo de consentimento, mas `CreateGuardianInput.termsAccepted` exige `true` literal para criar responsável de atleta menor — importar não podia simplesmente assumir consentimento. Decisão do usuário: adicionar uma 15ª coluna (`termos_aceitos`, S/N, obrigatória para toda linha) em vez de assumir `true` por padrão ou deixar sempre `false` sem caminho de correção. Para atleta menor, `termos_aceitos` diferente de "S" agora é erro de validação da linha (`parseAndValidate` rejeita antes de chegar em `importRows`).

**Modelos:**
- `ImportJobModel` (`repositories/ImportJobModel.ts`) — espelha `ImportJobSchema` do shared; índice `{eventId, importedAt: -1}`.
- `AthleteModel.clubName` — ver desvio 1 acima.

**`ImportService`** (`services/ImportService.ts`):
- `getTemplate()` — gera o `.xlsx` (via `xlsx`/SheetJS) só com a linha de cabeçalho; colunas lidas por posição, não por nome.
- `parseAndValidate(buffer, eventId, academyId)` — lê linha a linha (linha 1 = cabeçalho, dados a partir da linha 2), pula linhas em branco, valida cada campo e devolve `{ valid, errors }` com erros por linha (`row`, `field?`, `message`). Faixa em português mapeada para o enum `Belt`; aceita as cores e graduações oficiais suportadas pelo cadastro, inclusive textos completos como `Coral — 8º Dan` (`preta` sem Dan continua sendo interpretada como 1º Dan por compatibilidade). Data `DD/MM/AAAA` validada com round-trip real (rejeita 31/02). Categoria casada por nome normalizado (trim + lowercase + sem acento) contra as divisões do evento.
- `importRows(rows, eventId, academyId, ctx, importJobId)` — por linha: casa por CPF (dígitos, comparado com o cpf armazenado que pode estar pontuado — `AthleteService` não normaliza CPF na gravação) contra atleta já existente na academia; se não achar, cria `Athlete` `scope:'event-only'` + `Guardian` (se menor) via `AthleteService.createAthlete` (atômico atleta+responsável); depois cria o `EventEntry` (`registrationMethod:'import'`, `importJobId`, `status:'registered'`) como passo separado — ver limitação abaixo. Erros de criação (ex.: linha repetida numa reimportação, índice único `{eventId,divisionId,athleteId}`) viram erro de linha, não abortam o lote.
- `runImport(...)` — orquestra parse + import + grava `ImportJobModel` com totais e todos os erros (validação + criação), e audit log.

**Limitação documentada:** `importRows` não usa uma única transação Mongo cobrindo atleta+entry — cada atleta é criado atomicamente (via `AthleteService`), e o `EventEntry` é um passo seguinte separado. Uma falha exatamente entre os dois passos deixa um atleta órfão sem inscrição; é reportado como erro de linha (nunca perdido silenciosamente) e corrigível reimportando ou editando manualmente. Threading de sessão externa pela `AthleteService` só para este chamador foi considerado over-engineering para o risco real.

**Rotas** (`routes/import.ts`, `@fastify/multipart` registrado só neste plugin):
```
GET  /api/events/:id/import/template          event_manager+
POST /api/events/:id/import                   event_manager+  (multipart, campo "file")
GET  /api/events/:id/import/jobs              event_manager+
GET  /api/events/:id/import/jobs/:jid         event_manager+
```

**Testes (7 novos, 144 no total do server):** template gera cabeçalho correto + RBAC; import válido cria atleta event-only com clubName + entry `registered`/`import`; 9 variações de erro de linha num único lote sem abortar as demais; matching por CPF evita duplicar atleta permanente (inclusive com formatos de CPF diferentes); reimportação da mesma linha vira erro de linha, não crash; listagem e detalhe de job.

**Pendente da Fase 3D:** nada — UI concluída, ver adendo abaixo.

---

### Adendo — Dev runner, graduações e registros federativos (Codex, 2026-07-16)

**Implementado por:** Codex (OpenAI). Este adendo registra alterações feitas pelo Codex sobre a base anteriormente desenvolvida com Claude.

**Runner de desenvolvimento para macOS:**
- Adicionado `pnpm dev:run` no `package.json`, implementado por `scripts/dev-run.mjs`.
- O comando detecta `process.platform`; nesta versão aceita `darwin` e falha com mensagem explícita nos demais sistemas, preservando o mesmo ponto de entrada para suporte futuro a Linux e Windows.
- Inicializa um `MongoMemoryReplSet` efêmero de um nó, injeta a URI em `@sensei-hub/server` e inicia server + web.
- Trata `SIGINT`, `SIGTERM` e `SIGHUP`, encerrando os grupos de processos do server e web e depois o MongoDB. Após 5 segundos sem resposta, força o encerramento dos descendentes.
- Verificado manualmente: API com banco conectado, frontend respondendo em `localhost:3000` e portas 3000/3001 liberadas após `Ctrl+C`.

**Correção da lista de graduações:**
- Criada a fonte de verdade ordenada `BELT_VALUES` em `packages/shared/src/domain/athlete.ts`, consumida pelo Zod, pelos schemas Mongoose e pelas opções do frontend. Isso remove as três enumerações divergentes que existiam antes.
- Ordem suportada: Branca, Bordô, Cinza, Azul, Amarela, Laranja, Verde, Roxa, Marrom, Preta do 1º ao 5º Dan, Coral do 6º ao 8º Dan e Vermelha do 9º ao 10º Dan.
- Identificadores antigos incorretos `black-6dan` a `black-10dan` deixaram de ser aceitos. Foram substituídos por `coral-6dan` a `coral-8dan` e `red-9dan`/`red-10dan`.
- Cadastro, edição, perfil, histórico de faixa e importação Excel usam a mesma ordem e os mesmos rótulos. A importação normaliza acentos, travessões e indicador ordinal.

**Registros FPJ e Zempo/CBJ:**
- O campo existente `federationNumber` foi mantido no contrato e no MongoDB para compatibilidade com dados já gravados, mas sua semântica e seu rótulo na UI agora são explicitamente **Registro FPJ**.
- Adicionado `zempoNumber?: string` ao input, DTO, documento Mongoose, criação, edição, auditoria de alteração e perfil, exibido como **Registro Zempo (CBJ)**.
- Os dois campos são opcionais e independentes.

**Verificação executada pelo Codex:**
- Typecheck limpo em `@sensei-hub/shared`, `@sensei-hub/server` e `@sensei-hub/web`.
- `athlete.test.ts`: 20 testes passando, incluindo ordem completa das graduações, rejeição de `black-6dan` e persistência independente dos números FPJ/Zempo.
- `import.test.ts`: 7 testes passando, incluindo importação real de `Coral — 8º Dan`.

---

### Fase 3D — UI web concluída (2026-07-16)

Revisão do trabalho do Codex antes de continuar: `pnpm -w typecheck` acusou um erro que não constava na verificação acima — `import.test.ts` define sua própria `interface AthleteDTO` local (não importa o tipo do shared) e essa interface estava sem `currentBelt`, usado num `expect` do próprio teste. Corrigido adicionando o campo à interface local (`packages/server/src/__tests__/import.test.ts`); resto do trabalho do Codex conferido linha a linha (models, service, rotas, `dev-run.mjs`) e está correto. `pnpm -w typecheck` limpo nos 4 pacotes e 145 testes do server passando depois da correção.

**UI implementada em `packages/web/src/app/events/[id]/page.tsx`** (seção `ImportSection`, mesmo padrão de `DivisionsSection`/`EntriesSection` já existentes na página, sem arquivo novo): botão "Baixar modelo (.xlsx)" (busca o binário via `fetch` direto com o token — `apiFetch` sempre faz `res.json()`, não serve para blob), input de arquivo + "Importar" (envia `FormData`; `apiFetch` já ignorava `Content-Type` para `FormData`, então funcionou sem mudança na lib), e lista de jobs anteriores (nome do arquivo, data, `sucesso/total`, contagem de erros) com uma tabela de erros por linha (linha/campo/mensagem) que expande ao clicar no job. Visível só para `event_manager+`, mesma RBAC das rotas.

**Bug encontrado e corrigido durante o teste manual (Playwright, ciclo completo com servidor real via `pnpm dev:run`):** depois de um import bem-sucedido, a seção "Inscrições" continuava mostrando "Nenhuma inscrição ainda." até a página ser recarregada manualmente — `EntriesSection` carrega suas próprias inscrições num `useEffect` interno, e não tinha nenhum jeito do componente pai avisá-la de uma mudança externa (a importação acontece em `ImportSection`, um componente irmão). Corrigido subindo um contador `entriesRefreshKey` para o componente de página (`EventDetailPage`), incrementado em `handleImported` (chamado pelo `ImportSection` ao terminar) e passado como prop `refreshKey` para `EntriesSection`, incluído na dependência do `useEffect` de carregamento.

**Testado manualmente via Playwright** (`pnpm dev:run`, replica-set efêmero): setup → login → criar evento → criar divisão "Adulto Aberto" → baixar modelo, montar planilha de teste com `xlsx` (script descartável) → importar 1 linha válida (entrada aparece em "Inscrições" imediatamente, sem reload) → importar uma segunda planilha com 2 linhas inválidas (data 31/02 e categoria inexistente) → confirmar as duas mensagens de erro exatas na tabela expandida do job. Nenhum erro de console.

---

### Correção — planilha de import não deve exigir a coluna "categoria" (2026-07-16)

O usuário apontou, depois da entrega acima, que a coluna `categoria` estava errada por design: quem preenche a planilha (a academia visitante) não sabe e não deveria precisar saber o nome exato da divisão criada pelo organizador do evento — a categoria é *encaixada* pelas regras do campeonato (idade + peso), não escolhida por quem importa.

**Problema de fundo descoberto ao planejar a correção:** `Division` (o bracket do evento) não tem campo de gênero — é texto livre por decisão deliberada da Fase 2 v2 ("deixa a coisa livre"). Encaixar só por idade+peso é ambíguo: uma mulher de 65kg cabe tanto em "Masculino -66kg" quanto em "Feminino -70kg", e o encaixe ingênuo (peso mais justo) erraria para o masculino só porque 66 < 70. Perguntado ao usuário, que confirmou usar o gênero (coluna `genero`, já existente na planilha) para desambiguar quando possível.

**Implementado em `ImportService.ts`:**
- Removida a coluna `categoria` do template (14 colunas, A–N, em vez de 15).
- Nova função pura `matchDivision(candidates, age, gender, weightKg)`: filtra as divisões do evento por faixa etária (`minAge`/`maxAge`) → por peso (`weightLimitKg`) → desempata por gênero *só quando conhecido* (`Division.sourceGroupId` → `DivisionGroup.sourcePreset.groupLabel`, presente apenas quando a divisão veio de `import-from-templates` a partir do preset FPJ sem ter sido renomeada) — divisões sem essa informação (criadas manualmente, ou grupo customizado) continuam elegíveis para qualquer gênero, tratadas como categoria mista. Escolhe a de menor `weightLimitKg` entre as que sobraram (encaixe mais justo); erro de linha se não sobrar nenhuma, se o gênero não bate com nenhuma candidata, ou se sobrar empate genuíno de peso entre duas categorias.
- `calculateAge(birthDate, referenceDate)` novo, mesma lógica de `isMinor` mas retornando a idade em anos.

**Testes:** `import.test.ts` reescrito para as 14 colunas; removido o caso de "categoria inexistente" (não existe mais); adicionados dois testes novos — nenhuma categoria compatível com idade/peso (erro de linha) e desambiguação por gênero usando o preset FPJ real (mulher de 65kg vai para "Feminino — Médio" -70kg, não "Masculino — Meio Leve" -66kg). 147 testes passando no total do server.

**Verificado manualmente via Playwright** (servidor real, `pnpm dev:run`): carregado o preset FPJ completo (14 divisões de "Adulto"), importada uma planilha de 1 linha (mulher, 65kg, sem coluna categoria) e confirmado na UI que a inscrição foi automaticamente para "Adulto — Feminino — Médio", não para a divisão masculina mais leve.

---

### Fase 4A — Áreas (mesas) e roteamento automático de lutas (2026-07-16)

Planejada em modo de plano (agente de arquitetura) antes de implementar, por envolver modelo de dados novo e decisões de RBAC. Plano salvo e aprovado antes da execução.

**Motivação:** discutindo como o operador de placar vai logar, o usuário propôs login compartilhado por função (`placar/placar`) com a área informada pelo próprio operador após o login. Isso expôs um problema mais fundamental: não existia nenhum conceito de mesa/área física, e uma chave grande roda espalhada em várias mesas simultaneamente — não é 1 chave = 1 mesa fixa. A regra real (perguntada e confirmada pelo usuário): nunca deixar mesa ociosa, respeitando um tempo mínimo de descanso do atleta entre lutas, com mesas podendo ser restritas a divisões específicas (ex.: PCD, Sub-11 — tatame menor).

**Fonte oficial do tempo de descanso:** RNC 2025 (CBJ), extraído do PDF oficial via `pdftotext` (instalado `poppler` via Homebrew, pois o `WebFetch` inicial trazia o PDF corrompido) — p.28: *"Para todas as classes, o tempo mínimo de intervalo entre os combates de um mesmo atleta será de 10 minutos."* Vira `Event.restMinutesBetweenMatches`, default 10, editável por evento (outras federações/eventos locais podem divergir) — mesmo padrão de campo já usado para `overweightPolicy`.

**Modelo de dados novo:**
- **`AreaModel`** — `{ eventId, name, allowedDivisionIds: ObjectId[] | null, status: 'open'|'closed', closedReason?, closedAt? }`. `allowedDivisionIds: null` aceita qualquer divisão; uma lista restringe a área a divisões específicas, marcadas manualmente pelo organizador (nunca inferidas — divisões continuam texto livre por design, Fase 2 v2).
- **`Match`** ganha `areaId: ObjectId | null` (preenchido só quando a luta é efetivamente despachada — a mesma chave roda em várias mesas ao longo do evento, não é fixo por divisão) e `result.decidedAt?: Date`, carimbado em `BracketService#persistMatchUpdates` no momento em que o resultado é escrito (tanto `recordResult` quanto `correctResult`) — é a única fonte de "quando a luta desse atleta terminou". Decisão: o carimbo fica na camada de serviço, não no engine puro (`domain/bracket/*` continua sem I/O, preservando a garantia da Fase 3B).
- **`Event.restMinutesBetweenMatches`** — ver acima.

**`AreaService`:** CRUD de área + `closeArea` (libera **incondicionalmente** qualquer luta reservada-mas-não-decidida daquela mesa de volta pro pool — se a divisão da luta não tiver nenhuma outra área aberta que aceite, ela simplesmente não é pega por ninguém até a área reabrir ou outra área ser configurada pra aceitar essa divisão; não precisou de lógica especial pra esse caso "exceção", emerge sozinho do mesmo filtro de `allowedDivisionIds`) + `reopenArea` + `listUnroutableMatches` (lutas prontas cuja divisão nenhuma área aberta aceita agora — usado tanto como retorno de `closeArea` quanto como aviso persistente na tela do evento).

**`MatchDispatchService`:** núcleo puro `pickNextMatch(candidates, lastDecidedAtByAthleteId, restMinutesMs, now)` testado isoladamente sem banco (mesmo espírito de `ImportService.matchDivision`) — filtra por descanso dos dois atletas, escolhe a mais antiga por `updatedAt` (reaproveitado: a escrita que preenche `athleteAId`/`athleteBId` de uma luta subsequente já toca esse campo, então ele reflete "há quanto tempo esta luta está pronta" sem precisar de coluna nova). `getNextMatchForArea` faz a parte de I/O e **reivindica atomicamente** via `findOneAndUpdate({_id, areaId: null, result: null})` — se perder a corrida pra outra área concorrente, tenta a próxima candidata elegível.

**Rotas** (`routes/areas.ts`, plugin independente registrado em `app.ts` igual a `import.ts`):
```
POST   /api/events/:id/areas                       event_manager+
GET    /api/events/:id/areas                        scoreboard_operator+
PATCH  /api/events/:id/areas/:aid                    event_manager+
DELETE /api/events/:id/areas/:aid                    event_manager+  (409 se já despachou alguma luta)
PATCH  /api/events/:id/areas/:aid/close              scoreboard_operator+   { reason }
PATCH  /api/events/:id/areas/:aid/reopen             event_manager+
POST   /api/events/:id/areas/:aid/next-match         scoreboard_operator+   -> { match: {...} | null }
GET    /api/events/:id/areas/unroutable-matches      scoreboard_operator+
```
`close`/`reopen` são `PATCH` (transição de estado sobre um recurso já identificado pela URL, mesmo padrão de `checkin`/`weighin`/`confirm`/`withdraw` do `EventEntry`); `next-match` é `POST` porque busca e reivindica atomicamente um recurso diferente (`Match`), com efeito colateral real — mesmo raciocínio já usado pra `generateBracket`/`recordResult`. `restMinutesBetweenMatches` não ganhou rota própria — viaja no body do `PATCH /api/events/:id` já existente.

**UI:** seção "Áreas (mesas)" em `/events/[id]` (mesmo padrão de `DivisionsSection`) — criar/editar/apagar área, checkboxes de divisões permitidas, fechar/reabrir, aviso de lutas sem área disponível. Tela nova `/events/[id]/operate` para o operador: escolhe a área (login compartilhado, sem conta por pessoa), pede "próxima luta", vê os nomes dos atletas e a divisão. **Não inclui timer/pontuação/declarar vencedor** — isso é a Fase 4B (placar ao vivo, WebSocket), ainda no plano original da seção 7; resultado de luta continua pela rota já existente `POST .../matches/:mid/result` (`event_manager+`), sem mudança de RBAC nesta fase.

**Testes (19 novos, 166 no total do server):** `area.test.ts` (12) — CRUD/RBAC, `allowedDivisionIds` omitido persiste como `null` (não `[]`), fechar libera luta presa, `unroutable-matches` aponta certo, `next-match` respeita `allowedDivisionIds` e o tempo de descanso (cenário real: Rodízio-4, decide uma luta, confirma que a próxima despachada não envolve nenhum dos dois atletas que acabaram de lutar), duas áreas pedindo `next-match` ao mesmo tempo (`Promise.all`) nunca recebem a mesma luta. `matchDispatch.test.ts` (6) — unidade pura de `pickNextMatch`. `bracket.test.ts` (+1) — `result.decidedAt` carimbado em `recordResult` e re-carimbado em `correctResult`.

**Verificado manualmente via Playwright** (servidor real, `pnpm dev:run`): criado evento com divisão "Adulto Geral" (8 inscrições confirmadas, chave gerada via API) e divisão "PCD"; aviso "4 luta(s) sem área disponível" aparece corretamente antes de qualquer área existir; criada "Mesa Geral" (aceita qualquer divisão) — aviso some; tela `/operate` mostra a mesa, "Buscar próxima luta" retorna "Atleta 3 vs Atleta 6" na "Adulto Geral"; fechar a mesa com o motivo "Almoço" via prompt do navegador — volta pro seletor de área (nenhuma aberta), e o evento volta a mostrar o aviso de lutas sem área e "Fechada: Almoço"; reabrir — aviso some de novo. Nenhum erro de console.

---

### Adendo — Comparação com JudoShiai + regras de luta por divisão + salvar único (2026-07-16)

**Comparação com JudoShiai.** A pedido do usuário, o Sensei Hub foi comparado com o JudoShiai (suíte open-source GPL em C/GTK, ~2006–2023, usada em torneios reais há quase duas décadas: app principal + judotimer/judoinfo/judoweight satélites via protocolo TCP próprio). Conclusão: o loop central (inscrição → categoria → chave → despacho por tatame → placar → resultado) é o mesmo, com várias decisões convergentes tomadas de forma independente (descanso mínimo entre lutas, separação de clube no sorteio, regras de placar encapsuladas, balança atrás de adaptador, display público separado do operador). O Sensei Hub está à frente em RBAC/auditoria/gestão de academia/testes; o JudoShiai é mais largo em formatos de chave (17 variantes nacionais de repescagem — fora de escopo para evento local BR) e expôs **5 lacunas reais**, incorporadas ao escopo (ver roadmap):

1. **Regras de luta por divisão** (tempo de luta, osaekomi, golden score) — implementada neste adendo, ver abaixo.
2. **Display público de próximas lutas** por área com contagem de descanso (equivalente do judoinfo) — Fase 4B.
3. **Override manual de despacho** ("esta luta nesta mesa agora", equivalente de `forcedtatami`) — Fase 4B.
4. **Impressão e relatórios** (chave em papel, ficha de pesagem, resultados) — nova fase própria, após a Fase 5.
5. **Ocultação de nome de menores em telas públicas** (estilo GDPR do JudoShiai) — Fase 4B, junto do display público.

**Regras de luta por divisão (`matchRules`) — implementado.** Fonte oficial: RNC 2025 da CBJ (v2, 25/03/2025, cbj.com.br), p.29, extraído do PDF via `pdftotext`: Sub-13 = 2 min, Sub-15 = 3 min, Cadete/Júnior/Sub-23/Sênior = 4 min; golden score em todas as classes, sem limite de tempo (encerra na primeira pontuação; em osaekomi encerra no Yuko); osaekomi Yuko 5s / Waza-ari 10s / Ippon 20s para todas as classes. O RNC não cobre Sub-09/Sub-11 (CBJ começa no Sub-13) — presets `pre-mirim`/`mirim` assumem 2 min como o Sub-13, suposição declarada e editável.

- **Shared:** `MatchRules` (Zod, com refine `yuko < wazaari < ippon`) e `CBJ_DEFAULT_MATCH_RULES` em `domain/divisionTemplate.ts`; campo `matchRules` em `CreateDivisionTemplateInput`/`DivisionTemplateDTO` e em `CreateDivisionInput`/`DivisionSchema` (evento). `goldenScoreEnabled: boolean` (GS é **opcional** por divisão, pedido explícito do usuário) e `goldenScoreDurationSeconds: number | null` (null = sem limite).
- **Server:** subdocumento `matchRules` em `DivisionTemplateModel` e `DivisionModel` (definição compartilhada `matchRulesSchemaDefinition`). Documentos pré-existentes não têm o campo — todo mapeamento para DTO usa fallback `?? CBJ_DEFAULT_MATCH_RULES` (Mongoose não aplica default na leitura); **qualquer leitor futuro (placar da 4B) deve fazer o mesmo**. `fpjPreset.ts` ganhou `matchRules` por classe (helper `cbjRules(segundos)`); `loadFpjPreset`/`createTemplate`/`updateTemplate` gravam e auditam; `import-from-templates` copia as regras do template para cada `Division` criada; divisão manual de evento nasce com o default CBJ. Sem UI de edição de regras por divisão *de evento* nesta fase — entra na 4B junto com o placar que as consome.
- **UI:** `/settings/divisions` ganhou, por card de divisão: tempo de luta (min), checkbox golden score, limite do GS (vazio = sem limite, desabilitado se GS desligado) e os três tempos de osaekomi. Modo leitura mostra resumo em prosa.

**Salvar único em `/settings/divisions` — implementado.** O usuário apontou que um botão "Salvar" por card de divisão + um por grupo era "extremamente confuso". A página foi reescrita: estado `draft` centralizado no componente de página (todos os inputs controlados; `WeightCategoryGrid` virou componente controlado sem salvar próprio), `dirty` por comparação estrutural com o último snapshot do servidor, **uma única barra fixa no rodapé** ("Salvar alterações" / "Descartar") que salva em lote via os mesmos PATCHes de sempre (um por divisão alterada, um por grupo alterado; erro identifica qual item falhou e mantém o rascunho). Aviso de alterações não salvas: `beforeunload` (fechar/recarregar aba) + `confirm` no "← Voltar". Ações estruturais (criar/apagar divisão ou grupo, carregar preset, restaurar FPJ) continuam imediatas, mas com rascunho pendente pedem confirmação de descarte antes de recarregar a tela.

**Testes (6 novos, 172 no total do server):** default CBJ na criação sem `matchRules`; PATCH persiste regras novas (GS desligado); 400 para osaekomi não estritamente crescente; `load-preset` com os tempos RNC por classe (120/120/120/180/240/240s); fallback CBJ para documento legado sem o campo; `import-from-templates` herdando as regras do template (Sub-13 → 120s em todas as divisões geradas).

**Verificado manualmente via Playwright** (`pnpm dev:run`): preset FPJ carrega com os tempos certos por divisão; edição simultânea de tempo de luta + GS + categoria de peso em divisões diferentes → uma única barra de salvar → tudo persistido após reload; "← Voltar" com rascunho pendente mostra confirm (cancelar mantém a página); "Restaurar valores da FPJ" com rascunho pendente pede confirmação de descarte e restaura só as categorias (regras de luta preservadas); limite do GS desabilitado quando GS desligado; modo leitura como `staff` (resumo em prosa, zero botões, inputs desabilitados). Nenhum erro de console. Typecheck limpo nos 4 pacotes.

---

### Fase 4B — Placar ao vivo (2026-07-17) + Fase 5.5 — Impressão (2026-07-17)

Pedido do usuário: "implemente o restante, para o placar, copie na cara dura do judoshiai" — ou seja, reproduzir o **comportamento** do judotimer (JudoShiai, GPL v3) em código TypeScript original. Decisão explícita: portar a lógica C linha a linha contaminaria o projeto com a licença GPL do JudoShiai (CLAUDE.md proíbe copiar Zempo/terceiros); as regras de pontuação de judô em si (ippon/waza-ari/yuko/shido, osaekomi, golden score) são fatos públicos do RNC da CBJ, não propriedade do JudoShiai — o que foi replicado é o *comportamento observável* (relógio autoritativo no servidor, osaekomi convertendo por tempo, golden score encerrando na primeira pontuação, display público separado do operador), com implementação 100% nova.

**Módulo puro de regras** (`packages/server/src/domain/scoreboard/rules.ts`, sem I/O, testado isoladamente):
- `applyScore`/`removeScore`: 2º waza-ari vira awasete-ippon automaticamente; 3º shido vira hansoku-make (derrota direta); remoção desfaz essas conversões corretamente (testado).
- `osaekomiAward(elapsedSeconds, rules, phase)`: converte tempo de imobilização em yuko/waza-ari/ippon pelos limiares de `Division.matchRules` (a mesma fonte CBJ RNC 2025 da Fase 4A.1); em golden score o resultado é capado em yuko, conforme o RNC ("no caso de osaekomi, o combate terminará no Yuko").
- `leader`/`endsFight`: define quem está à frente e se a luta já tem decisão (ippon, hansoku-make, ou primeira pontuação em golden score).

**`packages/server/src/domain/publicName.ts`** (puro): `publicDisplayName()` — quando `Event.publicHideNamesUnderAge` está configurado, atletas abaixo dessa idade na data do evento aparecem como "Nome S." em qualquer tela pública; operador sempre vê o nome completo. Campo novo em `EventModel`/shared, editável no cabeçalho do evento.

**`ScoreboardModel` + `ScoreboardService`** (`packages/server/src/repositories/ScoreboardModel.ts`, `services/ScoreboardService.ts`):
- Um placar por luta (`matchId` único parcial sobre `status:'active'`); `matchRules` é **copiado (snapshot)** da divisão no momento em que a luta começa — editar a divisão no meio do evento nunca muda uma luta já em andamento.
- Relógio autoritativo no servidor: `{ clockMs, running, lastStartedAt, countsUp }`; o valor exibido é sempre derivado (`clockMs ± tempo decorrido desde lastStartedAt`), nunca hardcoded num timer client-side solto. Regra e GS limitado contam regressivo; GS ilimitado conta progressivo a partir de zero.
- `startScoreboard` é idempotente (reabrir a tela do operador não duplica o placar). `declareWinner` chama `BracketService.recordResult` — fecha o loop com a persistência de bracket da Fase 3C (o resultado do placar *é* o resultado da chave, uma única fonte de verdade). `abortScoreboard` libera a luta de volta ao pool de despacho.
- Toda pontuação decisiva (ippon, hansoku-make, primeira pontuação em GS) trava automaticamente o relógio e o osaekomi em andamento — testado.
- Correção de pontuação (`removeScoreCorrection`) e ajuste manual de relógio (`setClock`) exigem motivo e geram audit log, seguindo a convenção de correções sempre auditadas (CLAUDE.md).
- **Broadcast:** `EventEmitter` interno (`scoreboardEvents`) — cada mutação emite o DTO **já filtrado de privacidade** (nomes públicos) por área; a rota WebSocket (`GET /api/public/areas/:areaId/ws`, sem auth) escuta e retransmite. Documentado no código como decisão single-node: quando o `ClusterManager` da Fase 7 existir, isso vira consumidor de MongoDB Change Stream para cada nó retransmitir aos seus próprios clientes.

**Override manual de despacho** (`MatchDispatchService.forceMatchToArea`, equivalente do `forcedtatami`/`forcednumber` do JudoShiai): `event_manager+` pode mandar uma luta específica para uma mesa específica agora, ignorando `allowedDivisionIds` da área (decisão explícita do organizador) mas **respeitando o descanso mínimo do atleta por padrão** — só ignora com `ignoreRest:true` explícito. Recusa se a luta já está com placar ativo em outra mesa.

**Classificação final** (`BracketService.getRankings`, rota `GET /events/:id/divisions/:did/rankings`): usa o `getFinalRankings` puro já existente desde a Fase 3B; 409 se o bracket ainda tiver luta pendente (evita mostrar pódio incompleto).

**`PublicDisplayService`** (equivalente do judoinfo): `GET /api/public/events/:id/display` — cada mesa com sua luta atual (ou "livre") + fila de próximas lutas com contagem de descanso por atleta (mesma fonte de dados do `MatchDispatchService`: `result.decidedAt` + `Event.restMinutesBetweenMatches`).

**UI:**
- `packages/web/src/components/ScoreboardPanel.tsx` — painel do operador: relógio grande, osaekomi com cronômetro visível, marcação de ippon/waza-ari/yuko/shido por lado com botão de correção (−) ao lado de cada um, golden score, declaração de vencedor com **sugestão automática** calculada de `leader()` (testado: acertou "Kaue Pereira Lima por ippon" corretamente). Integrado em `/events/[id]/operate` (substituindo o placeholder da Fase 4A que só buscava a próxima luta).
- `/display/areas/[areaId]` — telão público de uma mesa: preto, texto gigante, sem nenhum controle; WebSocket com reconexão automática e fallback de polling (rede de ginásio instável, CLAUDE.md).
- `/display/events/[id]` — telão do evento: todas as mesas + fila de próximas lutas com descanso, polling 5s.
- Campo "Ocultar nome de menores de (anos)" no cabeçalho do evento (`event_manager+`).

**Fase 5.5 — Impressão** (lacuna identificada na comparação com JudoShiai): três telas de impressão (`event_manager`/`staff`+), layout tabela com botão "Imprimir" (`window.print()`), sempre com nomes completos (uso interno, não passa pela ocultação de menores):
- `/events/[id]/print/weighin` — ficha de pesagem por divisão (nome, agremiação, campo de peso e assinatura em branco).
- `/events/[id]/print/bracket/[did]` — chave em tabela agrupada por rodada/estágio, com resultado preenchido onde já decidido.
- `/events/[id]/print/results/[did]` — pódio final via `getRankings`.

**Testes (17 novos, 195 no total do server):** `scoreboard.rules.test.ts` (regras puras: awasete-ippon, hansoku-make, limiares de osaekomi, GS capado em yuko, leader, endsFight) e `scoreboard.test.ts` (integração completa: ciclo de vida idempotente, recusa de luta não despachada pra área, relógio + pontuação travando em score decisivo, osaekomi convertendo em ippon, golden score só com empate e habilitado, correção com motivo, abort liberando a luta, RBAC, ocultação de nome de menor no payload público e no broadcast, telão do evento com fila e descanso, force-match respeitando/ignorando descanso e recusando luta já ao vivo, rankings 409 antes de decidir tudo).

**Bug encontrado e corrigido durante a implementação:** `BracketModel.slots.clubId` estava tipado como `Schema.Types.ObjectId` (referência a `Academy`), mas `BracketService` grava ali tanto `athlete.clubName` (string livre, atletas visitantes da Fase 3D) quanto `academyId` — gerar uma chave com qualquer atleta tendo `clubName` preenchido quebrava com erro 500 de cast do Mongoose. Campo é só uma chave de comparação para separação de mesmo clube no sorteio, nunca uma referência de verdade; corrigido para `type: String`.

**Bug encontrado e corrigido durante o teste manual:** a página de resultados (`print/results`) mostrava a mensagem de erro do backend crua em inglês ("Bracket is not fully decided yet") quando o bracket ainda não estava decidido, violando a convenção de mensagens traduzidas (`translateApiError`, `lib/labels.ts`). Adicionadas ~25 traduções novas cobrindo todas as mensagens de erro dos services desta fase (placar, despacho, chave/rankings), mais um regex novo para a mensagem dinâmica de descanso do `force-match`.

**Verificado manualmente via Playwright** (`pnpm dev:run`, evento real com 3 atletas menores de 13 anos, divisão Sub-13 com `matchRules` de 2min, chave rodízio-3): login → operador escolhe mesa → busca luta → inicia placar (relógio em 2:00, clube exibido) → inicia tempo → marca waza-ari → confirma no telão público em aba separada que o WebSocket propagou o waza-ari e o nome apareceu ocultado ("Rafael S.") em tempo real → osaekomi iniciado e parado após >20s reais → converteu corretamente em ippon (travou relógio e todos os botões de pontuação, manteve as correções ativas) → sugestão automática de vencedor acertou "Kaue Pereira Lima por ippon" → confirmado → overlay de vencedor no telão público também com nome ocultado → telão do evento mostrou a mesa livre e a próxima luta com contagem de descanso do atleta que acabou de lutar → decididas as 2 lutas restantes do rodízio via API → impressão da ficha de pesagem (nomes completos), da chave (resultado da luta 2 preenchido, demais em branco) e do pódio final (1º Kaue, 2º Rafael, 3º Bruno) todas corretas. Erro de tradução encontrado e corrigido durante este teste (ver acima). 195 testes passando, typecheck limpo nos 4 pacotes.

---

### Fase 5 — Check-in + Weigh-in (2026-07-17)

Implementada de forma autônoma seguindo o plano já esboçado na seção 7 (usuário ausente durante a implementação — "continue as próximas ações do projeto... só pare se bloqueio impossível"). O check-in *por status de inscrição* (`EventEntryService.checkIn(entryId)`, um clique na tabela de inscrições) já existia desde a Fase 3A; o que faltava, e é o núcleo desta fase, é a camada de **presença física** com busca, prevenção de duplicata e desfazer auditável — exatamente o "Mobile Check-In" descrito no CLAUDE.md.

**Modelo de dados novo — `AttendanceModel`:** desacoplado de `EventEntry` por design: uma atleta pode ter várias inscrições (divisões) no mesmo evento, mas presença física é um fato só, por evento. `{ eventId, athleteId, academyId, method, operatorId, checkedInAt, status: 'active'|'revoked', revokedReason?, revokedBy?, revokedAt? }`. Índice único **parcial** sobre `status:'active'` (mesmo padrão já usado em outros lugares do projeto): bloqueia check-in duplicado ativo, mas permite novo check-in depois de um `undo` — que revoga, nunca deleta (auditoria).

**`CheckInService`:**
- `checkIn(eventId, academyId, athleteId, method, ctx)` — cria o `Attendance`; **não exige que a atleta já tenha uma inscrição** (decisão explícita: presença é independente de estar sorteada numa divisão — staff pode encaixar a categoria depois); avança para `checked_in` todas as inscrições da atleta que estiverem em `registered` neste evento, reutilizando `EventEntryService.checkIn(entryId)` já existente (uma chamada por inscrição, com a auditoria que esse método já faz). Duplicata ativa → 409 com o `AttendanceDTO` anterior anexado (`err.details`), não silencia.
- `undoCheckIn(eventId, academyId, attendanceId, reason, ctx)` — revoga (reason obrigatório, audit log) e reverte **só** as inscrições que ainda estão exatamente em `checked_in`; inscrições que já avançaram (pesada, confirmada) ficam intocadas — mesma filosofia de "sem desfazer em cascata além de um estágio" já usada na correção de resultado de luta.
- `listAttendance` — para a lista de "check-ins recentes" da tela.

**Rotas:** `POST /api/events/:id/checkin` (`staff+`), `DELETE /api/events/:id/checkin/:aid` (`event_manager+`, reason obrigatório), `GET /api/events/:id/checkin` (`staff+`, filtro `?status=`) — exatamente como planejado na seção 7.

**Balança — `ScaleAdapter`:** interface (`getLatestReading()`, `isConnected()`) em `packages/server/src/adapters/ScaleAdapter.ts` (diretório já reservado desde a Fase 0, vazio até agora) + `MockScaleAdapter` (leitura simulada suave, sempre "conectada" em dev). Nenhum hardware real integrado ainda — é o ponto de troca único quando um adaptador de vendor real existir, conforme CLAUDE.md ("Integration Design": isolar atrás de adapter, mock para testes, falha de hardware nunca bloqueia). Rota `GET /api/scale/reading` (`weigh_in_operator+`) devolve `{ connected, reading }`; desconectado ou sem leitura não é erro, é `reading: null` — a UI cai em silêncio para entrada manual.

**UI — `/events/[id]/checkin` (nova tela, mobile-first):** campo de busca com foco automático (reusa `GET /athletes?q=` já existente — nome/CPF/matrícula, sem inventar endpoint novo), resultados com alvo de toque grande, confirmação em duas etapas (evita check-in acidental por toque errado), mensagem de sucesso grande que some sozinha após alguns segundos e já limpa/refoca a busca para a próxima atleta na fila, lista de "check-ins recentes" com desfazer inline (só para `event_manager+`, espelhando a RBAC da rota). Métodos `qr`/`short_code` reservados no enum para hardware futuro (scanner/kiosk) — deliberadamente **não implementados** nesta fase (sem infraestrutura de câmera no projeto; seria escopo novo, não "reusar o que existe"). Link "Check-in" adicionado na seção de Inscrições da página do evento.

**UI — pesagem:** a tela existente (Fase 3A) ganhou um botão "⚖ Ler balança" ao lado do campo de peso manual, que busca uma leitura do `ScaleAdapter` e só **pré-preenche** o campo — o operador sempre confirma manualmente antes de gravar (CLAUDE.md: "todas as leituras devem ser confirmáveis pelo operador antes de virarem oficiais"). Falha ou desconexão da balança falha em silêncio, nunca bloqueia a digitação manual.

**Testes (13 novos, 208 no total do server):** criação de Attendance avançando a inscrição certa; check-in permitido com zero inscrições; só inscrições em `registered` avançam (uma retirada antes do check-in fica intocada); 409 com detalhes do check-in anterior em duplicata (inclusive corrida de concorrência via erro de índice único); 404 para atleta fora da academia; RBAC de `staff+` no check-in; undo revogando e revertendo só o que ainda está em `checked_in`; undo não mexe em inscrição já pesada; reason obrigatório e 409 desfazendo duas vezes; RBAC de `event_manager+` no undo; listagem filtrável por status; leitura da balança (conectada, com valor positivo) e sua RBAC de `weigh_in_operator+`.

**Verificado manualmente via Playwright** (`pnpm dev:run`): busca por nome encontrando a atleta certa → confirmação em duas etapas → check-in bem-sucedido mostrando "1 inscrição(ões) avançada(s)" → tentativa de duplicata mostrando o check-in anterior com opção de desfazer → desfeito → check-in de novo com sucesso (índice parcial permitindo) → na página do evento, a inscrição já aparecia "Check-in feito" com "Registrar pesagem" disponível → botão "Ler balança" preencheu o campo com uma leitura simulada → peso confirmado, inscrição avançou para "Pesada". Nenhum erro de console real (só os 404/409 esperados de rede, próprios do fluxo). Servidor de dev encerrado ao final. 208 testes passando, typecheck limpo nos 4 pacotes.

---

### Fase 6 — PWA + Offline (2026-07-17)

Implementada de forma autônoma (usuário ausente — "continue as próximas ações do projeto... só pare se bloqueio impossível"), seguindo o esboço da seção 7 com um desvio de arquitetura deliberado e dois recortes de escopo conscientes, todos documentados abaixo.

**Desvio de arquitetura — Cache Storage em vez de IndexedDB para dados de leitura.** O plano original dizia "cache read-only de lista de atletas e estrutura do evento em IndexedDB". Na implementação, o cache de leitura usa o **Cache Storage nativo do service worker** (via Serwist/Workbox `NetworkFirst`), não uma réplica manual em IndexedDB — é exatamente o mecanismo que service workers existem para prover, evita reescrever à mão uma sincronização de cache que o navegador já resolve, e é o padrão usado por toda a comunidade Next.js/Serwist. **IndexedDB foi reservado para o que ele resolve de verdade nesta base**: a fila de escritas pendentes (outbox), que precisa de status por item, índice por status e consultas estruturadas — Cache Storage não serve para isso.

**Escopo 1 — só duas rotas entram na fila offline.** De todas as mutações do app, apenas **check-in** (`POST /events/:id/checkin`) e **pesagem** (`PATCH /events/:id/entries/:eid/weighin`) enfileiam quando a rede falha. São exatamente os dois fluxos que o CLAUDE.md cita nominalmente como precisando de resiliência offline ("Mobile Check-In", "Weigh-In Integration... tolerate bad internet and allow safe retry"). Resultado de luta, ações de placar e qualquer outra mutação **não** enfileiam — replay automático e não supervisionado de uma decisão de torneio é uma categoria de risco diferente de "esta pessoa chegou"/"este é o peso dela", e não há política de resolução de conflito definida pelo dono do produto para esse caso. A fila nunca inventa lógica de conflito nova: ela só reenvia a requisição original quando a conexão volta; é a própria validação do backend (índices únicos, máquinas de estado explícitas, 409s) que decide se a escrita ainda faz sentido — uma rejeição vira item "com erro" na tela, nunca é descartada nem re-tentada para sempre em silêncio.

**Escopo 2 — busca de check-in virou local, não deixou de ser online.** Durante a verificação manual descobri que a busca por texto (`GET /athletes?q=...`) gera uma URL nova a cada tecla digitada, quase nunca batendo no cache — significaria que a operadora da porta não conseguiria encontrar ninguém que não tivesse buscado antes enquanto ainda tinha internet. Corrigido: a tela de check-in carrega a lista completa uma vez (`GET /athletes?pageSize=500`, o que já aquece o cache do service worker) e filtra por nome/CPF/matrícula **no cliente**, sem round-trip por busca. Ganho duplo: funciona offline de verdade, e a busca fica instantânea mesmo online (sem debounce de rede).

**Service Worker (`packages/web/src/app/sw.ts`, via `serwist`/`@serwist/next`):** só ativa em build de produção (`disable: NODE_ENV !== 'production'` no `next.config.ts` — dev já tem hot reload, um SW brigando com isso só atrapalharia). Precache do app shell (Serwist `defaultCache`) + `NetworkFirst` com timeout de 4s para as rotas de leitura seguras (`/api/athletes`, `/api/events*`) — tenta rede primeiro, cai para o último cache válido se a rede falhar ou demorar. Excluído deliberadamente do `tsconfig.json` principal (`exclude: ["src/app/sw.ts"]`): o arquivo roda em contexto `ServiceWorkerGlobalScope`, incompatível com o `lib: ["DOM"]` do resto do projeto — é o padrão recomendado pela própria Serwist para Next.js App Router.

**Fila de escritas — `packages/web/src/lib/offlineQueue.ts`** (IndexedDB via `idb`): `enqueueOfflineWrite`/`drainOfflineQueue`/`retryOfflineWrite`/`dismissOfflineWrite`/`countOutstandingWrites`. `drainOfflineQueue` distingue dois tipos de falha ao reenviar: se o `fetch()` em si falhar (rede ainda fora), para o esvaziamento e deixa o resto como `pending` para a próxima tentativa; se o servidor responder com um erro de negócio real (`ApiError`, ex. duplicata), marca o item como `failed` com a mensagem traduzida e **continua** tentando os demais — essa falha não é sobre conectividade, então não deve travar a fila inteira.

**`SyncStatusBadge`** (`packages/web/src/components/SyncStatusBadge.tsx`): indicador fixo global, invisível quando online e sem nada pendente. Reage a `online`/`offline` do navegador (hook compartilhado `useOnlineStatus`) e a um temporizador de segurança de 30s (WiFi de ginásio às vezes fica "online" mas inacessível — captive portal, sinal fraco). Painel expansível lista cada item com "tentar de novo"/"descartar".

**Bug real encontrado e corrigido durante a verificação manual — perda silenciosa de item com erro.** A primeira versão do badge só contava itens com `status:'pending'` para decidir se aparecia (`countPendingWrites`); um item que falhava por regra de negócio (ex. duplicata) virava `status:'failed'` e **desaparecia completamente da tela** assim que a conexão voltava — exatamente a "perda silenciosa de dado" que o CLAUDE.md proíbe explicitamente. Corrigido: `countPendingWrites` virou `countOutstandingWrites` (conta `pending` **e** `failed`), e o badge fica vermelho e visível enquanto houver qualquer item precisando de atenção humana, mesmo online. Achado ao forçar deliberadamente uma falha de negócio na fila (check-in duplicado) e observar que o badge sumia sem avisar ninguém.

**Weigh-in offline:** o formulário inline de pesagem (Fase 3A/5) ganhou o mesmo tratamento do check-in — falha de rede vira item na fila com descrição `"Pesagem: <atleta> (<peso>kg)"`, mensagem inline "salvo neste aparelho, vai sincronizar automaticamente" em vez de erro.

**Aviso explícito no placar:** a tela do operador (`/events/[id]/operate`) mostra um banner vermelho quando offline avisando que o placar ao vivo exige conexão (WebSocket) e não funciona sem internet — cumprindo a exigência literal do plano ("Scoreboard não funciona offline — UI diz isso claramente") sem fingir suporte que não existe.

**Acesso via QR code (`packages/app/src/kiosk.ts`):** um QR code pequeno e não-interativo (`pointer-events:none`, canto inferior direito) aparece na janela kiosk do Electron assim que a página carrega, codificando `http://<ip-da-lan>:3000` (primeiro IPv4 não-interno via `os.networkInterfaces()`) — permite que celulares/tablets no mesmo WiFi do ginásio apontem a câmera e caiam direto na tela de check-in/pesagem. Best-effort: se não achar IP de LAN ou a geração do QR falhar, simplesmente não mostra nada, nunca trava a inicialização do kiosk. Zero-config via mDNS (`senseihub.local`) continua reservado para a Fase 7, como já estava documentado.

**Manifest e ícone:** `public/manifest.json` (nome, cores, ícone, `display:standalone`) + `public/icon.svg` — um quadrado escuro genérico com "SH", sem qualquer semelhança com identidade visual de terceiros (CLAUDE.md — não copiar branding). SVG em vez de PNG rasterizado para não precisar de dependência de rasterização.

**Dependências novas:** `serwist` + `@serwist/next` (web — service worker, é literalmente o que o plano pedia), `idb` (web — wrapper fino sobre IndexedDB, evita código manual de baixo nível para a fila), `qrcode` (app/Electron — geração de QR sem dependência nativa).

**Verificado manualmente end-to-end** — não só com `pnpm dev:run` (que roda o web em modo dev, onde o Service Worker fica desativado por design): foi necessário um **build de produção real** (`next build && next start`) para exercitar o SW de verdade. Ao longo da verificação, dois processos de servidor concorrentes ficaram presos em segundo plano depois de tentativas de reinício mal-sucedidas e serviram por um tempo um bundle desatualizado sem o fix do badge — resolvido matando todos os processos Node explicitamente por porta e reconstruindo do zero (`rm -rf .next && next build`) antes de confirmar visualmente. Ciclo completo confirmado: login → SW registrado e ativo (`navigator.serviceWorker.getRegistrations()`) → navegação normal populando o Cache Storage (`/api/athletes` presente) → **offline real via CDP** (`context.setOffline(true)`, não só desconectar Wi-Fi) → busca local funcionando sem rede → check-in enfileirado no IndexedDB → **online de novo** → fila esvaziada automaticamente e o check-in real confirmado no backend (`GET /entries` mostrando `checked_in`) → item de erro forçado (duplicata) → badge vermelho "1 com erro" → painel expandido mostrando motivo traduzido → "descartar" limpando o item. 209 testes passando (1 novo cobrindo a persistência de `entriesUpdated`, achado colateral desta verificação — ver abaixo), typecheck limpo nos 4 pacotes.

**Bug colateral encontrado e corrigido — `entriesUpdated` nunca era persistido.** Ao testar o check-in em fila, notei que `GET /events/:id/checkin` sempre devolvia `entriesUpdated: 0` para qualquer registro, mesmo quando o check-in original tinha avançado uma inscrição de verdade — o valor só existia na resposta do `POST` (calculado em memória, nunca salvo no documento `Attendance`). Corrigido gravando `entriesUpdated` no documento no momento da criação (`AttendanceModel` ganhou o campo); a listagem agora lê o valor real. Teste de regressão adicionado (`checkin.test.ts`).

---

### Fase 7 — ClusterManager mDNS + RS dinâmico (2026-07-17)

Implementada de forma autônoma (usuário ausente — "continua entao"). É a fase de maior risco arquitetural do projeto até aqui (sistemas distribuídos, descoberta de rede, reconfiguração de replica set em produção) — tratada com o cuidado correspondente: implementação incremental, teste real a cada passo, e uma seção de verificação honesta ao final que **não esconde a única parte que não pôde ser confirmada de forma confiável neste ambiente**.

**Divisão de responsabilidade — decisão de arquitetura central.** Desde a Fase 0, `Supervisor` (`packages/app`) sempre chamava `rs.initiate()` incondicionalmente ao subir o mongod (assumindo sempre nó único). Isso é incompatível com um cluster dinâmico: se o Supervisor sempre inicia o replica set sozinho antes mesmo do servidor subir, nunca haveria uma janela para decidir "virar primary fundador" vs. "entrar num cluster existente". Resolvido separando claramente as responsabilidades:
- **`Supervisor` continua dono exclusivo de subir/derrubar processos do SO** (mongod, server, e agora também o mongod-arbiter) — mas em modo cluster (`clusterEnabled: true`), **para de chamar `rs.initiate()`** e apenas sobe o mongod (bound em `0.0.0.0`) sem inicializá-lo.
- **`ClusterManager` (novo, dentro do processo do server) é o único dono da decisão "iniciar ou entrar"** — porque só ele tem o contexto de descoberta mDNS necessário para essa decisão, e essa decisão precisa acontecer **antes** do `mongoose.connect()` (via `connectDatabase()`) rodar com a URI ciente de replica set — um mongod com `--replSet` mas nunca inicializado/adicionado a uma config não é um membro utilizável ainda.
- `packages/server/src/index.ts` foi reestruturado: quando `CLUSTER_ENABLED=true`, `ClusterManager.bootstrap()` roda e precisa **completar** antes de `connectDatabase()` ser chamado.
- `Supervisor.stop()` mudou de matar server+mongod **em paralelo** para **sequenciado** (server primeiro, espera sair, só depois mongod) — o `gracefulLeave()` do server (stepDown/reconfig) precisa do próprio mongod vivo para terminar; matar os dois ao mesmo tempo arriscava uma corrida perdida.

**Modelo de dados/protocolo (`packages/shared/src/domain/cluster.ts`):** `ClusterStatusDTO` (nós, papéis, saúde, lag de replicação, `hasArbiter`/`needsArbiter`), `ClusterJoinRequest`. Rota humana (`GET /api/cluster/status`) exige `super_admin` (não é um conceito por academia — é infraestrutura). Rota nó-a-nó (`POST /api/cluster/join`) **não usa JWT de usuário** — um nó recém-instalado não tem contexto de academia/usuário nenhum ainda — autentica via header `X-Cluster-Secret` comparado a um segredo compartilhado (`CLUSTER_SECRET`, mesmo princípio de uma chave pré-compartilhada de WiFi).

**`packages/server/src/cluster/rules.ts`** — lógica pura, sem I/O, mesmo padrão de `domain/bracket`/`domain/scoreboard/rules.ts`, 14 testes unitários:
- `decideBootstrapAction(peers)`: `initiate` (zero peers), `join` (achou um peer anunciando `role:'primary'`), ou `retry` (achou peers mas nenhum é primary ainda — eleição em andamento no cluster existente).
- `excludeSelf(peers, selfHost)`: descrito abaixo — defesa contra um nó se descobrir a si mesmo.
- `computeNeedsArbiter(members)`: exatamente 2 membros com dados (voto), sem arbiter — a condição clássica de "empate de eleição" do MongoDB.
- `toClusterStatusDTO(...)`: mapeia `replSetGetStatus` bruto pro DTO, calculando lag de replicação real a partir do `optimeDate` de cada secundário vs. o primary.

**`packages/server/src/cluster/mdns.ts`** — protocolo próprio sobre `multicast-dns`, deliberadamente simplificado (não é DNS-SD espec-perfeito para interoperar com Bonjour genérico — só nós sensei-hub falam esse protocolo entre si): anuncia/descobre `_senseihub._tcp.local` com um payload JSON único num registro TXT (em vez de PTR+SRV+TXT separados), e responde a queries A para `senseihub.local` só quando este nó é o primary atual (permite que tablets/QR code da Fase 6 sempre cheguem em "quem for primary agora", sem saber o IP de antemão).

**`packages/server/src/cluster/ClusterManager.ts`** — orquestra tudo: `bootstrap()` (decide e executa iniciar/entrar, com até 3 tentativas de descoberta antes de desistir), `handleJoinRequest()` (roda no primary: `replSetReconfig` manual — sem os helpers do shell `rs.add()`, direto nos comandos administrativos do driver, idempotente), `getStatus()`, `gracefulLeave()` (stepDown se primary + espera reeleição + remove a si mesmo da config via quem for o primary depois), watcher de papel a cada 5s (atualiza o anúncio mDNS e o alias `senseihub.local` sempre que uma eleição muda quem é primary).

**Arbiter automático para N=2** — `Supervisor` ganhou a capacidade de subir um mongod arbiter-only (`--replSet ... --port 27018`, sem dados reais) quando `GET /api/cluster/status` do próprio nó reporta `needsArbiter:true` **e** este nó é o primary atual (só o primary spawna — evita dois nós tentando criar arbiters duplicados simultaneamente, já que ambos os membros de um cluster N=2 veem `needsArbiter:true` ao mesmo tempo).

**Dois bugs reais de protocolo mDNS encontrados e corrigidos durante a verificação manual** (nenhum dos dois foi pego pelos testes unitários — são bugs de fiação de rede, não de lógica de decisão):
1. **TXT em `additionals`, não em `answers`.** O respondente coloca a resposta TXT no array `additionals` do pacote (junto com o PTR em `answers`, um único round-trip). O código de descoberta só escaneava `packet.answers`, nunca `packet.additionals` — nenhum peer era encontrado, mesmo com o respondente respondendo corretamente. Corrigido escaneando os dois arrays.
2. **Loopback do mDNS fazendo um nó se descobrir a si mesmo.** `multicast-dns` entrega por padrão os próprios pacotes de saída de volta ao mesmo processo (`loopback: true`). Um nó em bootstrap anuncia `role:'secondary'` (valor provisório) *antes* de começar a descoberta — com loopback ligado, ele recebia esse próprio anúncio de volta como se fosse "um peer" com `role:'secondary'`, caindo sempre no branch `retry` (peers existem, nenhum é primary) mesmo estando completamente sozinho. Corrigido com `loopback:false` na criação do socket **e** uma segunda camada de defesa pura (`excludeSelf`) comparando o host descoberto contra o próprio, para o caso de o SO/rede ecoar pacotes por algum outro caminho.

**Limitação de verificação — honesta, não escondida.** A camada de *transporte* da descoberta mDNS (multicast UDP bruto entre processos) não pôde ser confirmada de forma confiável **neste ambiente de execução específico** (sandbox do Claude Code): dois processos Node na mesma máquina, mesmo depois dos dois bugs acima corrigidos, tiveram entrega intermitente e não-determinística de pacotes multicast entre si — confirmado não ser um problema de porta (testado também numa porta UDP alternativa, mesmo resultado) nem um bug determinístico do meu código (um teste isolado idêntico funcionou perfeitamente na primeira tentativa, e falhou de forma diferente em tentativas subsequentes). A hipótese mais provável é uma particularidade do isolamento de rede do próprio ambiente de execução para tráfego multicast entre processos — **não** uma limitação inerente ao protocolo mDNS em produção real, onde cada nó do cluster é uma **máquina física diferente**, cada uma com seu próprio kernel/interface de rede, que é justamente o cenário para o qual mDNS foi desenhado (essa contenção específica de "múltiplos processos disputando a mesma pilha de rede local" não existe entre máquinas fisicamente separadas).

Dado isso, o que foi **efetivamente verificado com infraestrutura real** (dois `mongod` reais em portas diferentes, dois processos de servidor reais, sem nenhum mock) foi tudo que não depende da camada de transporte mDNS, contornando-a deliberadamente com uma chamada HTTP direta ao endpoint de join (exatamente o que um nó faria de qualquer forma *depois* de descobrir o primary — a parte testada é a parte de maior risco real, a reconfiguração do replica set):
- Nó fundador: zero peers → `replSetInitiate` real → vira primary → `/api/cluster/status` correto.
- `POST /api/cluster/join` chamado diretamente (autenticado via `X-Cluster-Secret`) → `replSetReconfig` real no primary → o mongod do nó que entrou (nunca inicializado localmente, só apontado pro mesmo `--replSet`) **sincronizou sozinho automaticamente** assim que a config do primary passou a incluí-lo (comportamento nativo do protocolo de replicação do MongoDB, sem nenhuma ação adicional do lado de quem entra) → `/api/cluster/status` mostrou os dois nós, papéis corretos, **`replicationLagSeconds` calculado a partir de dados reais de replicação** (não um valor fixo), e `needsArbiter:true` corretamente detectado para N=2.
- `SIGTERM` no primary → `gracefulLeave()` disparou de verdade (via o novo hook `onClose` + handler de sinal) → `replSetStepDown` real → o outro nó foi eleito o novo primary automaticamente pelo protocolo Raft do MongoDB → o nó que estava saindo reconectou no *novo* primary e removeu a si mesmo da config via `replSetReconfig` → confirmado direto no mongod restante: a config final tinha **só o nó sobrevivente**, como primary.
- O que **não** foi confirmado com processos reais nesta sessão: o `bootstrap()` completo ponta-a-ponta usando a descoberta mDNS de verdade (por causa da limitação de ambiente acima) e o spawn automático do arbiter para N=2 pelo Supervisor (depende da mesma cadeia de descoberta). A lógica de decisão de ambos está coberta por testes unitários puros; a execução real fica pendente de verificação numa rede física com máquinas de verdade — ou, no mínimo, num ambiente sem essa particularidade de rede local observada aqui.

**Testes (14 novos, 223 no total do server):** `filterPeersForReplicaSet`, `excludeSelf`, `decideBootstrapAction` (initiate/join/retry), `computeNeedsArbiter` (2 sem arbiter, 2 com um membro inalcançável ainda conta, arbiter já presente, 3+ não precisa), `toClusterStatusDTO` (papéis, `isSelf`, lag de replicação calculado, lag null pra primary/arbiter, saúde `unreachable`).

**Dependências novas:** `multicast-dns` (server — nomeada explicitamente no plano original), `mongodb` (server — driver explícito para comandos administrativos diretos; já vinha embutido via mongoose, mas agora importado diretamente, mesmo padrão já usado em `packages/app/src/supervisor.ts`).

---

## 5. Roadmap de Fases

| Fase | Escopo | Status |
|------|--------|--------|
| 0 | Monorepo, shared types, server stub, Electron, Docker RS | Concluída |
| 0.5 | Bugs supervisor, discriminated union bracket, DTOs | Concluída |
| 1 | Auth + RBAC + first-run setup | Concluída |
| 2 | Atleta CRUD + Guardian + Belt/Weight records | Concluída |
| 3A | Evento + Divisões + Inscrições | Concluída |
| 3B | Bracket engine puro + testes | Concluída |
| 3C | Persistência de bracket + match results | Concluída |
| 3D | Import Excel | Concluída |
| 4A | Áreas e roteamento automático de lutas | Concluída |
| 4A.1 | Regras de luta por divisão (CBJ) + salvar único em /settings/divisions | Concluída |
| 4B | Placar ao vivo (timer, pontuação, WebSocket) — consome `Division.matchRules` (GS opcional); inclui display público de próximas lutas por área com descanso, ocultação de nome de menores em telas públicas e override manual de despacho | Concluída |
| 5 | Check-in + Weigh-in | Concluída |
| 5.5 | Impressão e relatórios (chave em papel, ficha de pesagem, resultados) | Concluída |
| 6 | PWA + Offline | Concluída |
| 7 | ClusterManager mDNS + RS dinâmico | Concluída* (*ver ressalva de verificação na seção da fase) |

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

### Fase 3C — Persistência de Bracket + Resultados

Concluída — ver "Fase 3C — Concluída em 2026-07-16" na seção 4, acima.

---

### Fase 3D — Import de Excel (estimativa: 2–3 dias) — ver "Fase 3D — Concluída" na seção 4 acima

**Dependência nova:** `xlsx` (SheetJS) — parse de `.xlsx` sem binding nativo. Também `@fastify/multipart` (upload).

**Template (colunas fixas, ordem importa — 15 colunas; coluna N adicionada durante a implementação, ver "Desvio 2" na seção 4):**

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
| N | termos_aceitos | S/N | sim — se menor, precisa ser "S" |
| O | observacoes | string | não |

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

Regras de pontuação encapsuladas em módulo puro (variam por federação/evento — não hardcode espalhado). **Tempos de luta, osaekomi e golden score vêm de `Division.matchRules`** (implementado no adendo 4A.1, com fallback `CBJ_DEFAULT_MATCH_RULES` para documentos antigos): duração da luta, GS opcional por divisão (com ou sem limite de tempo; no RNC o GS encerra na primeira pontuação e osaekomi encerra no Yuko), e limiares de osaekomi Yuko/Waza-ari/Ippon. A 4B também deve expor a edição de `matchRules` da divisão *de evento* (a rota PATCH já aceita; falta UI).

**Escopo adicional da 4B (lacunas identificadas na comparação com JudoShiai, 2026-07-16):**

- **Display público de próximas lutas** por área (equivalente do judoinfo): lista das próximas lutas de cada mesa com contagem regressiva do descanso dos atletas — os dados já existem desde a 4A (`MatchDispatchService`, `result.decidedAt`, `restMinutesBetweenMatches`).
- **Ocultação de nome de menores em telas públicas**: opção por evento de exibir atletas abaixo de uma idade configurável só por inicial/apelido nos displays públicos (o operador continua vendo o nome completo). Espelha o recurso "GDPR" do JudoShiai; alinhado com a regra de privacidade de menores do CLAUDE.md.
- **Override manual de despacho**: `event_manager+` pode forçar "esta luta nesta mesa agora" (equivalente de `forcedtatami`/`forcednumber` do JudoShiai), furando a fila do `pickNextMatch` mas ainda respeitando o descanso mínimo (com confirmação explícita para ignorá-lo).

---

### Fase 5.5 — Impressão e relatórios (estimativa: 2–3 dias)

Lacuna identificada na comparação com JudoShiai (que imprime chaves em SVG com templates, fichas de pesagem, credenciais e resultados): ginásio real usa papel. Escopo mínimo:

- **Chave em papel** por divisão (eliminação e rodízio), com números de luta e nomes — HTML de impressão (`window.print`/CSS `@media print`), sem dependência de PDF nativa.
- **Ficha de pesagem** por divisão/evento (lista de inscritos com campo de peso em branco para operação manual de contingência).
- **Resultados finais** por divisão (classificação 1º–3º/5º) e do evento.
- Respeitar a ocultação de menores da 4B nos impressos públicos.

---

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

### Dev local

No macOS, o fluxo recomendado para desenvolvimento rápido é:

```bash
pnpm dev:run                                    # MongoDB efêmero + Fastify + Next.js
# Ctrl+C encerra os três processos
```

O fluxo manual com Docker continua disponível:

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
