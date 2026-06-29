# Campos de Cadastro de Atleta — Sensei Hub

Documento de referência baseado na análise do cadastro CBJ/Zempo, adaptado para uso em academia grande ou agremiação municipal de judô.

---

## O que foi analisado

O PDF analisado é o perfil completo de um atleta registrado na plataforma CBJ via sistema Zempo. Os campos foram catalogados, avaliados por relevância para uso acadêmico/municipal, e reorganizados para o contexto do Sensei Hub.

---

## Campos do Zempo/CBJ — Inventário Completo

### Identificação e Registro
| Campo | Valor de Exemplo | Observação |
|---|---|---|
| Tipo de Cadastro | ATLETA | Outros tipos: técnico, árbitro, staff |
| Número de Registro | JU108247 | Código CBJ |
| Status | EM ANÁLISE / Ativo | Workflow de aprovação |
| Federação | FPJ - SP | Vínculo federativo |
| Data de Registro | 26/11/2021 | |
| Clube | SEC. ESP. RECREACAO JACAREI | |

### Dados Pessoais
| Campo | Valor de Exemplo |
|---|---|
| Primeiro Nome | Ricardo |
| Último Nome | Santos |
| Nome Completo | Ricardo Maia Martins dos Santos |
| Gênero | Masculino |
| Data de Nascimento | 16/04/1982 |
| Idade Calculada | 44 anos |
| Nacionalidade | Brasileira |
| Naturalidade | São Paulo |
| Nome Preferido | Ricardo Maia |
| Nome do Pai | — |
| Nome da Mãe | — |

### Classe e Categoria
| Campo | Valor de Exemplo |
|---|---|
| Classe | Sênior / M3 / Sênior J1 / Sênior J2 / Absoluto JUBS / Adulto - SP |
| Graduação | Preta 1º DAN |
| Data da Última Graduação | 29/11/2025 |
| Peso | 88,00 kg |
| Categoria | Médio |

### Contato
| Campo | Valor de Exemplo |
|---|---|
| Email | maiams@msn.com |
| Celular | (12) 99798-7779 |
| Telefone Residencial | (12) 99798-7779 |
| Telefone Complementar 1 | — |
| Telefone Complementar 2 | — |
| Email Secundário | — |
| Nome do Responsável | — |
| Email do Técnico | airam-rodrigues@hotmail.com |

### Documentos
| Campo | Valor de Exemplo |
|---|---|
| CPF | 312.018.988-03 |
| RG | 44.701.946-6 |
| Órgão Expedidor RG | SSP |
| Estado Emissor RG | SP |
| Data de Expedição RG | 31/08/2016 |
| Número do Passaporte | FS073123 |
| Validade do Passaporte | 05/12/2026 |
| Órgão Emissor Passaporte | — |

### Endereço
| Campo | Valor de Exemplo |
|---|---|
| CEP | 12213-991 |
| Endereço | Estrada do Bengalar |
| Complemento | 1425 |
| Bairro | Buquirinha |
| Cidade | São José dos Campos |
| Estado | SP |

### Dados Físicos e Uniformes
| Campo | Valor de Exemplo |
|---|---|
| Altura (cm) | — |
| Tamanho Judogui Branco (wagui) | G |
| Tamanho Calça Judogui Branco | G |
| Tamanho Judogui Azul (wagui) | G |
| Tamanho Calça Judogui Azul | G |
| Tamanho Faixa | — |
| Tamanho Camisa | — |
| Tamanho Bermuda | — |
| Tamanho Agasalho | — |
| Tamanho Calçado | 44 |
| Tamanho Chinelo | 44 |

### Dados Técnicos de Judô
| Campo | Valor de Exemplo |
|---|---|
| Kumi-Kata | — |
| Tokui-Waza | — |

### Dados Financeiros (nível federação)
| Campo | Valor de Exemplo |
|---|---|
| Banco | Nubank |
| Agência | 0001 |
| Conta | 83557581-8 |

### Flags e Qualificações
| Campo | Valor de Exemplo |
|---|---|
| Vacina | — |
| Seleção Brasileira | Não |
| Universitário | Não |

### Histórico de Competições
| Campo | Exemplo |
|---|---|
| Colocação | — |
| Competição | Campeonato Brasileiro de Veteranos 2023 |
| Âmbito | Nacional |
| Local/Estado | SP |
| Período | 18/08/2023 a 20/08/2023 |
| Categoria | M3 Masculino Médio (-90kg) |
| Certificado | — |

### Participações em Eventos (cursos, módulos)
| Campo | Exemplo |
|---|---|
| Evento | Módulo de Arbitragem |
| Atividade | Participante / Avaliação / Certificado |
| Âmbito | Estadual / Nacional |
| Local | SP / RJ |
| Período | 21/02/2026 |

### Arquivos e Documentos
| Campo | Exemplo |
|---|---|
| Data | 23/03/2023 |
| Título | Oficial Técnico - Caderneta |
| Tipo | Documentos Pessoais / Declarações |

---

## Mapeamento para o Sensei Hub

### Critérios de Avaliação

- **Manter**: campo com uso direto no dia a dia da academia ou evento local.
- **Simplificar**: campo relevante mas com escopo reduzido para uso local.
- **Remover**: campo específico de federação nacional, sem utilidade na academia.
- **Adicionar**: campo ausente no Zempo mas necessário para operação da academia.

---

## Campos Recomendados para Cadastro de Atleta no Sensei Hub

### 1. Identificação Interna
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| ID interno | UUID | Sim | Gerado automaticamente |
| Número de matrícula | String | Sim | Gerado pela academia |
| Status | Enum | Sim | Ativo, Inativo, Suspenso, Pendente |
| Data de cadastro | Datetime | Sim | Automático |
| Academia | FK | Sim | Multi-academia no futuro |

### 2. Dados Pessoais
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Nome completo | String | Sim | |
| Nome preferido / apelido | String | Não | Para scoreboard e check-in |
| Gênero | Enum | Sim | Masculino, Feminino, Não informado |
| Data de nascimento | Date | Sim | Derivar idade e classe automaticamente |
| Nacionalidade | String | Não | Padrão: Brasileira |
| Naturalidade | String | Não | Cidade/estado de nascimento |
| Foto | File | Não | Para identificação visual na academia |

### 3. Documentos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| CPF | String | Sim (adultos) | Validação de formato |
| RG | String | Não | Número, órgão, estado, data |
| Passaporte | String | Não | Apenas para atletas estrangeiros ou internacionais |
| Certidão de nascimento | String | Não | Para menores sem RG |

> **Privacidade**: documentos armazenados protegidos, nunca expostos em telas públicas.

### 4. Contato
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Email principal | String | Condicional | Obrigatório para adultos |
| Celular | String | Sim | WhatsApp principal |
| Telefone alternativo | String | Não | |
| Email secundário | String | Não | |

### 5. Responsável Legal (obrigatório para menores)
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Nome do responsável | String | Sim (menores) | |
| Grau de parentesco | Enum | Sim (menores) | Pai, Mãe, Tutor, Outro |
| CPF do responsável | String | Não | |
| Celular do responsável | String | Sim (menores) | |
| Email do responsável | String | Não | |
| Autorização assinada | Bool | Sim (menores) | LGPD + termo de imagem |

### 6. Endereço
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| CEP | String | Não | Auto-completar logradouro |
| Logradouro | String | Não | |
| Número | String | Não | |
| Complemento | String | Não | |
| Bairro | String | Não | |
| Cidade | String | Não | |
| Estado | String | Não | |

### 7. Dados de Judô
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Graduação atual | Enum | Sim | Branca, Amarela, Laranja... Preta 1°-10° DAN |
| Data da última graduação | Date | Não | |
| Classe etária | Derivada | Automático | Calcular via data de nascimento |
| Técnico responsável | FK | Não | Referência a usuário técnico |
| Kumi-Kata preferido | String | Não | Dado técnico opcional |
| Tokui-Waza | String | Não | Dado técnico opcional |
| Registro federativo | String | Não | Número na federação estadual/CBJ |
| Federação | String | Não | Ex: FPJ-SP |

### 8. Dados Físicos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Altura (cm) | Integer | Não | |
| Peso atual (kg) | Decimal | Não | Último registro; histórico em tabela separada |
| Categoria de peso | Derivada | Automático | Calcular via peso + idade/gênero |

> Peso é gerenciado em tabela `weight_records` com histórico e origem (manual, balança, importado).

### 9. Uniformes e Tamanhos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Tamanho do judogui | String | Não | A0, A1, A2, A3, A4, A5 (padrão IJF) |
| Tamanho da faixa | String | Não | |
| Tamanho de camisa | String | Não | PP, P, M, G, GG, XGG |
| Tamanho de calçado | Integer | Não | |

> Tamanhos relevantes para academia que fornece equipamentos ou uniformes.

### 10. Informações de Saúde (dados sensíveis)
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Condições médicas relevantes | Text | Não | Acesso restrito a técnico e admin |
| Alergias | Text | Não | |
| Vacinas em dia | Bool | Não | Opcional por evento |
| Observações médicas | Text | Não | |
| Flag de restrição médica | Bool | Não | Bloqueia participação em evento |

> Dados de saúde: acesso restrito, nunca exibidos em telas públicas ou de evento.

### 11. Vínculos Acadêmicos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Turmas matriculadas | FK[] | Não | Horários/turmas na academia |
| Data de início | Date | Sim | |
| Data de saída | Date | Não | Quando applicável |
| Plano/mensalidade | FK | Não | Referência ao plano financeiro |
| Status financeiro | Enum | Não | Em dia, Atrasado, Isento |

### 12. Consentimentos e Termos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| Termo de responsabilidade assinado | Bool | Sim | |
| Autorização de uso de imagem | Bool | Sim | |
| Data de aceite | Datetime | Sim | |
| Versão dos termos | String | Sim | Para controle de revisões |
| Aceito via | Enum | Sim | Digital, Físico |

---

## Campos Removidos vs. Zempo (e por quê)

| Campo Zempo | Decisão | Motivo |
|---|---|---|
| Dados bancários (banco, agência, conta) | Removido | Uso federativo para reembolso de viagem; fora do escopo da academia |
| Seleção Brasileira | Removido | Flag federativo nacional |
| Universitário | Removido | Relevante apenas para competições universitárias federativas |
| Passaporte (detalhado) | Simplificado | Manter apenas número e validade; órgão emissor é redundante |
| Classe (texto composto) | Substituído | Derivar automaticamente da data de nascimento; não campo livre |
| Número de registro CBJ | Simplificado | Tornar campo opcional "registro federativo externo" |
| Participações em eventos CBJ | Substituído | Gerenciar via tabela própria de eventos do Sensei Hub |
| Arquivos/Declarações (módulos CBJ) | Substituído | Gerenciar via tabela própria de eventos/cursos |

---

## Campos Adicionados (ausentes no Zempo)

| Campo | Motivo |
|---|---|
| Foto do atleta | Identificação visual no check-in e scoreboard |
| Turmas matriculadas | Controle de aulas na academia |
| Status financeiro | Controle de mensalidade |
| Plano de matrícula | Pacotes e mensalidades |
| Condições médicas / flag de restrição | Segurança durante treinos e eventos |
| Consentimentos e termos com versão | LGPD e proteção jurídica da academia |
| Aceito via (digital/físico) | Rastreabilidade de assinatura |
| Data de início na academia | Histórico de vínculo |
| Status da academia (ativo/inativo/suspenso) | Controle independente do status federativo |

---

## Entidades Relacionadas (tabelas separadas)

Estes dados **não ficam no cadastro do atleta** mas são gerenciados em tabelas próprias:

| Entidade | Descrição |
|---|---|
| `weight_records` | Histórico de pesagens com operador, timestamp, fonte e correção |
| `belt_records` | Histórico de graduações com data e responsável |
| `attendance_records` | Histórico de check-ins por aula ou evento |
| `competition_results` | Resultados de competições com colocação e categoria |
| `event_participations` | Participações em cursos, eventos, módulos |
| `documents` | Arquivos vinculados ao atleta (declarações, certidões) |
| `audit_logs` | Log de alterações em qualquer campo sensível |

---

## Classes Etárias (referência IJF/CBJ para cálculo automático)

| Classe | Faixa de Idade |
|---|---|
| Pré-mirim | 7–9 anos |
| Mirim | 10–11 anos |
| Infantil | 12–13 anos |
| Infanto-Juvenil | 14–15 anos |
| Juvenil | 16–17 anos |
| Júnior | 18–20 anos |
| Sênior | 15+ anos (competição máxima) |
| Veterano J1 (M1/F1) | 30–39 anos |
| Veterano J2 (M2/F2) | 40–49 anos |
| Veterano M3 | 50–59 anos |
| Veterano M4 | 60–69 anos |
| Veterano M5 | 70+ anos |

> Regra: calcular via `data_nascimento` no momento do evento, não fixar no cadastro.

---

## Categorias de Peso — Referência (Adulto Masculino)

| Categoria | Limite |
|---|---|
| Leve Extra | até 60 kg |
| Meio-Leve | até 66 kg |
| Leve | até 73 kg |
| Meio-Médio | até 81 kg |
| Médio | até 90 kg |
| Meio-Pesado | até 100 kg |
| Pesado | acima de 100 kg |
| Absoluto | sem limite |

> Categorias variam por faixa etária e federação. Encapsular regras de categoria em serviço separado para fácil atualização.

---

## Notas de Implementação

1. **Menores de 18 anos**: campos de responsável são obrigatórios; dados de saúde têm acesso ainda mais restrito.
2. **LGPD**: coletar apenas o mínimo necessário. CPF e RG devem ter justificativa de uso documentada.
3. **Classe etária**: nunca salvar como campo fixo; sempre derivar da data de nascimento + data do evento.
4. **Peso**: salvar na tabela `weight_records`; o campo `peso_atual` no perfil é apenas uma referência de conveniência ao último registro.
5. **Status federativo vs. status da academia**: são independentes. Um atleta pode estar ativo na academia e com registro federativo vencido.
6. **Foto**: armazenar com acesso controlado; não exibir publicamente sem consentimento.
7. **Documentos sensíveis**: nunca indexar ou exibir em buscas gerais.

---

*Gerado em: 2026-06-29*
*Fonte: análise do cadastro CBJ/Zempo — perfil de atleta exportado em PDF*
