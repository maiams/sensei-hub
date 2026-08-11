# Projeto Sensei Dojô — PWA de Presença

## Objetivo

Criar um PWA para uma única academia de judô, com várias turmas, como Infantil e Adulta. O sistema controlará solicitações e confirmações de presença feitas pelo aluno e pelo Sensei.

## Usuários

- **Aluno:** cria cadastro, acessa o PWA e consulta suas presenças.
- **Sensei:** aprova cadastros, cria e administra turmas, confirma ou retira presenças e pode lançar presença para alunos sem internet.
- **Administrador:** permissões superiores para corrigir chamadas encerradas, gerenciar usuários e manter o sistema.

## Cadastro e login

- Um dia antes da primeira aula em que o sistema será usado, o Sensei publica no grupo de mensagens da academia um link obrigatório para criação de conta.
- O aluno informa nome completo, Gmail, senha e data de nascimento.
- O Gmail é o identificador único da conta; o nome completo é usado para exibição e conferência pelo Sensei.
- Com base na idade, o sistema mostra as turmas compatíveis e o aluno escolhe uma opção.
- O cadastro fica **pendente** até o Sensei aprovar o aluno e a turma.
- Se o Sensei indicar uma turma diferente, o aluno recebe uma notificação e precisa aceitar a alteração antes de poder solicitar presença. Se recusar, o Sensei deverá manter ou indicar outra turma.
- Enquanto o cadastro ou a turma estiverem pendentes, o aluno pode acessar o site, mas não pode solicitar presença nem aparece na chamada.
- Alunos menores poderão ter dados de responsável.
- A sessão expira após 30 dias; o site encerra a sessão e exige novo login com Gmail e senha. A conta e o histórico permanecem intactos.
- Deve existir logout manual e possibilidade de bloquear sessões em caso de perda do dispositivo.

## Turmas

- O Sensei cria e nomeia as turmas.
- O Sensei adiciona, remove ou transfere alunos.
- O PWA não cria nem renomeia turmas.
- O PWA apenas exibe as turmas em ordem alfabética.
- Cada turma terá horários e Sensei responsável.

## Fluxo de presença

1. O aluno, já aprovado e vinculado a uma turma, solicita presença diretamente pelo site; não haverá QR Code.
2. A solicitação só pode ser criada dentro da janela da aula, mas o aluno pode estar longe do dojô no momento do pedido.
3. O sistema tenta obter a localização pontual do aluno no momento da solicitação.
4. O Sensei visualiza a solicitação no painel e confirma visualmente se o aluno está presente.
5. A presença só é registrada após a confirmação do Sensei.
6. A localização é apenas um indicador: verde dentro do raio do dojô, vermelho fora do raio e “não informada” quando indisponível. Ela nunca bloqueia a solicitação nem substitui a conferência visual.
7. O aluno pode fechar o celular após solicitar e consulta o resultado ao abrir o site novamente.

### Regras da solicitação

- O raio padrão do dojô é de 200 metros e pode ser alterado pelo Sensei.
- A localização é consultada apenas no momento da solicitação; o sistema não rastreia o aluno continuamente.
- Uma solicitação pendente permanece aberta por até 24 horas a partir do momento em que foi criada.
- O Sensei pode aprovar (`presente`) ou rejeitar (`rejeitada`) a solicitação.
- Se não houver decisão em 24 horas, a solicitação expira automaticamente e vira `faltou`, com o motivo `solicitação expirada`.
- O Sensei também pode lançar presença diretamente para um aluno que não conseguiu solicitar, por exemplo, por falta de internet. Esse lançamento fica identificado como feito pelo Sensei.
- Ao final, aluno sem presença confirmada fica como `faltou` conforme as regras da solicitação.

## Alunos sem internet

- O aluno pode solicitar antes de chegar ao dojô, dentro da janela da aula, para contornar a falta de internet no local.
- Se o aluno não conseguir solicitar, o Sensei poderá incluí-lo diretamente na chamada.
- Não haverá tipos de presença chamados “manual” ou “automática” para o aluno. Para o usuário existe apenas o registro de presença; internamente, o sistema guarda se ela veio de solicitação ou lançamento do Sensei.

## Retirada e correção

- O Sensei pode retirar uma presença registrada incorretamente, inclusive se o aluno foi embora.
- A presença nunca deve ser apagada definitivamente.
- Toda retirada ou correção registra quem fez, quando fez e o motivo.
- O Sensei pode corrigir uma falta e lançar presença até 24 horas após o término da aula, com motivo obrigatório.
- Depois desse prazo, somente a permissão administrativa poderá corrigir o registro, também com motivo obrigatório e auditoria.
- O sistema separa o horário a que a presença se refere do horário em que o registro foi criado.

## Expiração

- Solicitações pendentes expiram após 24 horas.
- Estados previstos: `pendente`, `confirmada`, `recusada` e `expirada`.

## Segurança

- Uma presença por aluno, turma e aula.
- O horário oficial deve vir do servidor.
- A auditoria deve preservar solicitações, confirmações, retiradas e correções.
- Uma presença de academia não deve ser apresentada como prova absoluta de localização.

## Telas previstas para o MVP

### Aluno

- Login e cadastro.
- Cadastro aguardando aprovação.
- Página inicial com turma e próxima aula.
- Status da solicitação.
- Histórico de presenças.

### Sensei

- Cadastros pendentes.
- Lista de turmas.
- Chamada da aula atual.
- Solicitações pendentes.
- Confirmar, recusar, adicionar e retirar presença.
- Histórico e correções.

## Pendências de decisão

- Definir os horários exatos das turmas e a janela de abertura/fechamento da chamada.
- Definir como será criado o primeiro usuário Sensei.
- Definir notificações ao aluno após confirmação.
- Definir funcionamento quando a academia inteira estiver sem internet.
- Definir política de privacidade e tratamento de dados de menores.

## Próxima etapa

Modelar banco de dados, estados e telas do MVP antes de iniciar a implementação.
