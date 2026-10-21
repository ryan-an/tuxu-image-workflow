import { randomUUID } from "node:crypto";
import { AppError, type Database, type Queryable } from "./types.js";
import { WORKSPACE } from "./repository.js";

export interface AssistantContext {
  productId?: string;
  taskId?: string;
}
export interface AssistantTurn {
  id: string;
  userText: string;
  assistantText: string | null;
  model: string;
  attempt: number;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  error: string;
  errorAction?: string;
  createdAt: number;
  updatedAt: number;
}
export interface AssistantConversation extends AssistantContext {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: AssistantTurn[];
}
const turn = (row: any): AssistantTurn => ({
  id: row.id,
  userText: row.user_text,
  assistantText: row.assistant_text,
  model: row.model,
  attempt: row.attempt,
  status: row.status,
  error: row.error,
  errorAction: row.error_action || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class AssistantConversations {
  constructor(private db: Database) {}
  async recover() {
    await this.db.query(
      "UPDATE assistant_turns SET status='interrupted',error=$1,updated_at=$2 WHERE status='running'",
      ["服务重启时回复中断，问题已保存；请按需重试。", Date.now()],
    );
  }
  async list(context: AssistantContext) {
    return (
      await this.db.query(
        "SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM assistant_conversations WHERE workspace_id=$1 AND product_id IS $2 AND task_id IS $3 ORDER BY selected DESC,updated_at DESC,rowid DESC",
        [WORKSPACE, context.productId ?? null, context.taskId ?? null],
      )
    ).rows;
  }
  async clear(context: AssistantContext) {
    return this.db.transaction(async (tx) => {
      const values = [
        WORKSPACE,
        context.productId ?? null,
        context.taskId ?? null,
      ];
      const running = (
        await tx.query(
          "SELECT 1 FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.workspace_id=$1 AND c.product_id IS $2 AND c.task_id IS $3 AND t.status='running' LIMIT 1",
          values,
        )
      ).rows[0];
      if (running) throw new AppError("请先停止回复，再清空对话历史", 409);
      await tx.query(
        "DELETE FROM assistant_conversations WHERE workspace_id=$1 AND product_id IS $2 AND task_id IS $3",
        values,
      );
      return { cleared: true };
    });
  }
  async get(
    id: string,
    tx: Queryable = this.db,
  ): Promise<AssistantConversation> {
    const row = (
      await tx.query(
        "SELECT * FROM assistant_conversations WHERE id=$1 AND workspace_id=$2",
        [id, WORKSPACE],
      )
    ).rows[0];
    if (!row) throw new AppError("对话记录不存在", 404);
    return {
      id: row.id,
      productId: row.product_id || undefined,
      taskId: row.task_id || undefined,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turns: (
        await tx.query(
          "SELECT * FROM assistant_turns WHERE conversation_id=$1 ORDER BY created_at,rowid",
          [id],
        )
      ).rows.map(turn),
    };
  }
  async create(
    context: AssistantContext,
    initial: { role: string; content: string }[] = [],
  ) {
    return this.db.transaction(async (tx) => {
      const id = randomUUID(),
        now = Date.now();
      await tx.query(
        "UPDATE assistant_conversations SET selected=0 WHERE workspace_id=$1 AND product_id IS $2 AND task_id IS $3",
        [WORKSPACE, context.productId ?? null, context.taskId ?? null],
      );
      await tx.query(
        "INSERT INTO assistant_conversations(id,workspace_id,product_id,task_id,title,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
        [
          id,
          WORKSPACE,
          context.productId ?? null,
          context.taskId ?? null,
          initial[0]?.content.slice(0, 40) || "新对话",
          now,
        ],
      );
      for (let i = 0; i + 1 < initial.length; i += 2)
        await tx.query(
          "INSERT INTO assistant_turns(id,conversation_id,user_text,assistant_text,model,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'completed',$6,$6)",
          [
            randomUUID(),
            id,
            initial[i].content,
            initial[i + 1].content,
            "",
            now,
          ],
        );
      return this.get(id, tx);
    });
  }
  async select(id: string) {
    return this.db.transaction(async (tx) => {
      const conversation = await this.get(id, tx);
      await tx.query(
        "UPDATE assistant_conversations SET selected=0 WHERE workspace_id=$1 AND product_id IS $2 AND task_id IS $3",
        [
          WORKSPACE,
          conversation.productId ?? null,
          conversation.taskId ?? null,
        ],
      );
      await tx.query(
        "UPDATE assistant_conversations SET selected=1 WHERE id=$1",
        [id],
      );
      return conversation;
    });
  }
  async start(
    id: string,
    turnId: string,
    message: string,
    model: string,
    retry = false,
  ) {
    return this.db.transaction(async (tx) => {
      const conversation = await this.get(id, tx);
      const existing = conversation.turns.find((item) => item.id === turnId);
      const other = (
        await tx.query(
          "SELECT conversation_id FROM assistant_turns WHERE id=$1",
          [turnId],
        )
      ).rows[0];
      if (other && other.conversation_id !== id)
        throw new AppError("该消息不属于当前对话", 409);
      if (existing && existing.userText !== message)
        throw new AppError("相同消息 ID 的内容不能修改", 409);
      if (existing?.status === "completed")
        return {
          cached: true,
          conversation,
          turn: existing,
          attempt: existing.attempt,
        };
      if (conversation.turns.some((item) => item.status === "running"))
        throw new AppError("当前对话正在回复，请等待或停止后再发送", 409);
      if (existing && !retry)
        throw new AppError("问题已保存，请点击重试继续", 409);
      const now = Date.now();
      if (existing) {
        await tx.query(
          "UPDATE assistant_turns SET status='running',assistant_text=NULL,error='',error_action=NULL,model=$2,updated_at=$3,attempt=attempt+1 WHERE id=$1",
          [turnId, model, now],
        );
      } else {
        await tx.query(
          "INSERT INTO assistant_turns(id,conversation_id,user_text,model,status,attempt,created_at,updated_at) VALUES($1,$2,$3,$4,'running',1,$5,$5)",
          [turnId, id, message, model, now],
        );
      }
      await tx.query(
        "UPDATE assistant_conversations SET title=CASE WHEN title='新对话' THEN $2 ELSE title END,updated_at=$3 WHERE id=$1",
        [id, message.slice(0, 40), now],
      );
      return {
        cached: false,
        conversation,
        turn: { id: turnId, userText: message },
        attempt: (existing?.attempt || 0) + 1,
      };
    });
  }
  async progress(id: string, turnId: string, text: string, attempt: number) {
    await this.db.query(
      "UPDATE assistant_turns SET assistant_text=$3,updated_at=$4 WHERE conversation_id=$1 AND id=$2 AND status='running' AND attempt=$5",
      [id, turnId, text, Date.now(), attempt],
    );
  }
  async finish(
    id: string,
    turnId: string,
    status: AssistantTurn["status"],
    text?: string,
    error = "",
    action?: string,
    attempt?: number,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE assistant_turns SET status=$3,assistant_text=COALESCE($4,assistant_text),error=$5,error_action=$6,updated_at=$7 WHERE conversation_id=$1 AND id=$2 AND status='running' AND ($8 IS NULL OR attempt=$8)",
        [
          id,
          turnId,
          status,
          text ?? null,
          error,
          action ?? null,
          Date.now(),
          attempt ?? null,
        ],
      );
      await tx.query(
        "UPDATE assistant_conversations SET updated_at=$2 WHERE id=$1",
        [id, Date.now()],
      );
      return this.get(id, tx);
    });
  }
}

export function assistantHistory(
  conversation: AssistantConversation,
  message: string,
) {
  const messages = conversation.turns
    .filter((item) => item.status === "completed")
    .flatMap((item) => [
      { role: "user", content: item.userText },
      { role: "assistant", content: item.assistantText! },
    ]);
  messages.push({ role: "user", content: message });
  const recent = messages
    .slice(-31)
    .map((item) => ({ ...item, content: item.content.slice(0, 16000) }));
  while (
    recent.length > 1 &&
    recent.reduce((sum, item) => sum + item.content.length, 0) > 100000
  )
    recent.splice(0, 2);
  return recent;
}
