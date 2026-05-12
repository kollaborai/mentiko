export default function WorkflowsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
