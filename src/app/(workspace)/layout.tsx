import WorkspaceRouter from "@/components/workspace-router";
export const dynamic = "force-dynamic";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceRouter>{children}</WorkspaceRouter>;
}
