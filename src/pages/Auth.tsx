import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Server, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [showResetForm, setShowResetForm] = useState(false);
  const [showUpdatePassword, setShowUpdatePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [authSource, setAuthSource] = useState<'local' | 'freeipa'>('local');
  const [idmSettings, setIdmSettings] = useState<any>(null);
  const [idmLoading, setIdmLoading] = useState(true);
  const [lockoutRemaining, setLockoutRemaining] = useState<number | null>(null);
  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Load IDM settings to check if FreeIPA auth is enabled
    loadIdmSettings();

    // Show password update form if arriving from recovery link
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));
      if (params.get("type") === "recovery") {
        setShowUpdatePassword(true);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setShowUpdatePassword(true);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const loadIdmSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('idm_settings')
        .select('auth_mode')
        .maybeSingle();

      if (error) throw error;
      setIdmSettings(data);

      // Set default auth source based on IDM mode
      if (data?.auth_mode === 'idm_primary') {
        setAuthSource('freeipa');
      }
    } catch (error) {
      console.error('Failed to load IDM settings:', error);
    } finally {
      setIdmLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast({
        title: "Authentication Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Welcome back",
        description: "Successfully signed in",
      });
      navigate("/");
    }

    setLoading(false);
  };

  const handleFreeIPASignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/idm-authenticate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        }
      );

      const result = await response.json();

      if (response.status === 429) {
        // Rate limited
        setLockoutRemaining(result.lockout_remaining_seconds);
        toast({
          title: "Account Locked",
          description: result.error || `Too many failed attempts. Please try again in ${Math.ceil(result.lockout_remaining_seconds / 60)} minutes.`,
          variant: "destructive",
        });
      } else if (result.success) {
        // Set session using returned tokens
        await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        toast({
          title: "Welcome",
          description: "Authenticated via FreeIPA",
        });
        navigate("/");
      } else {
        toast({
          title: "Authentication Failed",
          description: result.error || 'Invalid username or password',
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Connection Error",
        description: "Unable to reach authentication service",
        variant: "destructive",
      });
    }

    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signUp(email, password, fullName);

    if (error) {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Account Created",
        description: "Successfully registered and logged in.",
      });
      navigate("/");
    }

    setLoading(false);
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/auth`,
    });

    if (error) {
      toast({
        title: "Password Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Check Your Email",
        description: "Password reset instructions have been sent to your email.",
      });
      setShowResetForm(false);
      setResetEmail("");
    }

    setLoading(false);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      toast({
        title: "Password Update Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Password Updated",
        description: "Your password has been successfully updated.",
      });
      setShowUpdatePassword(false);
      setNewPassword("");
      navigate("/");
    }

    setLoading(false);
  };

  // Determine if we should show FreeIPA option
  const showFreeIPAOption = !idmLoading && idmSettings && idmSettings.auth_mode !== 'local_only';
  const hideSignUp = idmSettings?.auth_mode === 'idm_primary';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Server className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Dell Server Manager</CardTitle>
          <CardDescription>
            Enterprise datacenter infrastructure management
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showUpdatePassword ? (
            <div className="space-y-4">
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Enter your new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter your new password (minimum 6 characters).
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </div>
          ) : showResetForm ? (
            <div className="space-y-4">
              <Button
                variant="ghost"
                onClick={() => setShowResetForm(false)}
                className="mb-2"
              >
                ← Back to Sign In
              </Button>
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email Address</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="admin@company.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter your email address and we'll send you a link to reset your password.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>
            </div>
          ) : (
            <>
              {/* Auth Source Toggle */}
              {showFreeIPAOption && (
                <div className="mb-4">
                  <Tabs value={authSource} onValueChange={(value: any) => setAuthSource(value)}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="local">Local Account</TabsTrigger>
                      <TabsTrigger value="freeipa">FreeIPA</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              )}

              {/* Rate Limit Warning */}
              {lockoutRemaining && lockoutRemaining > 0 && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Account locked. Try again in {Math.ceil(lockoutRemaining / 60)} minutes.
                  </AlertDescription>
                </Alert>
              )}

              {authSource === 'freeipa' ? (
                /* FreeIPA Login Form */
                <form onSubmit={handleFreeIPASignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="freeipa-username">Username</Label>
                    <Input
                      id="freeipa-username"
                      type="text"
                      placeholder="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      disabled={lockoutRemaining !== null && lockoutRemaining > 0}
                    />
                    <p className="text-sm text-muted-foreground">
                      Enter your FreeIPA username (not email)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="freeipa-password">Password</Label>
                    <Input
                      id="freeipa-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={lockoutRemaining !== null && lockoutRemaining > 0}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || (lockoutRemaining !== null && lockoutRemaining > 0)}
                  >
                    {loading ? "Signing in..." : "Sign In with FreeIPA"}
                  </Button>
                </form>
              ) : (
                /* Local Auth Tabs */
                <Tabs defaultValue="signin" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signin">Sign In</TabsTrigger>
                    {!hideSignUp && <TabsTrigger value="signup">Sign Up</TabsTrigger>}
                  </TabsList>
                  <TabsContent value="signin">
                    <form onSubmit={handleSignIn} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="signin-email">Email</Label>
                        <Input
                          id="signin-email"
                          type="email"
                          placeholder="admin@company.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signin-password">Password</Label>
                        <Input
                          id="signin-password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Signing in..." : "Sign In"}
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        className="w-full text-sm"
                        onClick={() => setShowResetForm(true)}
                      >
                        Forgot your password?
                      </Button>
                    </form>
                  </TabsContent>
                  {!hideSignUp && (
                    <TabsContent value="signup">
                      <form onSubmit={handleSignUp} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="signup-name">Full Name</Label>
                          <Input
                            id="signup-name"
                            type="text"
                            placeholder="John Doe"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="signup-email">Email</Label>
                          <Input
                            id="signup-email"
                            type="email"
                            placeholder="admin@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="signup-password">Password</Label>
                          <Input
                            id="signup-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                          />
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                          {loading ? "Creating account..." : "Sign Up"}
                        </Button>
                      </form>
                    </TabsContent>
                  )}
                </Tabs>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
