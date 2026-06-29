# Formato Rodízio (Round-Robin)

Analisado em: 2026-06-29  
Fonte: modelos de súmula CBJ/Zempo

---

## Conceito

No formato Rodízio, cada atleta luta contra todos os outros atletas exatamente uma vez.
A classificação final é determinada por desempenho acumulado, não por eliminação.

Usado para categorias pequenas (até 6 atletas) onde a eliminação simples seria injusta por deixar atletas sem lutas suficientes.

---

## Variantes disponíveis

| Variante     | Nº de atletas | Nº total de lutas | Nº de rodadas |
|--------------|:---:|:---:|:---:|
| Rodízio-3    | 3   | 3   | 1   |
| Rodízio-4    | 4   | 6   | 3   |
| Rodízio-5    | 5   | 10  | 5   |
| Rodízio-6    | 6   | 15  | 5   |

Fórmula: total de lutas = n × (n-1) / 2

---

## Ordem das Lutas

A ordem das lutas é definida de forma a distribuir o descanso entre atletas de maneira justa, evitando que um atleta lute duas vezes consecutivas sempre que possível.

### Rodízio-3 (3 lutas)
```
Rodada 1:  1 × 2,  1 × 3
Rodada 1:  2 × 3
Ordem de lutas: 1-2, 1-3, 2-3
```

### Rodízio-4 (6 lutas, 3 rodadas)
```
Rodada 1:  1 × 2,  3 × 4
Rodada 2:  1 × 4,  2 × 3
Rodada 3:  1 × 3,  2 × 4
Ordem: 1-2, 3-4, 1-4, 2-3, 1-3, 2-4
```

### Rodízio-5 (10 lutas, 5 rodadas)
```
Rodada 1:  1 × 2,  3 × 4
Rodada 2:  1 × 5,  2 × 3
Rodada 3:  4 × 5,  1 × 3
Rodada 4:  2 × 4,  3 × 5
Rodada 5:  1 × 4,  2 × 5
Ordem: 1-2, 3-4, 1-5, 2-3, 4-5, 1-3, 2-4, 3-5, 1-4, 2-5
```

### Rodízio-6 (15 lutas, 5 rodadas)
```
Rodada 1:  1 × 2,  3 × 4,  5 × 6
Rodada 2:  1 × 3,  4 × 5,  2 × 6
Rodada 3:  1 × 4,  2 × 5,  3 × 6
Rodada 4:  1 × 5,  4 × 6,  2 × 3
Rodada 5:  1 × 6,  2 × 4,  3 × 5
Ordem: 1-2, 3-4, 5-6, 1-3, 4-5, 2-6, 1-4, 2-5, 3-6, 1-5, 4-6, 2-3, 1-6, 2-4, 3-5
```

---

## Estrutura da Súmula

A súmula de rodízio é uma **matriz n × n** onde:
- Linhas = atletas (1 a n)
- Colunas = adversários (1 a n)
- Célula [linha][coluna] = resultado da luta entre atleta da linha contra atleta da coluna

### Cabeçalho da tabela (exemplo para Rodízio-3)

| Atleta | vs 1 | vs 2 | vs 3 | Vitórias | Pontos | Lugar |
|--------|:----:|:----:|:----:|:--------:|:------:|:-----:|
| 1      | —    | RES/PON | RES/PON | | | |
| 2      | RES/PON | — | RES/PON | | | |
| 3      | RES/PON | RES/PON | — | | | |

Cada célula de resultado registra:
- **RES**: resultado da luta (V = vitória, D = derrota)
- **PON**: pontuação técnica obtida naquela luta

---

## Critérios de Classificação

Ordem de desempate:

1. **Vitórias** (maior número de vitórias)
2. **Pontos acumulados** (maior pontuação técnica total)
3. **Confronto direto** (quem venceu entre os empatados)
4. **Sorteio** (último recurso)

---

## Classificação Final

Todos os n atletas recebem colocação (1º ao nº lugar).
Não há eliminação. Todos lutam todas as rodadas.

---

## Pontuação por resultado (referência CBJ/IJF)

| Resultado | Pontos do vencedor |
|-----------|:-----------------:|
| Ippon / WO / Hansoku-make | 10 |
| Waza-ari | 7 |
| Derrota por punições (adversário Shido) | varia |

> A pontuação exata pode variar por evento. Encapsular regras em serviço separado.

---

## Observações de implementação

- A **diagonal** da matriz (atleta vs ele mesmo) não existe — deve ser bloqueada.
- A célula [A][B] e [B][A] são o mesmo confronto, só um lado é preenchido (o outro é espelho invertido).
- A ordem das lutas deve ser respeitada para garantir fairness no descanso entre atletas.
- O número de luta é sequencial global dentro da categoria, não por rodada.
- Um atleta pode ter **WO** (walkover) se o adversário não comparecer — conta como vitória por Ippon.
- Resultado de luta pode ser corrigido com audit trail (operador, motivo, timestamp).
