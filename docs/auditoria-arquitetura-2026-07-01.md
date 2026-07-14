# Auditoria Arquitetural - Sensei Hub

**Data:** 2026-07-01  
**Autor:** Codex, atuando como auditor e arquiteto de software  
**Destinatario:** Claude Sonnet 4.6  
**Documento auditado:** `docs/status-e-plano.md`

---

## Parecer Executivo

O plano tem boa direcao de produto e cobre os fluxos certos: operacao local-first, competicao, check-in, pesagem, scoreboard, auditoria e failover. A base implementada tambem esta coerente como Fase 0: monorepo, tipos compartilhados, servidor Fastify, app Electron e Docker para MongoDB replica set.

O ponto critico e que a arquitetura de alta disponibilidade esta sendo tratada como se fosse uma garantia ja resolvida, mas ainda depende de validacao operacional pesada. MongoDB replica set dinamico em laptops com IPs variaveis, WiFi instavel, mDNS, arbiter automatico, Electron supervisor e PWA offline formam uma superficie grande de falha. Antes de implementar muito negocio, recomendo inserir uma Fase 0.5 de endurecimento e prova operacional.

Minha recomendacao: nao avancar direto para Auth + RBAC sem antes estabilizar contratos, build, supervisor, modelo de deploy e testes de falha. Caso contrario, a aplicacao pode ficar funcional em desenvolvimento, mas fragil no ginasio, que e justamente o ambiente-alvo.

---

## Achados Principais

### 1. A arquitetura de cluster ainda e hipotese, nao garantia

O plano assume failover automatico robusto via MongoDB replica set, mDNS e ClusterManager. Isso e plausivel, mas ainda nao esta demonstrado no codigo.

Riscos:

- Replica set do Docker usa nomes internos como `sensei-mongo-1:27017`, mas o servidor local usa `127.0.0.1:27017` por padrao. Isso pode produzir comportamento diferente entre dev, Electron e cluster real.
- MongoDB replica set em laptops precisa de hostnames/IPs estaveis no `rs.conf()`. Em redes de ginasio, IP pode mudar e mDNS pode falhar parcialmente.
- A premissa "zero perda de dados em failover" com `writeConcern: majority` e verdadeira apenas para writes confirmados, mas nao cobre writes pendentes no cliente, requests em transito, nem operacao quando nao ha maioria.
- O plano promete N=2 com arbiter automatico. Isso aumenta disponibilidade de eleicao, mas se o arbiter ficar no mesmo laptop de um data node, a topologia precisa ser cuidadosamente documentada para evitar falsa sensacao de resiliencia.

Melhoria proposta:

- Criar Fase 0.5: "Prova Operacional Local-First".
- Entregar um `ClusterManager` minimo antes do dominio de negocio, mesmo que sem UI.
- Criar testes manuais e automatizados para: single node, 2 nodes + arbiter, 3 nodes, queda do primary, retorno do primary, troca de IP, perda de WiFi por 30s, falta de maioria.
- Documentar explicitamente o modo degradado: o que pode ler, o que pode escrever, o que fica bloqueado e qual mensagem aparece ao operador.

### 2. O Electron supervisor precisa ser tratado como componente critico

O supervisor atual inicia MongoDB e servidor, faz health check e reinicia o servidor. Isso e suficiente para bootstrap, mas ainda nao cobre os riscos de producao.

Problemas observados:

- `mongod` e iniciado com `--bind_ip 127.0.0.1`, o que impede replica set entre laptops. Isso e correto para dev local isolado, mas conflita com o modelo de cluster multi-laptop.
- O supervisor verifica apenas porta TCP do MongoDB. Porta aberta nao significa replica set iniciado, primary disponivel ou banco gravavel.
- Se o MongoDB morrer, o evento apenas notifica `onMongoDied`; nao ha estrategia real de restart e reinicializacao coordenada do servidor.
- `restartServer()` pode ser chamado simultaneamente pelo loop de health check e pelo evento `exit`, criando risco de restart concorrente.
- O server e iniciado com `NODE_ENV=production`, mas nao injeta `MONGODB_URI`, `PORT` ou lista multi-host dinamica.
- O kiosk carrega `localhost:3000`, enquanto o health check do servidor usa `3001`. O plano diz que Fastify serve o Next na porta 3000, mas a implementacao atual tem processos separados. Essa decisao precisa ser fechada.

Melhoria proposta:

- Separar modos de execucao: `dev-docker`, `single-node`, `cluster-node`, `packaged`.
- Criar `SupervisorStateMachine` explicita: `starting_mongo`, `initiating_rs`, `starting_api`, `healthy`, `degraded`, `restarting_api`, `restarting_mongo`, `stopping`.
- Trocar health check de MongoDB para `db.adminCommand({ ping: 1 })` + checagem de `hello().isWritablePrimary` ou estado do replica set quando aplicavel.
- Proteger `restartServer()` com lock/idempotencia.
- Parametrizar porta, URL do app e URI do Mongo em um arquivo de runtime local gerado pelo Electron.

### 3. O contrato de dominio compartilhado esta incompleto para virar fonte de verdade

Os schemas em `packages/shared` sao um bom inicio, mas ainda misturam representacao API, persistencia e regras de negocio.

Exemplos:

- `AthleteSchema` exige `_id`, `createdAt` e `updatedAt`, o que serve para resposta persistida, mas nao para payload de criacao.
- `birthDate` como `z.string().date()` pode ser adequado para JSON, mas a aplicacao precisa padronizar timezone e criterio de idade por data do evento.
- `Gender` usa `not_informed`, mas bracket e categorias competitivas normalmente precisam restringir genero competitivo ou tratar categoria mista explicitamente.
- `AgeClass` mistura `senior` 15+ com classes veteranas. Um atleta pode ser senior e veterano dependendo do evento. Isso confirma a decisao de derivar por evento, mas pede uma modelagem mais rica.
- `BracketSchema.size` permite qualquer combinacao entre formato e tamanho, por exemplo `format: roundRobin` com `size: 128`.
- `RepechageType` fica obrigatorio ate para rodizio, onde nao se aplica.

Melhoria proposta:

- Criar schemas separados: `CreateAthleteInput`, `UpdateAthleteInput`, `AthleteDTO`, `AthleteDocument`.
- Usar discriminated unions para bracket:
  - `EliminationBracketConfig` com `size: 8|16|32|64|128` e `repechageType`.
  - `RoundRobinBracketConfig` com `size: 3|4|5|6` e sem repescagem.
- Criar uma camada de regras puras em `shared` ou `server/domain` para idade, categoria, ranking de rodizio e validacao de bracket.
- Definir padrao unico para datas em API: ISO date `YYYY-MM-DD` para datas civis, ISO datetime UTC para eventos temporais.

### 4. A fase de autenticacao precisa incluir bootstrapping e operacao offline

O plano de Auth + RBAC e tecnicamente correto, mas faltam dois fluxos fundamentais:

- Como nasce o primeiro `super_admin` ou `academy_admin` em uma instalacao local sem internet.
- Como as credenciais e refresh tokens se comportam em replica set, failover e maquina isolada.

Melhoria proposta:

- Adicionar comando/fluxo `first-run setup` no Electron: cria academia inicial e admin local.
- Exigir troca de senha no primeiro login.
- Adicionar politica de senha offline simples, sem depender de servico externo.
- Persistir sessoes por dispositivo com `deviceId` local e permitir revogacao.
- Registrar `auth_event` no audit log para login, logout, refresh reuse detectado e troca de senha.

### 5. Audit log por middleware generico nao basta

O plano propoe hook `onSend` para respostas 2xx mutantes. Isso ajuda, mas nao garante auditabilidade semantica.

Riscos:

- O middleware nao sabe necessariamente o valor anterior e o novo valor.
- Mutacoes feitas por services internos ou jobs podem escapar do hook HTTP.
- Correcoes de placar, peso e resultado exigem razao humana e trilha forte.

Melhoria proposta:

- Tratar audit log como dependencia explicita dos services de dominio critico.
- Criar `AuditService.recordDomainEvent()` com tipos de evento versionados.
- Usar middleware apenas para metadados de request e fallback, nao como fonte primaria de verdade.
- Modelar eventos de auditoria de forma append-only. Nao permitir update/delete fisico de audit log via aplicacao.

### 6. Scoreboard nao deve depender apenas de persistencia a cada clique

Persistir cada mutacao de placar e correto para durabilidade. Mas timer, osaekomi e latencia local exigem uma estrategia de tempo mais precisa.

Melhoria proposta:

- Persistir estado logico: `clockStartedAt`, `clockPausedAt`, `remainingMs`, `osaekomiStartedAt`, `osaekomiAthleteId`.
- Derivar o tempo exibido no cliente usando relogio sincronizado por mensagem do servidor.
- Incluir numero monotonicamente crescente `revision` no scoreboard para evitar comandos fora de ordem.
- Tornar comandos idempotentes com `commandId`, especialmente em reconexao de WebSocket/PWA.

### 7. Offline/PWA precisa de escopo mais conservador

O plano menciona writes offline em IndexedDB com background sync. Para uma competicao, writes offline podem gerar conflitos graves: dois operadores pesando, confirmando ou corrigindo o mesmo atleta.

Melhoria proposta:

- Fase inicial offline deve ser read-only, exceto rascunhos locais claramente marcados.
- Check-in e pesagem offline so devem ser liberados com um protocolo de conflito definido.
- Scoreboard offline deve permanecer bloqueado, como o plano ja indica.
- Toda fila offline precisa de `operationId`, `baseRevision`, politica de conflito e UI de reconciliacao.

### 8. Build, lint e testes precisam virar gate antes de Fase 1

`pnpm typecheck` passa atualmente, mas ainda nao ha testes de negocio e o script `lint` do pacote web usa `next lint`, que foi descontinuado em versoes recentes do Next. O plano tambem cita TypeScript 5.9.x, mas o repositorio usa 5.8.3.

Melhoria proposta:

- Padronizar versoes documentadas com o `package.json`.
- Adicionar ESLint plano e executavel por pacote, sem depender de comando removido do Next.
- Adicionar testes minimos da Fase 0:
  - health route com DB conectado/desconectado;
  - parsing de env;
  - supervisor restart lock;
  - discriminated union de bracket quando implementada.
- Adicionar CI local via `pnpm typecheck && pnpm test && pnpm build`.

---

## Repriorizacao Recomendada

### Fase 0.5 - Hardening antes de negocio

Entregaveis:

- Contratos de dominio revisados, especialmente bracket e atleta.
- Modo single-node funcional e documentado.
- Modo dev com Docker compativel com a connection string real.
- Supervisor com estados explicitos, restart idempotente e health check de Mongo real.
- Primeiro admin local via setup inicial.
- Testes de smoke para build, API health e conexao Mongo.
- Documento de modo degradado.

### Fase 1 - Auth + RBAC

Pode seguir depois da Fase 0.5, com acrescimos:

- First-run setup.
- Eventos de auditoria de autenticacao.
- Refresh token com `deviceId`, hash, rotacao e deteccao de reuse.
- Fixtures de roles e testes de permissao por rota.

### Fase 2 - Atleta

Antes de implementar CRUD completo, fechar:

- DTOs separados de input/output/documento.
- Politica LGPD para CPF, dados medicos e menores.
- Indices por `academyId`, inclusive CPF unico por academia, nao global.
- Busca normalizada por nome sem depender inicialmente de text index sofisticado.

### Fase 3 - Eventos e bracket

Dividir mais:

- 3A evento/divisoes/inscricoes.
- 3B bracket engine puro com testes de ouro baseados em `docs/zempo-modelos`.
- 3C persistencia de bracket e comandos de resultado.
- 3D import Excel.

Motivo: import Excel e bracket engine sao complexidades diferentes. O bracket deve nascer testado sem banco antes de entrar em fluxo HTTP.

---

## Ajustes Concretos ao Plano Atual

1. Substituir afirmacoes absolutas como "zero perda de dados em failover" por "writes confirmados com majority sobrevivem a failover com maioria disponivel".
2. Corrigir divergencia de versoes entre plano e repo: Node 24 como baseline, TypeScript 5.8.3 ou atualizar repo para 5.9.x.
3. Explicitar que `ClusterManager` e pre-requisito para operacao multi-laptop, nao detalhe futuro opcional.
4. Definir se o servidor Fastify vai servir o Next standalone em producao ou se Electron vai supervisionar API e web em processos separados.
5. Adicionar Fase 0.5 antes de Auth.
6. Trocar schemas compartilhados unicos por contratos especificos de input, output e persistence.
7. Tornar `BracketConfig` uma union discriminada para impedir configuracoes invalidas.
8. Remover ou restringir writes offline ate existir protocolo de conflito.
9. Transformar audit log em evento de dominio append-only, nao apenas hook HTTP.
10. Criar matriz de testes operacionais de falha como criterio de aceitacao do produto.

---

## Comentario Direto ao Claude

Claude, o plano esta bem estruturado para produto, mas esta otimista demais na camada distribuida. O maior risco nao e implementar CRUD, auth ou tela. O maior risco e descobrir tarde que a topologia local-first nao se comporta bem em rede real de ginasio.

Eu recomendo voce tratar o cluster, o supervisor e os contratos de dominio como fundacao, nao como fase final. Se a Fase 7 ficar para depois, todo o codigo de negocio sera escrito assumindo invariantes que ainda nao foram provadas.

A melhor sequencia tecnica e:

1. Provar single-node packaged.
2. Provar replica set de 3 laptops ou 3 hosts reais na LAN.
3. Provar failover com operacao em andamento.
4. Fechar contratos de dominio e DTOs.
5. So entao subir Auth, Atleta, Evento e Bracket.

Essa ordem reduz retrabalho e torna o sistema adequado ao ambiente real: hardware fraco, WiFi ruim, pressao operacional e baixa tolerancia a perda de dados de competicao.

---

## Verificacao Executada

Comando executado:

```bash
pnpm typecheck
```

Resultado: sucesso nos quatro pacotes (`app`, `server`, `shared`, `web`).
