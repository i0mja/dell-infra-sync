import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type OperationType = 
  | "console" 
  | "refresh" 
  | "test" 
  | "health" 
  | "power" 
  | "bios" 
  | "boot" 
  | "media" 
  | "backup" 
  | "delete";

interface ServerOperations {
  [serverId: string]: {
    [K in OperationType]?: boolean;
  };
}

interface ServerOperationsContextType {
  operations: ServerOperations;
  startOperation: (serverId: string, operation: OperationType) => void;
  endOperation: (serverId: string, operation: OperationType) => void;
  isOperationActive: (serverId: string, operation: OperationType) => boolean;
  getActiveOperations: (serverId: string) => OperationType[];
  hasAnyOperation: (serverId: string) => boolean;
}

const ServerOperationsContext = createContext<ServerOperationsContextType | undefined>(undefined);

export function ServerOperationsProvider({ children }: { children: ReactNode }) {
  const [operations, setOperations] = useState<ServerOperations>({});

  const startOperation = useCallback((serverId: string, operation: OperationType) => {
    setOperations(prev => ({
      ...prev,
      [serverId]: {
        ...prev[serverId],
        [operation]: true,
      },
    }));
  }, []);

  const endOperation = useCallback((serverId: string, operation: OperationType) => {
    setOperations(prev => {
      const serverOps = { ...prev[serverId] };
      delete serverOps[operation];
      
      // Clean up empty server entries
      if (Object.keys(serverOps).length === 0) {
        const { [serverId]: _, ...rest } = prev;
        return rest;
      }
      
      return {
        ...prev,
        [serverId]: serverOps,
      };
    });
  }, []);

  const isOperationActive = useCallback((serverId: string, operation: OperationType) => {
    return operations[serverId]?.[operation] === true;
  }, [operations]);

  const getActiveOperations = useCallback((serverId: string): OperationType[] => {
    const serverOps = operations[serverId];
    if (!serverOps) return [];
    return Object.keys(serverOps).filter(
      (key) => serverOps[key as OperationType]
    ) as OperationType[];
  }, [operations]);

  const hasAnyOperation = useCallback((serverId: string) => {
    return getActiveOperations(serverId).length > 0;
  }, [getActiveOperations]);

  return (
    <ServerOperationsContext.Provider
      value={{
        operations,
        startOperation,
        endOperation,
        isOperationActive,
        getActiveOperations,
        hasAnyOperation,
      }}
    >
      {children}
    </ServerOperationsContext.Provider>
  );
}

export function useServerOperations() {
  const context = useContext(ServerOperationsContext);
  if (context === undefined) {
    throw new Error("useServerOperations must be used within a ServerOperationsProvider");
  }
  return context;
}

// Operation labels for display
export const operationLabels: Record<OperationType, string> = {
  console: "Console",
  refresh: "Refreshing",
  test: "Testing",
  health: "Health Check",
  power: "Power",
  bios: "BIOS",
  boot: "Boot",
  media: "Media",
  backup: "Backup",
  delete: "Deleting",
};
