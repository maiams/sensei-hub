# Demo do Sensei Hub

## Como retomar

Quando o usuário disser **“demo do Sensei Hub”** ou **“retome o projeto”**,
consultar primeiro `docs/demo-presenca.md`, que contém o checkpoint mais recente
e os comandos da demo. Retomar uma demonstração local dos dois produtos:

- **Sensei Arena** — gestão de campeonatos.
- **Sensei Dojô** — gestão da academia e presença em aulas.

Objetivo: executar os produtos com dados de demonstração, navegar pelas funcionalidades existentes, identificar problemas de usabilidade e registrar melhorias.

## Estado atual do projeto

- Branch principal de trabalho: `feat/arena-operacao-e-deploy-windows`.
- Arena: fases 0–8 implementadas.
- Presença do Dojô: primeira versão navegável implementada em 2026-08-10.
- Última validação da presença: 53/53 testes do backend, typechecks e build web
  passando, além do fluxo ponta a ponta aluno → Sensei → histórico.
- Não existe site público ou IP externo publicado.
- Repositório: `https://github.com/maiams/sensei-hub`.
- O arquivo `docs/sensei-dojo-projeto.md` contém a especificação inicial do PWA de presença.

## Endereços locais

Quando executados localmente:

- Arena web: `http://localhost:3000`
- Arena API: `http://localhost:3001`
- Dojô web: `http://localhost:3100`
- Dojô API: `http://localhost:3101`

Para outro dispositivo na mesma rede, usar o IP local do computador que estiver executando o produto, por exemplo `http://192.168.0.10:3000`.

Os comandos documentados são `pnpm dev:arena` e `pnpm dev:dojo`. O script atual de desenvolvimento verifica macOS; em Linux/Windows pode ser necessário ajustar essa restrição antes de iniciar a demo.

## Decisões fechadas sobre a chamada do Sensei Dojô

### Aula e cronograma

- O Sensei cria as aulas e os cronogramas manualmente.
- Cada chamada pertence a uma aula específica, com turma, data, horário de início, horário de término e Sensei responsável.
- A duração da aula é configurável.

### Janela de solicitação

- O aluno pode solicitar presença a partir de 30 minutos antes do início da aula.
- A solicitação pode ser criada até 1 hora depois do início da aula.
- Essa janela total de 1h30 dá margem para alunos que se deslocam entre cidades, como São José dos Campos e Jacareí.
- Depois do encerramento da janela, novas solicitações são bloqueadas.
- Solicitações já existentes continuam pendentes.
- Não haverá QR Code.

### Prazo de decisão

- Se o Sensei não decidir até o fim da aula, a solicitação não vira falta imediatamente.
- Ela permanece pendente por até 24 horas após o término da aula.
- Dentro desse prazo, o Sensei pode confirmar ou recusar.
- Após 24 horas sem decisão, a solicitação vira `expirada` e a presença vira `faltou`.
- Motivo automático da expiração: `solicitação expirada pelo Sensei`.

### Estados

Estados da solicitação:

- `pendente`
- `confirmada`
- `recusada`
- `expirada`

Resultado da presença na aula:

- `presente`
- `faltou`

Regras:

- `confirmada` gera `presente`.
- `recusada` gera `faltou`.
- `expirada` gera `faltou`.
- A recusa exige motivo obrigatório; o Sensei nunca pode recusar silenciosamente.
- O motivo deve ser validado no servidor e preservado no histórico e na auditoria.
- A solicitação original nunca deve ser apagada.

### Tela de chamada

- A chamada mostra todos os alunos vinculados à turma.
- Os nomes aparecem em ordem alfabética.
- O Sensei vê o nome completo e a idade do aluno.
- A idade é calculada a partir da data de nascimento considerando a data da aula.
- A data de nascimento e o CPF não são exibidos.
- Para diferenciar alunos com nomes iguais, pode ser usado um identificador auxiliar seguro, como matrícula ou ano de nascimento.
- A lista indica se o aluno enviou solicitação e qual é o status.
- A localização, quando disponível, é apenas um indicador e nunca bloqueia a decisão.
- Não haverá confirmação em lote.
- O Sensei confirma ou recusa cada aluno individualmente.
- O Sensei pode lançar presença diretamente para um aluno que não conseguiu solicitar, por exemplo, por falta de internet.

## Próximos pontos para a demo geral

1. Ajustar o modo de inicialização para o ambiente disponível.
2. Subir Arena e Dojô com bancos efêmeros separados.
3. Executar ou adaptar os seeds de demonstração.
4. Criar um roteiro de navegação cobrindo as funcionalidades existentes.
5. Testar os fluxos principais com dados realistas.
6. Registrar problemas visuais, de fluxo, permissões, mensagens e dados.
7. Separar melhorias em críticas, importantes e futuras.

## Forma de trabalho

O usuário encerrou o modo orquestrador em 2026-08-10. Nas próximas sessões, o
assistente pode trabalhar diretamente no projeto, salvo nova solicitação
explícita de delegação.
