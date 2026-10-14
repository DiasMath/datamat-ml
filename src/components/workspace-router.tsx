"use client";
import { usePathname } from "next/navigation";
import Workspace from "./workspace";
export default function WorkspaceRouter({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const view = pathname.split("/").filter(Boolean);
  return (
    <>
      <Workspace view={view} />
      {children}
    </>
  );
}
