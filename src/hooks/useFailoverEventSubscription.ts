import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Subscribes to realtime changes on the failover_events table for a specific protection group.
 * When changes occur, invalidates relevant React Query caches to trigger immediate UI updates.
 */
export function useFailoverEventSubscription(protectionGroupId?: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!protectionGroupId) return;

    const channel = supabase
      .channel(`failover-events-${protectionGroupId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'failover_events',
          filter: `protection_group_id=eq.${protectionGroupId}`,
        },
        (payload) => {
          console.log('[Realtime] Failover event changed:', payload.eventType, payload);
          
          // Invalidate all relevant queries immediately
          queryClient.invalidateQueries({ 
            queryKey: ['active-failover', protectionGroupId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['active-test-failover', protectionGroupId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['failover-history', protectionGroupId] 
          });
          queryClient.invalidateQueries({ 
            queryKey: ['protection-groups'] 
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to failover events for group:', protectionGroupId);
        }
      });

    return () => {
      console.log('[Realtime] Unsubscribing from failover events for group:', protectionGroupId);
      supabase.removeChannel(channel);
    };
  }, [protectionGroupId, queryClient]);
}
