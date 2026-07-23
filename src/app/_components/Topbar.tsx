import Link from "next/link";
import { auth } from "@/lib/auth";
import { logoutAction } from "@/app/actions";

export default async function Topbar() {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email ?? "";

  return (
    <div className="topbar">
      <div className="brand">
        <Link href="/tickets">Help Desk</Link>
        <span style={{ marginLeft: 16, fontWeight: 400, fontSize: 13 }}>
          <Link href="/tickets">Tickets</Link>
          {"  ·  "}
          <Link href="/macros">Macros</Link>
        </span>
      </div>
      <div className="user">
        <span>{name}</span>
        <form action={logoutAction}>
          <button type="submit">Sair</button>
        </form>
      </div>
    </div>
  );
}
