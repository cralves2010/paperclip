# CLAUDE.md — repo do cockpit M42 (ex-fork paperclip)

Guia de projeto para o Claude Code CLI e qualquer outro agente que abrir este repo.
O Cursor lê a própria cópia em `.cursor/rules/m42-fork-strategy.mdc`; mantenha os dois em sincronia.

---

## ☠️ LEIA ISTO ANTES DE QUALQUER COISA: o produto de agentes deste repo foi ELIMINADO em 2026-08-06

Este repositório **era** um fork white-label do [paperclipai/paperclip](https://github.com/paperclipai/paperclip),
rebrandeado como "M42 Agent" e servido em `agent.m42ai.tech`. **Esse produto não existe mais.**
Ordem do Claudio em 2026-08-06 (*"pode excluir totalmente"*), executada no mesmo dia:

- `agent.m42ai.tech` saiu do Caddy. O domínio não responde.
- Containers `paperclip-server-1`, `paperclip-claude-runner-1`, `paperclip-db-1`: removidos com as redes.
- Imagens `paperclip-server` e `paperclip-claude-runner`: deletadas.
- Dados (~58 GB) em `/opt/data/_lixeira-paperclip-20260806/` na VPS, purge marcada para **2026-09-05**.
- Backups finais provados + segredos: `~/.m42/vps-paperclip-final-20260806/` (workstation Windows).
- As 6 rotinas semanais que postavam em `#agent-m42-reports` morreram junto. O canal ficou sem função.

**O QUE ESTE REPO É HOJE:** a casa do **cockpit do Slack** (`docker/slack-cockpit/`), que é a
operação diária com o Derek, mais o histórico do fork. Nada aqui se deploya em servidor nenhum
além do cockpit.

### O que está VIVO e não pode ser quebrado

| Peça | Onde | O que é |
|---|---|---|
| **Cockpit do Slack** | `docker/slack-cockpit/` | App Home onde o Derek vê tarefas e comenta. Container `agent-m42-slack-cockpit` na VPS, projeto Compose **próprio** (`slack-cockpit`), rede própria, socket mode. Só depende de Slack + Google Sheets. |
| **`tracker.mjs`** | `docker/slack-cockpit/tools/tracker.mjs` | CLI de toda escrita no M42 Central Task Tracker. Usado por 6 skills M42. |
| **`.env.cockpit` + `sa.json`** | `/opt/apps/paperclip/docker/slack-cockpit/` na VPS | ⚠️ **Só existem lá.** Perder = painel morto até refazer token do Slack e chave do Google. |

Por isso `/opt/apps/paperclip` **continua existindo na VPS** e o repo GitHub
`cralves2010/paperclip` **continua existindo**: o cockpit mora dentro deles.

### Rename pendente (pedido explícito do Claudio, 2026-08-06)

`dev/paperclip` → `dev/cockpit`, em janela dedicada, **tudo num commit só**, depois da purge da
lixeira. Lembrete armado no ledger `followup:tracking` (id `rename-paperclip-cockpit`).
Os 10 arquivos com o caminho gravado: 6 skills M42 (`handoff_alves`, `m42-comment-sweep`,
`m42-daily-brief`, `m42-traceability`, `m42-tracker-protocol`, `slack-feed-update`),
`~/.claude/skills/system-health/system_health.py`, `dev/AGENTS.md`,
`dev/automation/cockpit/cockpit-drift-check.mjs`, `dev/scripts/bootstrap-m42-cloud.sh`.
Decidir junto: o destino do repo GitHub.

---

## O que NÃO fazer neste repo

- ❌ **Não propor trabalho, conserto, sync ou infra sobre o produto de agentes.** Ele morreu. Isso inclui os `.deploy/*.sh` de rebuild, o `claude-runner`, as migrações de banco e o board.
- ❌ **Não reativar o sync com o upstream.** O workflow `sync-upstream.yml` está `disabled_manually` no GitHub desde 2026-08-05 e deve continuar assim. Issues antigas com label `sync` são histórico, não trabalho.
- ❌ **Não tocar em `docker/slack-cockpit/`** sem entender que é produção viva do Derek. Mudança ali segue o gate humano de sempre.
- ❌ **Não apagar `/opt/apps/paperclip` na VPS** (o cockpit está dentro).
- ❌ Não commitar em `master`; não usar `--force` sem `--force-with-lease`.

## Branches (o que restou de útil)

| Branch | Estado hoje |
|---|---|
| `branding/m42` | Onde vivem nossos commits, incluindo o cockpit. Continua sendo a branch de trabalho. |
| `master` | Espelho congelado do upstream. Não commitar. |
| `my-customizations` | Workspace local antigo, sem uso. |

## Cockpit: operação

- Diretório de trabalho das skills: `c:\Users\cralv\dev\paperclip\docker\slack-cockpit` (Windows) ou `$M42_COCKPIT_DIR`.
- Chave da conta de serviço: `~/.m42/m42-cockpit-sa.json` (ou env `TRACKER_SA_JSON`).
- Toda escrita na planilha passa pelo `tracker.mjs` (whitelisted, auditado em `~/.m42/tracker-log.jsonl`).
- Deploy do cockpit: tar-over-ssh para `/opt/apps/paperclip/docker/slack-cockpit` + `docker compose up -d --build` naquele diretório. Detalhes em `project_agentm42_slack_cockpit` (auto-memory).
- Gotchas conhecidos: watchdog do socket (vivo-mas-surdo), conta de serviço não cria Google Docs. Ver `reference_paperclip_cockpit_socket_watchdog`.

## Marcas do fork que ainda aparecem no código

O rebranding para "M42 Agent" (4 lotes) segue no histórico. Não é mais assunto ativo:
ninguém vê essa interface. Se algum dia o código do cockpit precisar de copy, use
`BRAND_NAME` / `BRAND_SHORT_NAME` de `ui/src/lib/brand.ts`.

## Onde mais este contexto vive

| Superfície | Arquivo |
|---|---|
| Cursor IDE | `.cursor/rules/m42-fork-strategy.mdc` |
| Auto-memory | `project_paperclip_fork_being_retired` (store `dev`), `project_agentm42_slack_cockpit` |
| Vault | `Obsidian/Wiki/Projetos/Paperclip-Fork/` (índice + `plano-descontinuacao-2026-08-05.md`) |
| Registro da execução | `Obsidian/Daily/2026-08-06.md` · `falcon-autopilot/state/DECISIONS.md` |
