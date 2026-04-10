CHANGELOG GERAÇÃO DE ESCALAS
=============================

Resumo (em Português)
---------------------
Objetivo: Remover qualquer possibilidade de que um funcionário termine o mês sem folga ou com 3 dias consecutivos de folga. Além disso, registrei e avisei na UI quando o gerador teve que usar um fallback relaxado e documentei as mudanças e tecnologias envolvidas para estudo e uso em entrevistas.

O que foi alterado
------------------
1) Sincronização de gravação
   - O endpoint POST `/api/schedules/generate` foi ajustado para só responder depois que todas as linhas `schedule_days` foram inseridas no banco. Isso evita condições de corrida onde o front-end consulta uma escala incompleta.

2) Retorno do funcionário criado
   - O endpoint POST `/api/employees` agora retorna o registro completo do empregado criado (linha do banco) para que o cliente possa atualizar a UI imediatamente sem fetch extra.

3) Garantias de restrição reforçadas (principal)
   - Nenhum funcionário pode ter 3 dias consecutivos de folga.
   - Nenhum funcionário pode terminar sem folga (pelo menos 1 folga garantida).

   Implementações específicas:
   - `trimToMaxTwoConsecutive(offSet)` foi usada/ajustada para remover dias que criem sequências >2.
   - `wouldCreateThreeConsecutive(offSet, day)` (nova) verifica se adicionar um dia criaria 3 dias consecutivos.
   - `enforceMaxWorkStreak` agora evita inserir folgas que criariam 3 consecutivos usando `wouldCreateThreeConsecutive`.
   - `buildEmployeeOffDays` recebeu uma etapa final que garante: aplica `trimToMaxTwoConsecutive`, tenta adicionar um dia "seguro" (domingo / fim de semana / dia 1) se `offSet` ficar vazio, e valida constraints antes de confirmar.
   - O fallback relaxado (quando o algoritmo normal falha) foi reforçado para garantir pelo menos uma folga e evitar 3 consecutivos sempre que possível.

4) Logs e avisos na UI
   - O servidor registra (console.warn) quando um funcionário não conseguiu gerar folgas em alguma tentativa.
   - O endpoint de geração retorna `{ schedule_id, used_fallback, failed_employees }`.
   - A UI (`public/index.html`) exibe um aviso visível quando o fallback foi usado ou quando houve falhas para funcionários específicos.

Arquivos modificados
--------------------
- `server.js` (múltiplas alterações: geração, validações, logs)
- `public/index.html` (atualização do fluxo de adicionar funcionário e exibição de aviso)
- `CHANGELOG_GERACAO.md` (este arquivo)

Tecnologias utilizadas e por que são relevantes para entrevistas
---------------------------------------------------------------
- Node.js (runtime) — ambiente de execução do servidor. Demonstra conhecimento de JS fora do browser.
- Express — framework HTTP minimalista. Útil para discutir rotas, middlewares e tratamento de erros.
- sqlite3 (node-sqlite3) — DB embutido. Mostra operações SQL básicas, migrações leves e tratamento de concorrência limitada.
- JavaScript (ES6+) — uso de Set, Map, funções auxiliares, closures e código assíncrono com callbacks.
- Fetch API (front-end) — comunicação cliente-servidor, tratamento de JSON e erros.
- HTML/CSS (front-end simples) — criação de componentes UI, atualização dinâmica do DOM.
- Técnicas/algoritmos:
  - Algoritmos heurísticos para geração de escalas, tentativa e fallback (randomização + validações iterativas).
  - Estratégias para evitar condições de corrida (esperar finalização de callbacks antes de responder).
  - Uso de estruturas Set/Map para checar conflitos de folga por "grupo" (store-category-shift).
  - Validação e normalização de dados antes de persistir.

Pontos interessantes para discussão em entrevista
------------------------------------------------
- Concorrência e atomicidade: SQLite3 embutido não é concorrente como um servidor SQL, então a estratégia foi serializar e aguardar callbacks. Em produção com alto throughput, usar transações e/ou um DB servidor (Postgres) e filas seria melhor.
- Balanceamento entre validade e disponibilidade: o gerador tenta várias vezes (algoritmo estocástico) e cai num fallback relaxado para garantir entrega — trade-off entre qualidade da escala e garantia de produção.
- Métricas/telemetria: logs atuais ajudam a diagnosticar kombinações problemáticas; idealmente enviar a eventos (Sentry, ELK, etc.) ou armazenar em tabela para análise posterior.
- Testes: a geração é não-determinística; para entrevistas, explicar como criar testes determinísticos (seed do random, mocks, casos limites) é importante.

Sugestões para próximos passos (opcionais)
-----------------------------------------
- Implementar testes unitários e integração para o gerador (mocks para o DB, seeds de RNG).
- Melhorar algoritmo para ser menos "trial-and-error" (programação inteira, SAT solver, algoritmo guloso com prioridades).
- Persistir estatísticas de geração para análise (quantas vezes fallback usado por mês, quais turnos mais problemáticos).

Contato técnico rápido / comandos úteis
--------------------------------------
- Start server:

```bash
node server.js
```

- Endpoints relevantes:
  - GET `/api/employees`
  - POST `/api/employees` (body: name,store,category,shift,schedule_type) -> retorna empregado criado
  - POST `/api/schedules/generate` (body: month,year) -> gera escala e retorna { schedule_id, used_fallback, failed_employees }

Notas finais
-----------

---

## 2026-04-08 23:22:12 — daa48f1

**Resumo:** Update server.js

**Autor:** Leonardo Thome <158233688+LeoDev991@users.noreply.github.com>

**Arquivos modificados:**
- server.js

> Inserido automaticamente pelo script `scripts/update-changelog.js`
