import { useEffect, useRef, useState } from "react";
import {
  assistantApi,
  streamAssistantChat,
  conversationQuery,
  AssistantRequestError,
  type AssistantContext,
  type AssistantConversation,
  type AssistantTurn,
  type ConversationSummary,
} from "../../services/assistant";

export function useAssistantConversation(
  context: AssistantContext & { open: boolean },
  remote: boolean,
  flush: () => Promise<void>,
) {
  const [conversation, setConversation] = useState<AssistantConversation>();
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState<string>();
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const selected = useRef<string | undefined>(undefined);
  const loadRequest = useRef<AbortController | null>(null);
  const operation = useRef<{
    controller: AbortController;
    turnId: string;
    conversationId?: string;
    message: string;
  } | null>(null);
  const identity = { productId: context.productId, taskId: context.taskId };
  const running = conversation?.turns.find((item) => item.status === "running");
  const pending = posting || !!running;
  function display(value: AssistantConversation) {
    if (!mounted.current) return;
    selected.current = value.id;
    setConversation(value);
  }
  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "读取对话失败，请重试");
    setErrorAction(
      cause instanceof AssistantRequestError ? cause.action : undefined,
    );
  }
  async function list(signal?: AbortSignal) {
    const data = await assistantApi<{ conversations: ConversationSummary[] }>(
      `conversations${conversationQuery(identity)}`,
      undefined,
      signal,
    );
    if (mounted.current && !signal?.aborted) setHistory(data.conversations);
    return data.conversations;
  }
  async function load(id = selected.current) {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true);
    setError("");
    setErrorAction(undefined);
    try {
      const entries = await list(controller.signal);
      const target = id || entries[0]?.id;
      if (target) {
        const saved = await assistantApi<AssistantConversation>(
          `conversations/${target}`,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          display(saved);
          const last = saved.turns.at(-1);
          if (last && ["failed", "interrupted"].includes(last.status)) {
            setError(last.error);
            setErrorAction(last.errorAction);
          }
        }
      } else if (!controller.signal.aborted) setConversation(undefined);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) fail(cause);
    } finally {
      if (loadRequest.current === controller && mounted.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.controller.abort();
      loadRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (context.open && remote && !operation.current) void load();
  }, [context.open, remote]);
  useEffect(() => {
    if (!running || posting) return;
    const timer = setTimeout(() => void load(), 1500);
    return () => clearTimeout(timer);
  }, [running, posting]);

  async function clearHistory() {
    if (pending || loading || !remote) return;
    loadRequest.current?.abort();
    setLoading(true);
    setError("");
    setErrorAction(undefined);
    try {
      await flush();
      await assistantApi("conversations/clear", identity);
      if (!mounted.current) return;
      selected.current = undefined;
      setConversation(undefined);
      setHistory([]);
      setDraft("");
      setNotice("");
    } catch (cause) {
      if (mounted.current) fail(cause);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  async function send(value = draft, retry?: AssistantTurn) {
    if (operation.current || pending || loading || !value.trim()) return;
    const question = value.trim();
    const op = {
      controller: new AbortController(),
      turnId: retry?.id || crypto.randomUUID(),
      conversationId: conversation?.id,
      message: question,
    };
    operation.current = op;
    setPosting(true);
    setError("");
    setErrorAction(undefined);
    setNotice("");
    setDraft("");
    try {
      await flush();
      if (op.controller.signal.aborted) return;
      let active = conversation;
      if (!active)
        active = await assistantApi<AssistantConversation>(
          "conversations",
          identity,
          op.controller.signal,
        );
      op.conversationId = active.id;
      const now = Date.now();
      display({
        ...active,
        turns: retry
          ? active.turns.map((item) =>
              item.id === retry.id
                ? { ...item, status: "running", assistantText: null, error: "" }
                : item,
            )
          : [
              ...active.turns,
              {
                id: op.turnId,
                userText: question,
                assistantText: null,
                model: "",
                status: "running",
                error: "",
                createdAt: now,
                updatedAt: now,
              },
            ],
      });
      const result = await streamAssistantChat(
        {
          ...identity,
          conversationId: active.id,
          turnId: op.turnId,
          message: question,
          retry: !!retry,
        },
        op.controller.signal,
        (event) => {
          if (
            !mounted.current ||
            operation.current !== op ||
            op.controller.signal.aborted ||
            event.conversationId !== op.conversationId ||
            event.turnId !== op.turnId
          )
            return;
          setConversation((current) =>
            current?.id === event.conversationId
              ? {
                  ...current,
                  turns: current.turns.map((turn) =>
                    turn.id === event.turnId
                      ? {
                          ...turn,
                          assistantText:
                            event.type === "snapshot"
                              ? event.text
                              : (turn.assistantText || "") + event.text,
                          updatedAt: Date.now(),
                        }
                      : turn,
                  ),
                }
              : current,
          );
        },
      );
      if (mounted.current && operation.current === op) {
        display(result.conversation);
        await list().catch(() => {});
      }
    } catch (cause) {
      if (
        mounted.current &&
        operation.current === op &&
        !op.controller.signal.aborted
      ) {
        fail(cause);
        setDraft(question);
        if (cause instanceof AssistantRequestError && cause.conversation)
          display(cause.conversation);
        else if (op.conversationId) {
          try {
            display(
              await assistantApi<AssistantConversation>(
                `conversations/${op.conversationId}`,
              ),
            );
          } catch {
            /* Keep the saved question visible until history can be reloaded. */
          }
        }
      }
    } finally {
      if (operation.current === op) {
        operation.current = null;
        if (mounted.current) setPosting(false);
      }
    }
  }
  async function stop() {
    loadRequest.current?.abort();
    const op = operation.current;
    operation.current = null;
    op?.controller.abort();
    setPosting(false);
    const conversationId = op?.conversationId || conversation?.id,
      turnId = op?.turnId || running?.id;
    if (!conversationId || !turnId) {
      setDraft(op?.message || running?.userText || draft);
      return;
    }
    setLoading(true);
    try {
      display(
        await assistantApi<AssistantConversation>(
          `conversations/${conversationId}/turns/${turnId}/cancel`,
          {},
        ),
      );
      setDraft(
        op?.message ||
          conversation?.turns.find((item) => item.id === turnId)?.userText ||
          "",
      );
      setNotice("已停止回复，问题和已收到的回复已保存。");
    } catch (cause) {
      if (cause instanceof AssistantRequestError && cause.status === 404)
        await load(conversationId);
      else fail(cause);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  const messages = (conversation?.turns || []).flatMap((turn) => [
    { role: "user" as const, content: turn.userText, turn },
    ...(turn.assistantText
      ? [{ role: "assistant" as const, content: turn.assistantText, turn }]
      : []),
  ]);
  return {
    conversation,
    hasHistory: history.length > 0 || !!conversation,
    messages,
    draft,
    setDraft,
    pending,
    loading,
    error,
    setError,
    errorAction,
    setErrorAction,
    notice,
    setNotice,
    send,
    stop,
    clearHistory,
    reload: () => load(),
  };
}
