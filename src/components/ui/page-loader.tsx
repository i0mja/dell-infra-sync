import { Server } from "lucide-react";

export const PageLoader = () => {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4">
        <Server className="h-10 w-10 text-primary animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
};
