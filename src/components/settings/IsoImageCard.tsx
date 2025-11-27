import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disc, Trash2, ExternalLink, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { IsoImage } from "@/hooks/useIsoImages";
import { formatDistanceToNow } from "date-fns";

interface IsoImageCardProps {
  iso: IsoImage;
  onDelete: (id: string) => void;
  onMount: (iso: IsoImage) => void;
}

export const IsoImageCard = ({ iso, onDelete, onMount }: IsoImageCardProps) => {
  const formatFileSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb > 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const getStatusBadge = () => {
    switch (iso.upload_status) {
      case 'ready':
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>;
      case 'uploading':
        return <Badge className="bg-blue-500"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Uploading</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  return (
    <Card className="group hover:shadow-lg transition-all">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Disc className="h-6 w-6 text-primary" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="font-medium truncate">{iso.filename}</h4>
              {getStatusBadge()}
            </div>
            
            {iso.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {iso.description}
              </p>
            )}
            
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-2">
              <span>{formatFileSize(iso.file_size_bytes)}</span>
              <span>•</span>
              <span>{formatDistanceToNow(new Date(iso.created_at), { addSuffix: true })}</span>
              {iso.mount_count > 0 && (
                <>
                  <span>•</span>
                  <span>Mounted {iso.mount_count}x</span>
                </>
              )}
            </div>
            
            {iso.tags && iso.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {iso.tags.map((tag, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            
            {iso.upload_status === 'uploading' && (
              <div className="mt-2">
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${iso.upload_progress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {iso.upload_progress}% uploaded
                </p>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onMount(iso)}
            disabled={iso.upload_status !== 'ready'}
            className="flex-1"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Mount
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(iso.id)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
