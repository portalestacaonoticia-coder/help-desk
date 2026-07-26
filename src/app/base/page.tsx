import { eq, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, knowledgeBase } from "@/db/schema";
import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { getAiSettings, DEFAULT_BASE_PROMPT } from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import {
  createCategoryAction,
  toggleCategoryAction,
  saveAiSettingsAction,
} from "@/app/actions";
import ArticleEditor from "./_components/ArticleEditor";

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
      autoRespondivel: categories.autoRespondivel,
      active: categories.active,
      articleCount: sql<number>`(
        select count(*)::int from ${knowledgeBase}
        where ${knowledgeBase.categoryId} = ${categories.id}
          and ${knowledgeBase.active}
      )`,
    })
    .from(categories)
    .orderBy(asc(categories.name));

  const articles = await db
    .select({
      id: knowledgeBase.id,
      title: knowledgeBase.title,
      content: knowledgeBase.content,
      keywords: knowledgeBase.keywords,
      categoryId: knowledgeBase.categoryId,
      categoryName: categories.name,
      updatedAt: knowledgeBase.updatedAt,
    })
    .from(knowledgeBase)
    .leftJoin(categories, eq(categories.id, knowledgeBase.categoryId))
    .where(eq(knowledgeBase.active, true))
    .orderBy(desc(knowledgeBase.updatedAt));

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Base de conhecimento</h1>
            <p className="page-sub">
              {articles.length} artigo{articles.length === 1 ? "" : "s"} e{" "}
              {catList.length} categoria{catList.length === 1 ? "" : "s"}. É esse
              material que orienta a IA ao redigir as respostas.
            </p>
          </div>
        </div>

        {!aiReady && (
          <div className="callout warn">
            <strong>DeepSeek não configurado.</strong> Defina{" "}
            <span className="mono">DEEPSEEK_API_KEY</span> no ambiente para a IA
            começar a gerar rascunhos. A base de conhecimento pode ser escrita
            normalmente antes disso.
          </div>
        )}

        {/* ---- Prompt base e parâmetros da IA ---- */}
        <div className="card pad">
          <div style={{ marginBottom: 16 }}>
            <div className="card-title">Prompt base</div>
            <p className="page-sub" style={{ fontSize: 13 }}>
              As instruções fixas enviadas à IA em toda análise, antes das
              categorias e dos artigos.
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

            <div className="grid-3">
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
              <div className="field">
                <label htmlFor="temperature">Temperatura</label>
                <input
                  id="temperature"
                  name="temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  defaultValue={settings.temperature}
                  disabled={!isAdmin}
                />
                <span className="hint">Menor = mais previsível.</span>
              </div>
              <div className="field">
                <label htmlFor="confidenceThreshold">Limiar de confiança</label>
                <input
                  id="confidenceThreshold"
                  name="confidenceThreshold"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  defaultValue={settings.confidenceThreshold}
                  disabled={!isAdmin}
                />
                <span className="hint">Abaixo disso não sugere categoria.</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="signature">Assinatura</label>
              <input
                id="signature"
                name="signature"
                placeholder="Equipe de Suporte Tihee"
                defaultValue={settings.signature ?? ""}
                disabled={!isAdmin}
              />
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

            <div className="callout" style={{ marginTop: 14 }}>
              A IA nunca envia e-mail sozinha: ela só prepara o rascunho, e o
              envio continua sendo um clique do agente no chamado.
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
                Nenhuma categoria. A IA precisa delas para classificar os
                chamados.
              </div>
            ) : (
              catList.map((c) => (
                <div key={c.id} className="macro-item">
                  <div className="head">
                    <strong>{c.name}</strong>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="pill">{c.articleCount} artigos</span>
                      {c.autoRespondivel && (
                        <span className="badge st-resolvido">Auto-respondível</span>
                      )}
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
                    <form action={toggleCategoryAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="field" value="autoRespondivel" />
                      <input
                        type="hidden"
                        name="value"
                        value={String(!c.autoRespondivel)}
                      />
                      <button type="submit">
                        {c.autoRespondivel
                          ? "Tirar auto-resposta"
                          : "Marcar auto-respondível"}
                      </button>
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
              <label className="check">
                <input type="checkbox" name="autoRespondivel" />
                <span>Auto-respondível no futuro</span>
              </label>
              <button type="submit" className="primary" style={{ width: "100%", marginTop: 12 }}>
                Criar categoria
              </button>
            </form>
          </div>
        </div>

        {/* ---- Artigos ---- */}
        <ArticleEditor articles={articles} categories={catList} />
      </section>
    </AppShell>
  );
}
