import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { getAiSettings, DEFAULT_BASE_PROMPT } from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import {
  createCategoryAction,
  toggleCategoryAction,
  saveAiSettingsAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BasePage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const settings = await getAiSettings();
  const aiReady = isAiConfigured();

  const catList = await db
    .select({
      id: categories.id,
      name: categories.name,
      description: categories.description,
      active: categories.active,
    })
    .from(categories)
    .orderBy(asc(categories.name));

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Base de conhecimento</h1>
            <p className="page-sub">
              {catList.length} categoria{catList.length === 1 ? "" : "s"}. O
              prompt base e as categorias orientam a IA ao classificar e redigir
              as respostas.
            </p>
          </div>
        </div>

        {!aiReady && (
          <div className="callout warn">
            <strong>DeepSeek não configurado.</strong> Defina{" "}
            <span className="mono">DEEPSEEK_API_KEY</span> no ambiente para a IA
            começar a gerar rascunhos.
          </div>
        )}

        {/* ---- Prompt base e parâmetros da IA ---- */}
        <div className="card pad">
          <div style={{ marginBottom: 16 }}>
            <div className="card-title">Prompt base</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              As instruções fixas enviadas à IA em toda análise, antes das
              categorias.
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
              <div className="card-title">Envio automático</div>
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
              <span>
                Enviar automaticamente, sem aprovação
              </span>
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

        {/* ---- Categorias ---- */}
        <div className="macro-grid">
          <div className="card">
            <div className="card-head">Categorias</div>
            {catList.length === 0 ? (
              <div className="empty">
                Nenhuma categoria. A IA precisa delas para classificar as
                respostas.
              </div>
            ) : (
              catList.map((c) => (
                <div key={c.id} className="macro-item">
                  <div className="head">
                    <strong>{c.name}</strong>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {!c.active && <span className="badge neutral">Inativa</span>}
                    </span>
                  </div>
                  {c.description && <div className="body">{c.description}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <form action={toggleCategoryAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="field" value="active" />
                      <input type="hidden" name="value" value={String(!c.active)} />
                      <button type="submit">{c.active ? "Desativar" : "Ativar"}</button>
                    </form>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card props">
            <span className="card-title">Nova categoria</span>
            <form action={createCategoryAction}>
              <div className="field">
                <label htmlFor="cat-name">Nome</label>
                <input id="cat-name" name="name" required placeholder="Integração" />
              </div>
              <div className="field">
                <label htmlFor="cat-desc">Descrição</label>
                <textarea
                  id="cat-desc"
                  name="description"
                  style={{ minHeight: 90 }}
                  placeholder="Problemas de importação, APIs e conexões com sistemas externos."
                />
                <span className="hint">
                  É o texto que a IA lê para decidir a classificação.
                </span>
              </div>
              <button type="submit" className="primary" style={{ width: "100%", marginTop: 12 }}>
                Criar categoria
              </button>
            </form>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
