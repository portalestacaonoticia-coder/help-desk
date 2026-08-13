import { asc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { db } from "@/db";
import { mailboxes } from "@/db/schema";
import {
  getAiSettings,
  getAutoSendDiagnosis,
  listAutoReplies,
  DEFAULT_BASE_PROMPT,
} from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import { saveAiSettingsAction } from "@/app/actions";
import AutoReplyManager from "./_components/AutoReplyManager";
import AutoSendDiagnostics from "./_components/AutoSendDiagnostics";

export const dynamic = "force-dynamic";

/**
 * Id do formulário de configuração. Os campos ficam fora dele no DOM e se
 * associam por `form={SETTINGS_FORM}` — ver o comentário no JSX.
 */
const SETTINGS_FORM = "ai-settings-form";

/** Nome de exibição da caixa: operação quando existe, senão o rótulo. */
const MAILBOX_NAME = sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`;

export default async function BasePage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const settings = await getAiSettings();
  const aiReady = isAiConfigured();

  const autoReplies = await listAutoReplies();
  const diag = await getAutoSendDiagnosis();
  const mbList = await db
    .select({ id: mailboxes.id, nome: MAILBOX_NAME })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Base de conhecimento</h1>
          </div>
        </div>

        {!aiReady && (
          <div className="callout warn">
            <strong>DeepSeek não configurado.</strong> Defina{" "}
            <span className="mono">DEEPSEEK_API_KEY</span> no ambiente para a IA
            começar a gerar rascunhos.
          </div>
        )}

        <div className="card pad">
          {/* O formulário é um elemento VAZIO: cada campo se liga a ele pelo
              atributo `form`. É o que permite a lista de respostas
              automáticas — que tem formulários próprios — ficar no meio da
              seção de envio automático sem aninhar <form>, o que seria html
              inválido e faria o navegador descartar o de dentro. */}
          <form id={SETTINGS_FORM} action={saveAiSettingsAction} />

          {/* Fica no topo, fora das duas seções: o modelo é o mesmo para
              rascunho e para envio automático. */}
          <div className="field">
            <label htmlFor="model">Modelo</label>
            <select
              id="model"
              name="model"
              form={SETTINGS_FORM}
              defaultValue={settings.model}
              disabled={!isAdmin}
            >
              <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            </select>
            <span className="hint">
              Vale para tudo: rascunhos e envio automático usam este modelo.
            </span>
          </div>

          <div className="hr" style={{ margin: "20px 0" }} />

          <div style={{ marginBottom: 12 }}>
            <div className="card-title">Prompt para Rascunhos</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              As instruções fixas enviadas à IA em toda análise.
            </p>
          </div>

          <div className="field">
            <label htmlFor="basePrompt">Instruções</label>
            <textarea
              id="basePrompt"
              name="basePrompt"
              form={SETTINGS_FORM}
              style={{ minHeight: 220 }}
              defaultValue={settings.basePrompt || DEFAULT_BASE_PROMPT}
              disabled={!isAdmin}
            />
          </div>

          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              form={SETTINGS_FORM}
              defaultChecked={settings.enabled}
              disabled={!isAdmin}
            />
            <span>Gerar rascunhos automaticamente ao receber e-mails</span>
          </label>

          <div className="hr" style={{ margin: "20px 0" }} />

          <div style={{ marginBottom: 12 }}>
            <div className="card-title">Prompt para Envio automático</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              Instruções que a IA segue quando responde sozinha, somadas ao
              prompt base. Só valem quando o envio automático está ligado.
            </p>
          </div>

          <div className="field">
            <label htmlFor="autoSendPrompt">Prompt do envio automático</label>
            <textarea
              id="autoSendPrompt"
              name="autoSendPrompt"
              form={SETTINGS_FORM}
              style={{ minHeight: 140 }}
              placeholder={
                "- Responda apenas o que estiver coberto pelo material da operação.\n" +
                "- Na menor dúvida, marque precisa_humano: true em vez de responder.\n" +
                "- Nunca cite valores, prazos ou condições que não estejam no material."
              }
              defaultValue={settings.autoSendPrompt}
              disabled={!isAdmin}
            />
          </div>

          {/* Respostas automáticas: o conteúdo que o prompt acima governa.
              Salvam sozinhas, uma a uma — o botão do fim da seção é só das
              configurações. */}
          <div style={{ margin: "22px 0 12px" }}>
            <div className="card-title">Respostas automáticas por idioma</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              O prompt acima é o guia geral, igual para todas as caixas. Aqui
              fica o texto que vai ao cliente: um por idioma em cada caixa. A
              IA identifica o idioma do e-mail e responde com o texto daquele
              idioma, sem traduzir nem reescrever. Cadastre a resposta de cada
              caixa, depois marque{" "}
              <strong>Enviar automaticamente, sem aprovação</strong> e salve.
            </p>
          </div>

          {mbList.length === 0 ? (
            <div className="callout warn">
              <strong>Nenhuma caixa cadastrada.</strong> Cadastre a caixa em{" "}
              <span className="mono">/caixas</span> antes de escrever a resposta
              automática dela.
            </div>
          ) : (
            <AutoReplyManager
              replies={autoReplies}
              mailboxes={mbList}
              isAdmin={isAdmin}
            />
          )}

          {/* Depois da lista e antes da trava: é aqui que a pergunta "por que
              não enviou?" aparece, com o estado real do banco desta app. */}
          <AutoSendDiagnostics diag={diag} />

          <label className="check" style={{ marginTop: 20 }}>
            <input
              type="checkbox"
              name="autoSendEnabled"
              form={SETTINGS_FORM}
              defaultChecked={settings.autoSendEnabled}
              disabled={!isAdmin}
            />
            <span>Enviar automaticamente, sem aprovação</span>
          </label>

          <div
            className={`callout ${settings.autoSendEnabled ? "danger" : "warn"}`}
            style={{ marginTop: 14 }}
          >
            {settings.autoSendEnabled ? (
              <>
                <strong>Envio automático LIGADO.</strong> E-mails saem para o
                cliente sem ninguém revisar, em qualquer categoria. Cada
                resposta só sai se a IA liberar explicitamente; qualquer
                hesitação, erro ou resposta inesperada dela vira rascunho.
              </>
            ) : (
              <>
                <strong>Envio automático desligado.</strong> A IA só prepara o
                rascunho; o envio é um clique do agente no chamado.
              </>
            )}
          </div>

          {isAdmin ? (
            <button
              type="submit"
              form={SETTINGS_FORM}
              className="primary"
              style={{ marginTop: 14 }}
            >
              Salvar configurações
            </button>
          ) : (
            <p className="hint" style={{ marginTop: 14 }}>
              Só administradores podem alterar o prompt base.
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
