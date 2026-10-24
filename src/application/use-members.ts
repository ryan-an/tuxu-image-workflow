import { useEffect, useRef, useState } from "react";
import type { WorkspaceMember } from "../../shared/access";
import {
  listMembers,
  createMember,
  updateMember,
  inviteMember,
  removeMember,
  invitationUrl,
  type MemberInput,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../services/members";
import { transferWorkspace } from "../services/workspaces";
export function useMembers() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<
    Awaited<ReturnType<typeof listInvitations>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitation, setInvitation] = useState<{
    url: string;
    expiresAt: number;
  } | null>(null);
  const busy = useRef(false),
    mounted = useRef(true);
  async function refresh() {
    const [result, links] = await Promise.all([
      listMembers(),
      listInvitations(),
    ]);
    if (mounted.current) {
      setMembers(result);
      setInvitations(links);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh()
      .catch((e) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      await work();
      await refresh();
      return true;
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return {
    members,
    loading,
    pending,
    error,
    notice,
    invitation,
    invitations,
    refresh: () => run(refresh),
    create: (input: Omit<MemberInput, "monthlyLimit">) =>
      run(async () => {
        const result = await createMember({ ...input, monthlyLimit: null });
        if (result.token && result.expiresAt)
          setInvitation({
            url: invitationUrl(result.token),
            expiresAt: result.expiresAt,
          });
        setNotice(
          result.token
            ? "邀请已创建，分享链接让成员确认加入。"
            : "成员已添加。",
        );
      }),
    update: (
      account: WorkspaceMember,
      input: Omit<Parameters<typeof updateMember>[1], "monthlyLimit">,
    ) =>
      run(async () => {
        await updateMember(account.id, {
          ...input,
          monthlyLimit: account.monthlyLimit,
        });
        setNotice("成员权限已更新");
      }),
    invite: (account: WorkspaceMember) =>
      run(async () => {
        const result = await inviteMember(account.id);
        setInvitation({
          url: invitationUrl(result.token),
          expiresAt: result.expiresAt,
        });
        setNotice("新邀请已生成，旧邀请链接已失效。");
      }),
    remove: (account: WorkspaceMember) =>
      run(async () => {
        await removeMember(account.id);
        setNotice("成员已移出当前工作区，资料和历史任务保留。");
      }),
    share: (role: "editor" | "viewer") =>
      run(async () => {
        const result = await createInvitation(role);
        setInvitation({
          url: invitationUrl(result.token),
          expiresAt: result.expiresAt,
        });
        setNotice("邀请链接已生成，可供一位成员加入。");
      }),
    revoke: (id: string) =>
      run(async () => {
        await revokeInvitation(id);
        setNotice("邀请已撤销");
      }),
    transfer: (
      workspaceId: string,
      account: WorkspaceMember,
      flush: () => Promise<unknown>,
    ) =>
      run(async () => {
        await flush();
        await transferWorkspace(workspaceId, account.id);
        window.location.reload();
      }),
  };
}
