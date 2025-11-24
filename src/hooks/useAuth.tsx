import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Set auth timeout to prevent infinite loading
    const authTimeout = setTimeout(() => {
      if (loading) {
        console.error('Auth timeout - taking too long to initialize');
        setAuthError('Connection timeout. Please check your internet connection.');
        setLoading(false);
      }
    }, 10000); // 10 second timeout

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Synchronous updates only
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        setAuthError(null);
        clearTimeout(authTimeout);

        // Defer role fetch to avoid deadlocks in the auth callback
        setTimeout(() => {
          if (session?.user) {
            supabase
              .rpc('get_user_role', { _user_id: session.user.id })
              .then(({ data }) => setUserRole(data), () => setUserRole(null));
          } else {
            setUserRole(null);
          }
        }, 0);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      setAuthError(null);
      clearTimeout(authTimeout);

      setTimeout(() => {
        if (session?.user) {
          supabase
            .rpc('get_user_role', { _user_id: session.user.id })
            .then(({ data }) => setUserRole(data), () => setUserRole(null));
        } else {
          setUserRole(null);
        }
      }, 0);
    }).catch((error) => {
      console.error('Failed to get session:', error);
      setAuthError('Failed to connect to authentication service.');
      setLoading(false);
      clearTimeout(authTimeout);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(authTimeout);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, userRole, signIn, signUp, signOut }}>
      {authError ? (
        <div className="flex h-screen items-center justify-center bg-background p-4">
          <div className="max-w-md space-y-4 p-8 rounded-lg bg-card border">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-6 w-6" />
              <h2 className="text-lg font-semibold">Connection Error</h2>
            </div>
            <p className="text-sm text-muted-foreground">{authError}</p>
            <div className="flex gap-2">
              <Button onClick={() => window.location.reload()} className="flex-1">
                Retry
              </Button>
              <Button onClick={() => navigate('/auth')} variant="outline" className="flex-1">
                Go to Login
              </Button>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
