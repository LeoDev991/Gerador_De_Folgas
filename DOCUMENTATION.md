## Sistema de escalas de folga (5x2 e 6x1)

### Visão geral
Aplicação web que cadastra funcionários e gera automaticamente escalas de trabalho/folga com regras trabalhistas e anti‑conflito por loja, categoria e turno. Frontend SPA vanilla (HTML/CSS/JS) consumindo API Express + SQLite.

### Tecnologias e para que servem
- **Node.js + Express 5**: servidor HTTP, rotas REST, fallback SPA.
- **SQLite (sqlite3)**: persistência local em `database.sqlite` (funcionários, escalas, dias).
- **body-parser / JSON nativo do Express**: parse de JSON das requisições.
- **cors**: habilita CORS para acesso local no navegador.
- **express-session**: (mantido, mas não usado na nova lógica de folgas) — pode ser removido se não houver autenticação.
- **bcryptjs, nodemailer, nanoid**: dependências herdadas; não são usadas no fluxo atual de escalas.
- **Frontend vanilla** (`public/index.html`, `public/styles.css`): UI para cadastrar, filtrar e visualizar calendário, exportar CSV.

### Como rodar
1. `npm install`
2. `npm start` (ou `PORT=4000 npm start`)
3. Abra `http://localhost:3000`

### Banco de dados
- Arquivo: `database.sqlite`
- Tabelas criadas automaticamente em `server.js`:
  - `employees(id, name, store, category, shift, schedule_type, created_at)`
    - `store` enum: Nescafé, Living Heineken, Forneria, Qualycon, Quioque Living
    - `category` enum: Ar, Terra
    - `shift` enum: Manhã, Tarde, Noite
    - `schedule_type` enum: 5x2, 6x1
  - `schedules(id, month, year, created_at)`
  - `schedule_days(id, schedule_id, employee_id, day, status)` com status FOLGA ou TRABALHO

### Regras de negócio implementadas
- **5x2**: 5 dias trabalho, 2 folgas; 1 fim de semana completo obrigatório; folgas em pares; no máximo 5 dias consecutivos de trabalho; no máximo 2 folgas consecutivas.
- **6x1**: 6 trabalho, 1 folga; 1 domingo de folga obrigatório; no máximo 6 dias consecutivos de trabalho; no máximo 2 folgas consecutivas.
- **Conflitos**: não permite dois funcionários do mesmo grupo (loja+categoria+turno) folgarem no mesmo dia. Se gerar conflito, tenta deslocar folga para o dia livre mais próximo mantendo regras.
- **Backtracking/heurística**: para cada geração global são feitas até 20 tentativas. Em cada tentativa os funcionários são embaralhados; se qualquer funcionário não encontrar folgas válidas, a tentativa é descartada e recomeça.
- **Validação final**: só grava a escala se todos passaram sem conflitos e dentro das regras. Caso contrário, retorna erro 500 com mensagem para tentar novamente.

### API principal
- `GET /api/employees` — lista funcionários.
- `POST /api/employees` — cria funcionário `{ name, store, category, shift, schedule_type }`.
- `DELETE /api/employees/:id` — remove funcionário.
- `POST /api/schedules/generate` — gera escala para `{ month, year }` (número inteiro, mês 1‑12). Recalcula tudo.
- `GET /api/schedules/latest` — retorna última escala com dias e funcionários.
- `GET /api/schedules/:id/export?format=csv` — exporta CSV com T/F (Trabalho/Folga).

### Fluxo do algoritmo de geração (resumo)
1. Embaralha a lista de funcionários.
2. Para cada funcionário:
   - Gera rascunho (padrão 5x2 ou 6x1) com fim de semana ou domingo obrigatório.
   - Corta sequências de folga >2; garante pares em 5x2; impõe limite de trabalho contínuo (5 ou 6).
   - Verifica conflito de folga com o mapa global do grupo. Se houver, tenta mover folga para o dia livre mais próximo mantendo regras.
   - Se ainda falhar, aborta a tentativa global.
3. Se todos passaram, grava `schedules` e `schedule_days`. Caso contrário, repete até 20 tentativas.

### Frontend (public/index.html)
- Cadastro rápido de funcionário (loja, categoria, turno, tipo de escala).
- Filtros por loja, turno, tipo.
- Botões: “Gerar/Regerar” e exportar CSV.
- Calendário em grid com cabeçalho dia + semana, células T/F, nomes truncados com tooltip.
- Após adicionar funcionário, o frontend chama nova geração automaticamente e recarrega o calendário sem refresh.

### Exportação CSV
- Cabeçalho: `Funcionario,Loja,Categoria,Turno,DD/MM,...`
- Corpo: `T` para trabalho, `F` para folga.

### Pontos de estudo sugeridos
- Heurísticas de backtracking leve para alocação com restrições (uso de retries + embaralhamento).
- Normalização de regras em funções puras: `validateConstraints`, `enforceMaxWorkStreak`, `ensurePairsFor5x2`, `shiftConflicts`.
- Estratégias de anti‑conflito por chave composta (loja+categoria+turno) com mapas in‑memory.
- Persistência simples com SQLite e uso de constraints CHECK para listas fechadas.

### Próximos incrementos (ideias)
- Autenticação real (remover dependências não usadas ou reativar login/sessão para perfis admin).
- Histórico de versões da escala e comparação diff.
- Exportação PDF e edição manual com salvamento.
- Cobrir geração com testes de propriedade (ex: fast-check) para validar regras automaticamente.

