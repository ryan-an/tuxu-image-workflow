ALTER TABLE assistant_conversations ADD COLUMN selected INTEGER NOT NULL DEFAULT 1 CHECK(selected IN (0,1));
UPDATE assistant_conversations SET selected=0;
UPDATE assistant_conversations AS current SET selected=1 WHERE NOT EXISTS (
 SELECT 1 FROM assistant_conversations AS newer
 WHERE newer.workspace_id=current.workspace_id
  AND newer.product_id IS current.product_id AND newer.task_id IS current.task_id
  AND (newer.updated_at>current.updated_at OR (newer.updated_at=current.updated_at AND newer.rowid>current.rowid))
);
CREATE UNIQUE INDEX assistant_selected_context ON assistant_conversations(workspace_id,COALESCE(product_id,''),COALESCE(task_id,'')) WHERE selected=1;
