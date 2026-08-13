import type { AutoSendDiag } from "@/lib/ai";
import { fmtRelative } from "@/lib/ui";

/** Um cron atrasado mais que isto significa que ninguém está processando. */
const CRON_ATRASADO_MIN = 15;

type Linha = { ok: boolean; label: string; detalhe?: string };

/**
 * Por que o e-mail não saiu.
 *
 * O caminho até o envio tem sete elos, e todos falham em silêncio de propósito
 * — nenhum pode derrubar a ingestão dos e-mails. O efeito colateral é que a
 * tela não contava onde parou, e a resposta virava tentativa e erro por fora
 * do produto. Aqui cada elo aparece, e o veredito aponta o PRIMEIRO que falha:
 * consertar um elo adiante não adianta enquanto o de trás está quebrado.
 */
export default function AutoSendDiagnostics({ diag }: { diag: AutoSendDiag }) {
  const enviadas =
    diag.ultimas24h.find((a) => a.acao === "auto_enviado")?.n ?? 0;
  const total24h = diag.ultimas24h.reduce((s, a) => s + a.n, 0);

  const cronMin = diag.ultimoCron
    ? (Date.now() - new Date(diag.ultimoCron.quando).getTime()) / 60000
    : null;
  const cronOk = cronMin !== null && cronMin < CRON_ATRASADO_MIN;

  const linhas: Linha[] = [
    {
      ok: diag.tabelaOk,
      label: "Tabela auto_replies existe no banco",
      detalhe: diag.tabelaOk ? undefined : "migration 0010 não aplicada",
    },
    {
      ok: diag.respostasAtivas > 0,
      label: "Respostas automáticas ativas",
      detalhe: `${diag.respostasAtivas} cadastrada${diag.respostasAtivas === 1 ? "" : "s"}`,
    },
    { ok: diag.chaveDeepSeek, label: "DEEPSEEK_API_KEY configurada" },
    { ok: diag.iaLigada, label: "Geração de rascunhos ligada" },
    { ok: diag.envioAutomatico, label: "Envio automático ligado" },
    {
      ok: cronOk,
      label: "Cron de ingestão rodando",
      detalhe: diag.ultimoCron
        ? `última execução ${fmtRelative(diag.ultimoCron.quando)} (${diag.ultimoCron.status})`
        : "nunca rodou neste banco",
    },
    {
      ok: enviadas > 0,
      label: "E-mails enviados pela IA nas últimas 24h",
      detalhe: `${enviadas} de ${total24h} análise${total24h === 1 ? "" : "s"}`,
    },
  ];

  const primeiraFalha = linhas.find((l) => !l.ok);
  const tudoOk = !primeiraFalha;

  /** Veredito: o que fazer sobre o primeiro elo quebrado. */
  function veredito(): string {
    if (tudoOk) {
      return `Funcionando: ${enviadas} e-mail${enviadas === 1 ? "" : "s"} enviado${enviadas === 1 ? "" : "s"} sem revisão nas últimas 24h.`;
    }
    if (!diag.tabelaOk) {
      return "A migration 0010 não rodou NESTE banco. Enquanto a tabela não existir, nenhuma resposta é salva ou lida — rode drizzle/0010_respostas_automaticas.sql.";
    }
    if (diag.respostasAtivas === 0) {
      return "Não há resposta automática ativa neste banco. Se você cadastrou em outro ambiente (local x produção), a IA aqui não vê nada.";
    }
    if (!diag.chaveDeepSeek) {
      return "DEEPSEEK_API_KEY não está no ambiente — a IA não é chamada.";
    }
    if (!diag.iaLigada) {
      return "A geração de rascunhos está desligada logo acima nesta tela.";
    }
    if (!diag.envioAutomatico) {
      return "Marque “Enviar automaticamente, sem aprovação” e salve. Sem isso tudo vira rascunho.";
    }
    if (!cronOk) {
      return diag.ultimoCron
        ? `O cron não roda há ${Math.round(cronMin!)} min (deveria ser a cada 2). Nenhum e-mail novo está sendo analisado.`
        : "O cron nunca rodou neste banco. Em produção quem chama /api/cron/ingest é o Vercel Cron; em local, nada chama.";
    }
    if (total24h === 0) {
      return "Nenhuma mensagem nova nas últimas 24h — não houve o que enviar. Mande um e-mail de teste para a caixa: mensagem já analisada antes NÃO é reprocessada.";
    }
    return `A IA analisou ${total24h} mensagem${total24h === 1 ? "" : "ns"} e não liberou nenhuma para envio. Confira se o deploy inclui a regra que autoriza o envio quando o texto padrão é usado, e se o texto cadastrado responde ao que os clientes estão perguntando.`;
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Diagnóstico do envio automático
      </div>

      <div className={`callout ${tudoOk ? "warn" : "danger"}`}>
        <strong>{tudoOk ? "Tudo pronto." : "Parou aqui:"}</strong> {veredito()}
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {linhas.map((l) => (
          <li
            key={l.label}
            className="hint"
            style={{ display: "flex", gap: 8, marginTop: 4 }}
          >
            <span aria-hidden style={{ opacity: l.ok ? 1 : 0.9 }}>
              {l.ok ? "✓" : "✗"}
            </span>
            <span>
              {l.label}
              {l.detalhe ? ` — ${l.detalhe}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {diag.ultimoErro && (
        <p className="hint" style={{ marginTop: 10 }}>
          Último erro registrado pela IA ({fmtRelative(diag.ultimoErro.quando)}):{" "}
          <span className="mono">{diag.ultimoErro.msg}</span>
        </p>
      )}
    </div>
  );
}
