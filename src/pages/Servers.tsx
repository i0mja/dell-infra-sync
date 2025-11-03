import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AddServerDialog } from "@/components/servers/AddServerDialog";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  idrac_firmware: string | null;
  vcenter_host_id: string | null;
  last_seen: string | null;
  created_at: string;
}

const Servers = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchServers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("servers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setServers(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading servers",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const filteredServers = servers.filter((server) =>
    server.ip_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.service_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Server Inventory</h1>
          <p className="text-muted-foreground">
            Manage Dell servers discovered via iDRAC Redfish API
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchServers}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search Servers</CardTitle>
          <CardDescription>Filter by IP, hostname, service tag, or model</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search servers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredServers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <p className="text-lg font-medium mb-2">No servers found</p>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? "Try a different search term"
                : "Add servers manually or run an IP scan to discover Dell iDRAC endpoints"}
            </p>
            {!searchTerm && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Server
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredServers.map((server) => (
            <Card key={server.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">{server.hostname || server.ip_address}</h3>
                      {server.vcenter_host_id ? (
                        <Badge variant="secondary">Linked</Badge>
                      ) : (
                        <Badge variant="outline">Unlinked</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">IP Address:</span>
                        <p className="font-medium">{server.ip_address}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Model:</span>
                        <p className="font-medium">{server.model || "N/A"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Service Tag:</span>
                        <p className="font-medium">{server.service_tag || "N/A"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">iDRAC Firmware:</span>
                        <p className="font-medium">{server.idrac_firmware || "N/A"}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddServerDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={fetchServers} />
    </div>
  );
};

export default Servers;
