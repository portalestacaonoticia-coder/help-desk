import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { getAiSettings, DEFAULT_BASE_PROMPT } from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import { saveAiSettingsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BasePage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const settings = await getAiSettings();
  const aiReady = isAiConfigured();

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
          <div style={{ marginBottom: 16 }}>
            <div className="card-title">Prompt para Rascunhos</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              As instruções fixas enviadas à IA em toda análise.
            </p>
          </div>

          <form action={saveAiSettingsAction}>
            <div className="field">
              <label htmlFor="basePrompt">Instruções</label>
              <textarea
                id="basePrompt"
                name="basePrompt"
                style={{ minHeight: 220 }}
                defaultValue={settings.basePrompt || DEFAULT_BASE_PROMPT}
                disabled={!isAdmin}
              />
            </div>

            <div className="field">
              <label htmlFor="model">Modelo</label>
              <select
                id="model"
                name="model"
                defaultValue={settings.model}
                disabled={!isAdmin}
              >
                <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
              </select>
            </div>

            <label className="check">
              <input
                type="checkbox"
                name="enabled"
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

            <label className="check">
              <input
                type="checkbox"
                name="autoSendEnabled"
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
                  cliente sem ninguém revisar, em qualquer categoria. A única
                  barreira que resta é a própria IA sinalizar que o caso precisa
                  de um humano.
                </>
              ) : (
                <>
                  <strong>Envio automático desligado.</strong> A IA só prepara o
                  rascunho; o envio é um clique do agente no chamado.
                </>
              )}
            </div>

            {isAdmin ? (
              <button type="submit" className="primary" style={{ marginTop: 14 }}>
                Salvar configurações
              </button>
            ) : (
              <p className="hint" style={{ marginTop: 14 }}>
                Só administradores podem alterar o prompt base.
              </p>
            )}
          </form>
        </div>
      </section>
    </AppShell>
  );
}
