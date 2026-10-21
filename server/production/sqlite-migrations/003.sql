CREATE TABLE assistant_conversations (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
 task_id TEXT,
 title TEXT NOT NULL DEFAULT '新对话',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(task_id IS NULL OR product_id IS NOT NULL)
);
CREATE INDEX assistant_context ON assistant_conversations(workspace_id,product_id,task_id,updated_at);
CREATE TABLE assistant_turns (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
 user_text TEXT NOT NULL,
 assistant_text TEXT,
 model TEXT NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
 error TEXT NOT NULL DEFAULT '',
 error_action TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX assistant_turn_history ON assistant_turns(conversation_id,created_at,id);
CREATE UNIQUE INDEX assistant_running_turn ON assistant_turns(conversation_id) WHERE status='running';
