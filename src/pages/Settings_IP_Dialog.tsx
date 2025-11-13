// Temporary component - Add this IP Range Dialog before the final closing tags in Settings.tsx

<Dialog open={showIpRangeDialog} onOpenChange={setShowIpRangeDialog}>
  <DialogContent className="max-w-3xl max-h-[80vh]">
    <DialogHeader>
      <DialogTitle>
        Manage IP Ranges for "{selectedCredentialForIpRanges?.name}"
      </DialogTitle>
      <p className="text-sm text-muted-foreground">
        Define IP ranges where this credential set should be used automatically during discovery. 
        Supports CIDR notation (10.0.0.0/8) and hyphenated ranges (192.168.1.1-192.168.1.50).
      </p>
    </DialogHeader>
    
    <ScrollArea className="max-h-[500px] pr-4">
      <div className="space-y-4">
        {ipRanges.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No IP ranges configured yet
          </div>
        ) : (
          <div className="space-y-2">
            {ipRanges.map((range) => (
              <div key={range.id} className="flex items-start justify-between border rounded-lg p-3 hover:bg-accent/50">
                <div className="flex-1">
                  <span className="font-mono text-sm font-medium">{range.ip_range}</span>
                  {range.description && (
                    <p className="text-xs text-muted-foreground mt-1">{range.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => startEditIpRange(range)}
                  >
                    Edit
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => handleDeleteIpRange(range.id)}
                    disabled={loading}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div className="border-t pt-4 space-y-3">
          <h4 className="font-medium">{editingIpRange ? "Edit IP Range" : "Add IP Range"}</h4>
          <div className="space-y-2">
            <Label>IP Range *</Label>
            <Input
              placeholder="10.0.0.0/8 or 192.168.1.1-192.168.1.50"
              value={newIpRange}
              onChange={(e) => setNewIpRange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description (Optional)</Label>
            <Input
              placeholder="e.g., US-East Production Datacenter"
              value={newIpRangeDescription}
              onChange={(e) => setNewIpRangeDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {editingIpRange ? (
              <>
                <Button 
                  onClick={handleUpdateIpRange}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? "Updating..." : "Update IP Range"}
                </Button>
                <Button 
                  variant="outline"
                  onClick={cancelEditIpRange}
                  disabled={loading}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button 
                onClick={handleAddIpRange}
                disabled={loading}
                className="flex-1"
              >
                {loading ? "Adding..." : "Add IP Range"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  </DialogContent>
</Dialog>
