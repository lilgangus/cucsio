import { notFound } from "next/navigation";

import { TopBar } from "./top-bar";

const ROOM_CODE_RE = /^[a-z0-9]{6}$/;

type Props = {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
};

/**
 * Room shell: top bar (h-14) above a body that fills the rest of the
 * viewport. The body is split 2/3 + 1/3 inside the page itself so that
 * the page can also overlay a tree background under the chat panel.
 */
export default async function RoomLayout({ children, params }: Props) {
  const { code } = await params;
  const normalized = code.toLowerCase();

  if (!ROOM_CODE_RE.test(normalized)) {
    notFound();
  }

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TopBar roomCode={normalized} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
