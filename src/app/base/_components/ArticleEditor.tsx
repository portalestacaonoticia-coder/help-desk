"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveArticleAction, deleteArticleAction } from "@/app/actions";

export type ArticleLite = {
  id: number;
  title: string | null;
  content: string | null;
  keywords: string | null;
  categoryId: number | null;
  categoryName: string | null;
  updatedAt: Date | string;
};

type CategoryLite = { id: number; name: string };

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={pending}>
      {pending ? "Salvando…" : editing ? "Salvar alterações" : "Criar artigo"}
    </button>
  );
}

export default function ArticleEditor({
  articles,
  categories,
}: {
  articles: ArticleLite[];
  categories: CategoryLite[];
}) {
  const [editing, setEditing] = useState<ArticleLite | null>(null);

  // key força o form a remontar (e resetar os defaultValue) ao trocar de artigo.
  const formKey = editing?.id ?? "novo";

  return (
    <div className="macro-grid">
      <div className="card">
        <div className="card-head">
          Artigos
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              Novo artigo
            </button>
          )}
        </div>

        {articles.length === 0 ? (
          <div className="empty">
            Nenhum artigo ainda. Escreva o primeiro ao lado — é ele que a IA vai
            usar para redigir as respostas.
          </div>
        ) : (
          articles.map((a) => (
            <div
              key={a.id}
              className={`macro-item${editing?.id === a.id ? " selected" : ""}`}
            >
              <div className="head">
                <strong>{a.title || "(sem título)"}</strong>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {a.categoryName && <span className="pill">{a.categoryName}</span>}
                  <button type="button" onClick={() => setEditing(a)}>
                    Editar
                  </button>
                </span>
              </div>
              <div className="body" style={{ maxHeight: 60, overflow: "hidden" }}>
                {a.content}
              </div>
              {a.keywords && (
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {a.keywords.split(",").map((k) => (
                    <span key={k} className="pill mono">
                      {k.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card props">
        <span className="card-title">
          {editing ? `Editando artigo ${editing.id}` : "Novo artigo"}
        </span>

        <form key={formKey} action={saveArticleAction}>
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="field">
            <label htmlFor="title">Título</label>
            <input
              id="title"
              name="title"
              defaultValue={editing?.title ?? ""}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="categoryId">Categoria</label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={editing?.categoryId ?? ""}
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="keywords">Palavras-chave</label>
            <input
              id="keywords"
              name="keywords"
              placeholder="csv, importação, lote"
              defaultValue={editing?.keywords ?? ""}
            />
            <span className="hint">
              Separadas por vírgula. Ajudam a casar o artigo com o e-mail.
            </span>
          </div>

          <div className="field">
            <label htmlFor="content">Conteúdo</label>
            <textarea
              id="content"
              name="content"
              required
              style={{ minHeight: 200 }}
              defaultValue={editing?.content ?? ""}
              placeholder="Descreva o problema e o procedimento de solução. A IA responde só com base no que estiver aqui."
            />
          </div>

          <SaveButton editing={Boolean(editing)} />
        </form>

        {editing && (
          <form action={deleteArticleAction} style={{ marginTop: 4 }}>
            <input type="hidden" name="id" value={editing.id} />
            <button type="submit" className="danger" style={{ width: "100%" }}>
              Excluir artigo
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
