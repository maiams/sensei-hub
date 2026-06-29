# Formato Chave de Eliminação Simples

Analisado em: 2026-06-29  
Fonte: modelos de súmula CBJ/Zempo

---

## Conceito

No formato Chave, atletas são eliminados após uma derrota (sem repescagem) ou após um número definido de derrotas (com repescagem). O vencedor é determinado por eliminação progressiva.

As chaves disponíveis são potências de 2: **8, 16, 32, 64, 128 atletas**.

---

## Estrutura por tamanho de chave

| Chave | Atletas | Rounds principais | Total de lutas (sem rep.) | Luta final |
|-------|:-------:|:-----------------:|:------------------------:|:----------:|
| Chave-8   | 8   | 3 (QF + SF + Final)                        | 7   | 7 |
| Chave-16  | 16  | 4 (Oitavas + QF + SF + Final)              | 15  | 15 |
| Chave-32  | 32  | 5 (Dezesseis + Oitavas + QF + SF + Final)  | 31  | 31 |
| Chave-64  | 64  | 6 rounds                                   | 63  | 63 |
| Chave-128 | 128 | 7 rounds                                   | 127 | 127 |

Fórmula: total de lutas = n - 1 (uma luta por atleta eliminado, exceto o campeão)

---

## Estrutura do Bracket (Chave-8 — modelo base)

```
Posição 1 ─┐
            ├─ Luta 1 ─┐
Posição 2 ─┘            │
                         ├─ Luta 5 (SF) ─┐
Posição 3 ─┐            │                │
            ├─ Luta 2 ─┘                 ├─ Luta 7 (Final)
Posição 4 ─┘                             │
                                          │
Posição 5 ─┐                             │
            ├─ Luta 3 ─┐                 │
Posição 6 ─┘            │                │
                         ├─ Luta 6 (SF) ─┘
Posição 7 ─┐            │
            ├─ Luta 4 ─┘
Posição 8 ─┘

Luta 8: Disputa de 3º lugar (losers de SF 5 e 6) — ver variantes abaixo
```

### Avanço no bracket
- Vencedor de cada luta avança para a próxima fase.
- Perdedor: eliminado (sem repescagem) ou entra na repescagem (com repescagem).

---

## Numeração das Lutas por Chave

### Chave-8
- Quartas de Final:    lutas 1, 2, 3, 4
- Semifinal:           lutas 5, 6
- Final:               luta 7 (sem rep.) ou 9/11 dependendo do tipo de repescagem
- Bronze / 3º lugar:   luta 8

### Chave-16
- Oitavas de Final:    lutas 1–8
- Quartas de Final:    lutas 9–12
- Semifinal:           lutas 13–14
- Final:               luta 15
- Bronze:              luta 16
- Repescagem (se houver): lutas 17–18

### Chave-32
- Round 1:             lutas 1–16
- Oitavas:             lutas 17–24
- Quartas de Final:    lutas 25–28
- Semifinal:           lutas 29–30
- Final:               luta 31
- Bronze:              luta 32

### Padrão geral
```
Para Chave-N (N = 2^k):
  Round r tem N / 2^r lutas
  Total rounds = log2(N)
  Numeração começa em 1 e vai até N-1
```

---

## Classificação Final (sem repescagem)

Para Chave-8:

| Lugar | Qtd | Descrição |
|-------|:---:|-----------|
| 1º    | 1   | Vencedor da Final |
| 2º    | 1   | Perdedor da Final |
| 3º    | 2   | Ambos os perdedores de Semifinal recebem bronze (padrão IJF) |
| 5º    | 2   | Perdedores de QF do mesmo lado do bracket que o 3º lugar |
| 7º    | 2   | Perdedores de QF do lado oposto |

> Em judo, são concedidas **duas medalhas de bronze** (não há disputa entre os dois 3ºs lugares no formato IJF padrão). A variante "Simples" inclui disputa de 3º lugar — ver `repescagem.md`.

---

## Regras de Geração do Bracket

### Seeding (cabeças de chave)
- Atletas podem ser pré-distribuídos por ranking ou sorteio.
- Cabeças de chave são colocados em posições opostas para só se encontrarem na final.
- Posições padrão para cabeças:
  - 1º cabeça: posição 1 (topo)
  - 2º cabeça: posição N (fundo)
  - 3º e 4º cabeças: posições no meio das duas metades

### Byes (atleta sem adversário)
- Quando o número de atletas não é potência de 2, usam-se byes.
- Bye = avanço automático para a próxima fase sem lutar.
- Byes são distribuídos prioritariamente para cabeças de chave (proteção dos melhores).
- Número de byes = chave escolhida − número real de atletas.
  - Exemplo: 10 atletas em Chave-16 → 6 byes.

### Mesmo clube
- Atletas do mesmo clube não devem se enfrentar na primeira rodada quando possível.
- Regra de separação: distribuir no bracket de forma a maximizar a distância entre eles.

### WO (Walkover)
- Se um atleta não comparecer, o adversário recebe WO (vitória por falta).
- WO conta como vitória por Ippon para fins de desempate.
- Deve ser registrado com motivo e timestamp.

---

## Observações de Implementação

- O bracket é gerado **deterministicamente** a partir da lista de atletas ordenada por seed.
- Após gerado, o bracket não muda (exceto por retirada com justificativa e audit trail).
- Cada luta tem: atleta A, atleta B, resultado, método, tempo, operador, timestamp.
- Resultado pode ser corrigido com trilha de auditoria.
- O estado do bracket deve ser persistido de forma a sobreviver a crashes e recarregamentos.
- A numeração das lutas deve ser sequencial e única dentro da categoria.
- Avançar o bracket automaticamente após resultado registrado, com confirmação do operador.
